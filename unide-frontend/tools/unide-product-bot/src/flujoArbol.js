import fs from 'node:fs';
import path from 'node:path';

// Árbol de funciones del panel de flujo: se lee de flujo.yaml (raíz del
// bot). Para no meter una dependencia YAML entera por un archivo de 100
// líneas, aquí hay un parser del SUBCONJUNTO exacto que usa flujo.yaml:
// dos secciones (nodos/edges), items "- ", campos "clave: valor", strings
// con o sin comillas y arrays en línea ["a", "b"]. Nada más.

// parseFlujoYaml(texto) → { nodos: [{id, nombre, grupo, match: []}],
// edges: [[a, b]] }. Lanza Error con número de línea si algo no encaja,
// para que el dueño sepa QUÉ línea rompió al editarlo a mano.
export function parseFlujoYaml(texto) {
  const nodos = [];
  const edges = [];
  let seccion = '';
  let item = null;
  const lineas = String(texto || '').replace(/^﻿/, '').split(/\r?\n/);
  for (let i = 0; i < lineas.length; i += 1) {
    const linea = lineas[i];
    if (!linea.trim() || /^\s*#/.test(linea)) continue;
    const num = i + 1;
    let m;
    if ((m = linea.match(/^(\w+):\s*$/))) {
      if (m[1] !== 'nodos' && m[1] !== 'edges') throw new Error(`línea ${num}: sección desconocida '${m[1]}' (solo nodos/edges)`);
      seccion = m[1];
      item = null;
      continue;
    }
    if (seccion === 'edges') {
      if ((m = linea.match(/^\s+-\s*\[(.+)\]\s*$/))) {
        const par = m[1].split(',').map((s) => desquotar(s.trim()));
        if (par.length !== 2 || !par[0] || !par[1]) throw new Error(`línea ${num}: un edge es [origen, destino]`);
        edges.push(par);
        continue;
      }
      throw new Error(`línea ${num}: en edges solo se admite "- [a, b]"`);
    }
    if (seccion === 'nodos') {
      if ((m = linea.match(/^\s{2}-\s+(\w+):\s*(.*)$/))) {
        item = {};
        nodos.push(item);
        item[m[1]] = parseValor(m[2], num);
        continue;
      }
      if ((m = linea.match(/^\s{4}(\w+):\s*(.*)$/))) {
        if (!item) throw new Error(`línea ${num}: campo fuera de un item "- "`);
        item[m[1]] = parseValor(m[2], num);
        continue;
      }
      throw new Error(`línea ${num}: no entiendo esta línea dentro de nodos`);
    }
    throw new Error(`línea ${num}: contenido antes de la primera sección`);
  }
  return { nodos, edges };
}

function parseValor(crudo, num) {
  const v = String(crudo).trim();
  if (v.startsWith('[')) {
    if (!v.endsWith(']')) throw new Error(`línea ${num}: array en línea sin cerrar`);
    const dentro = v.slice(1, -1).trim();
    if (!dentro) return [];
    return dentro.split(',').map((s) => desquotar(s.trim()));
  }
  return desquotar(v);
}

function desquotar(v) {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

// Carga y valida flujo.yaml. NUNCA lanza: si el archivo falta o está roto,
// devuelve un árbol vacío con .error para que el panel de flujo lo pinte
// y el bot siga arrancando normal.
export function cargarArbol(config, logger) {
  const ruta = path.resolve(config.__toolRoot || '.', 'flujo.yaml');
  let texto = '';
  try {
    texto = fs.readFileSync(ruta, 'utf8');
  } catch {
    return arbolVacio('找不到 flujo.yaml（更新 BOT 应该会带上它）');
  }
  let crudo;
  try {
    crudo = parseFlujoYaml(texto);
  } catch (error) {
    logger?.warn('flujo.yaml roto', { error: error.message });
    return arbolVacio(`flujo.yaml 解析失败：${error.message}`);
  }
  const nodos = [];
  const vistos = new Set();
  for (const n of crudo.nodos) {
    if (!n.id || !n.nombre || vistos.has(n.id)) {
      logger?.warn('flujo.yaml nodo invalido o duplicado', { id: n.id || '?' });
      continue;
    }
    vistos.add(n.id);
    nodos.push({ id: String(n.id), nombre: String(n.nombre), grupo: String(n.grupo || ''), match: Array.isArray(n.match) ? n.match.map(String) : [] });
  }
  const edges = crudo.edges.filter(([a, b]) => {
    const ok = vistos.has(a) && vistos.has(b);
    if (!ok) logger?.warn('flujo.yaml edge con nodo desconocido', { a, b });
    return ok;
  });
  return construirArbol(nodos, edges, '');
}

function arbolVacio(error) {
  return construirArbol([], [], error);
}

function construirArbol(nodos, edges, error) {
  // match más largo primero: "每日刷新促销" debe ganar a un hipotético "每日".
  const patrones = [];
  for (const n of nodos) for (const p of n.match) if (p) patrones.push({ p, id: n.id });
  patrones.sort((a, b) => b.p.length - a.p.length);
  // primer padre de cada nodo (el árbol es un DAG; para "la ruta" basta un
  // camino, y el primero declarado en el yaml es el natural).
  const padreDe = new Map();
  for (const [a, b] of edges) if (!padreDe.has(b)) padreDe.set(b, a);
  const nombreDe = new Map(nodos.map((n) => [n.id, n.nombre]));
  return {
    nodos,
    edges,
    error,
    // Ruta raíz→nodo como lista de nombres (para anclar ideas al árbol).
    // null si el id no existe; con tope por si alguien edita un ciclo.
    rutaHasta(id) {
      if (!nombreDe.has(id)) return null;
      const ruta = [];
      let actual = id;
      for (let i = 0; i < 12 && actual; i += 1) {
        ruta.unshift(nombreDe.get(actual));
        actual = padreDe.get(actual);
      }
      return ruta;
    },
    // etiqueta de conNavegador → id de nodo ('' si ninguno): exacto o prefijo,
    // así "搜商品 manzana" cae en el nodo 搜商品.
    nodoPorEtiqueta(etiqueta) {
      const e = String(etiqueta || '');
      for (const { p, id } of patrones) if (e === p || e.startsWith(p)) return id;
      return '';
    }
  };
}
