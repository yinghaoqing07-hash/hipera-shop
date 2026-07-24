import path from 'node:path';
import { readJsonSafe, writeJsonAtomic } from './safeJson.js';

// Cuaderno de ideas del dueño (23/07): "quiero poder crear una función
// cuando se me ocurra algo y guardar el prompt del cambio". Cada idea es
// un texto libre con fecha; se acumulan y con /ideas_exportar salen como
// UN documento listo para reenviar a Claude, que es el flujo real de
// trabajo de esta tienda (idea → prompt guardado → se lo pasa a Claude →
// versión nueva). El bot NO ejecuta las ideas: solo las guarda.

const TOPE_IDEAS = 300;
const TOPE_TEXTO = 2000;
const TOPE_ESTACIONES = 10; // paradas de una ruta a medida

// Ruta a medida (v251, "越自由越好"): lista de paradas, cada una o bien un
// nodo del árbol { id, nombre } o bien texto libre { nombre } para algo que
// todavía NO existe en el árbol. Si una idea la tiene, MANDA sobre la ruta
// automática que se deduce del ancla.
function limpiarRuta(ruta) {
  if (!Array.isArray(ruta)) return undefined;
  const salida = [];
  for (const p of ruta.slice(0, TOPE_ESTACIONES)) {
    const nombre = String(p?.nombre ?? p ?? '').trim().slice(0, 40);
    if (!nombre) continue;
    const parada = { nombre };
    const id = String(p?.id || '').trim().slice(0, 60);
    if (id) parada.id = id;
    salida.push(parada);
  }
  return salida;
}

export class IdeaStore {
  constructor(config, logger) {
    this.file = path.resolve(config.logsDir || '.', 'ideas.json');
    this.logger = logger;
    const data = readJsonSafe(this.file, null) || { seq: 0, ideas: [] };
    this.seq = Number(data.seq) || 0;
    this.ideas = Array.isArray(data.ideas) ? data.ideas : [];
    // Purga de fantasmas: ideas creadas con el clic derecho y abandonadas
    // sin escribir nada (ni nombre ni texto) durante más de 2 días.
    const corte = Date.now() - 2 * 86400000;
    this.ideas = this.ideas.filter((i) => !(i.estado === 'pendiente' && !i.texto && !i.nombre && new Date(i.creado).getTime() < corte));
  }

  guardar() {
    try {
      writeJsonAtomic(this.file, { seq: this.seq, ideas: this.ideas });
    } catch (error) {
      this.logger?.warn('ideas no se pudieron guardar', { error: error.message });
    }
  }

  // Crear SIN validar texto: el flujo del panel (v242) crea la idea vacía
  // en el momento del clic derecho y el contenido llega después con el
  // autoguardado. ancla = nodo del árbol; nombre = nombre corto del futuro
  // nodo. Las abandonadas del todo vacías las purga el constructor.
  // ancla: id de un nodo del árbol, o 'idea:<id>' para colgar una idea de
  // OTRA idea (así un功能 grande se parte en sub-ideas). ruta: a medida.
  crear({ texto = '', nombre = '', ancla = '', ruta } = {}) {
    this.seq += 1;
    const idea = { id: this.seq, texto: String(texto).trim().slice(0, TOPE_TEXTO), creado: new Date().toISOString(), estado: 'pendiente' };
    if (ancla) idea.ancla = String(ancla).slice(0, 60);
    if (nombre) idea.nombre = String(nombre).trim().slice(0, 60);
    const limpia = limpiarRuta(ruta);
    if (limpia?.length) idea.ruta = limpia;
    this.ideas.push(idea);
    if (this.ideas.length > TOPE_IDEAS) this.ideas = this.ideas.slice(-TOPE_IDEAS);
    this.guardar();
    return idea;
  }

  // Vía chat: aquí el texto sí es obligatorio (no hay autoguardado detrás).
  agregar(texto, extra = {}) {
    const limpio = String(texto || '').trim();
    if (!limpio) return null;
    return this.crear({ texto: limpio, nombre: extra.nombre, ancla: extra.ancla });
  }

  // Autoguardado del panel: solo pendientes; undefined = no tocar el campo.
  // ruta: [] borra la ruta a medida (vuelve a la automática del ancla).
  editar(id, { nombre, texto, ruta } = {}) {
    const idea = this.buscar(id);
    if (!idea || idea.estado !== 'pendiente') return null;
    if (nombre !== undefined) idea.nombre = String(nombre).trim().slice(0, 60);
    if (texto !== undefined) idea.texto = String(texto).trim().slice(0, TOPE_TEXTO);
    if (ruta !== undefined) {
      const limpia = limpiarRuta(ruta);
      if (limpia?.length) idea.ruta = limpia;
      else delete idea.ruta;
    }
    this.guardar();
    return idea;
  }

  // Ideas colgadas de esta (para borrar en cascada y para no dejar huérfanas).
  hijas(id) {
    return this.ideas.filter((i) => i.ancla === `idea:${Number(id)}`);
  }

  pendientes() {
    return this.ideas.filter((i) => i.estado === 'pendiente');
  }

  hechas() {
    return this.ideas.filter((i) => i.estado === 'hecha');
  }

  buscar(id) {
    return this.ideas.find((i) => i.id === Number(id)) || null;
  }

  marcarHecha(id) {
    const idea = this.buscar(id);
    if (!idea || idea.estado !== 'pendiente') return null;
    idea.estado = 'hecha';
    idea.hecha = new Date().toISOString();
    this.guardar();
    return idea;
  }

  // Al borrar una idea con hijas, las hijas NO se pierden: heredan el ancla
  // de la madre (suben un escalón), que es lo menos sorprendente.
  borrar(id) {
    const idea = this.buscar(id);
    if (!idea) return null;
    for (const hija of this.hijas(idea.id)) {
      if (idea.ancla) hija.ancla = idea.ancla;
      else delete hija.ancla;
    }
    this.ideas = this.ideas.filter((i) => i.id !== idea.id);
    this.guardar();
    return idea;
  }

  // Documento para reenviar a Claude: las pendientes numeradas, con fecha,
  // nombre y su cadena (cadenaPor: idea → [nombres], la aporta bot.js, que
  // sabe resolver ruta a medida / ancla de árbol / idea madre).
  exportarTexto(cadenaPor) {
    const pend = this.pendientes();
    if (!pend.length) return '';
    const lineas = [
      '老板攒的功能想法（从 Jarvis 想法本导出，按顺序做就行）：',
      ''
    ];
    let n = 0;
    for (const idea of pend) {
      if (!idea.texto && !idea.nombre) continue; // vacías abandonadas: fuera
      n += 1;
      const fecha = String(idea.creado).slice(0, 10);
      lineas.push(`${n}. [#${idea.id} · ${fecha}]${idea.nombre ? ` ${idea.nombre}` : ''}`);
      const ruta = cadenaPor ? cadenaPor(idea) : null;
      if (ruta && ruta.length) lineas.push(`位置：${ruta.join(' → ')} → [新] ${idea.nombre || '(未命名)'}`);
      lineas.push(idea.texto || '（只起了名字，说明还没写）', '');
    }
    return n ? lineas.join('\n') : '';
  }
}

// '/idea 文字' → agregar; '/ideas' → listar; '/ideas_exportar' → exportar.
// null si no es un comando del cuaderno.
export function parseIdeaCommand(text) {
  const t = String(text || '').trim();
  let m;
  if ((m = t.match(/^\/ideas_exportar(?:@\w+)?\s*$/i))) return { accion: 'exportar' };
  if ((m = t.match(/^\/ideas(?:@\w+)?\s*$/i))) return { accion: 'listar' };
  if ((m = t.match(/^\/idea(?:@\w+)?(?:\s+([\s\S]+))?$/i))) return { accion: 'agregar', texto: (m[1] || '').trim() };
  return null;
}

// Frases naturales: 「记个想法：...」「我有个想法...」「存个点子...」.
// Devuelve el TEXTO de la idea ('' si la frase es solo el arranque) o null
// si la frase no habla de ideas. Se comprueba ANTES del enrutador LLM.
export function matchIdeaNatural(text) {
  const t = String(text || '').trim();
  let m;
  if ((m = t.match(/^(?:帮我)?(?:记|存|加)(?:个|一个|一下|条|一条)?(?:想法|点子|功能想法|新功能|需求)[：:，,、\s]*([\s\S]*)$/))) return m[1].trim();
  if ((m = t.match(/^我(?:有|想到)(?:了)?(?:个|一个)?(?:想法|点子|新功能|功能)[：:，,、\s]*([\s\S]*)$/))) return m[1].trim();
  return null;
}

export function formatIdeaList(store, cadenaPor) {
  const pend = store.pendientes();
  const hechas = store.hechas().length;
  if (!pend.length) {
    return hechas
      ? `想法本是空的（已完成 ${hechas} 条）。想到什么就发「/idea 内容」，或者在流程图的树上右键挂一个。`
      : '想法本还是空的。想到什么就发「/idea 内容」，或者在流程图的树上右键挂一个。';
  }
  const lineas = [`💡 想法本 · ${pend.length} 条待做${hechas ? `（另有 ${hechas} 条已完成）` : ''}`, ''];
  for (const idea of pend) {
    const fecha = String(idea.creado).slice(5, 10).replace('-', '/');
    lineas.push(`#${idea.id} · ${fecha}${idea.nombre ? ` · ${idea.nombre}` : ''}`);
    const ruta = cadenaPor ? cadenaPor(idea) : null;
    if (ruta && ruta.length) lineas.push(`位置：${ruta.join(' → ')}`);
    const cuerpo = idea.texto || '（还没写内容）';
    lineas.push(cuerpo.length > 200 ? cuerpo.slice(0, 200) + '…' : cuerpo, '');
  }
  lineas.push('攒够了按「📤 导出发给 Claude」，一个文件全带走。');
  return lineas.join('\n');
}
