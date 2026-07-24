import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Background, BaseEdge, Controls, Handle, MarkerType, Position, ReactFlow } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import './estilos.css';

// Panel de flujo del bot, DOS vistas (idea del dueño, 23/07):
// - 功能树: árbol de funciones (flujo.yaml) coloreado con el estado real.
// - 想法本: sus ideas de optimización, cada una ANCLADA al árbol: clic
//   derecho en un nodo del árbol → aparece en 想法本 la cadena completa
//   hasta ese nodo con un nodo EN BLANCO al final donde escribe el nombre
//   y el prompt de diseño (petición literal del dueño, 23/07). Así dentro
//   de meses se sigue sabiendo dónde encaja cada idea.

const ANCHO = 192;
const ALTO = 64;
const IDEA_W = 240;
const IDEA_H = 104;
const GHOST_W = 132;
const GHOST_H = 38;
const IDEA_EDIT_W = 268;
const IDEA_EDIT_H = 300; // nombre + prompt + editor de ruta + botón de hija

const embebido = window.self !== window.top;

function fmtDur(ms) {
  const n = Number(ms) || 0;
  if (n <= 0) return '—';
  if (n < 1000) return `${n}ms`;
  if (n < 60000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.floor(n / 60000)}分${Math.round((n % 60000) / 1000)}秒`;
}

function fmtHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function mandarCallback(data) {
  try {
    const r = await fetch('/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data })
    });
    const j = await r.json();
    return j.toast || '';
  } catch {
    return '';
  }
}

// --- nodos --------------------------------------------------------------

function PasoNodo({ data }) {
  return (
    <div className={`nodoPaso e-${data.estado}`}>
      {(data.tgt || []).map((h) => (
        <Handle key={h.id} id={h.id} type="target" position={Position.Left} className="asa" style={{ top: `${h.top}%` }} />
      ))}
      <div className="nodoGrupo">{data.grupo}</div>
      <div className="nodoNombre">{data.nombre}</div>
      <div className="nodoStats">
        {data.estado === 'corriendo' ? '运行中…'
          : data.total === 0 ? '还没跑过'
          : `成功率 ${data.exito}% · 平均 ${fmtDur(data.duracionMediaMs)}`}
      </div>
      {(data.src || []).map((h) => (
        <Handle key={h.id} id={h.id} type="source" position={Position.Right} className="asa" style={{ top: `${h.top}%` }} />
      ))}
    </div>
  );
}

// --- aristas --------------------------------------------------------------

// Codo horizontal-vertical-horizontal con esquinas redondeadas. cx es el x
// del tramo vertical (el "carril" de esta línea); rr se achica si los tramos
// son cortos para que las curvas no se monten unas sobre otras.
function codoPath(sx, sy, tx, ty, cx, r = 7) {
  if (Math.abs(ty - sy) < 2) return `M ${sx},${sy} L ${tx},${ty}`;
  const dy = Math.sign(ty - sy);
  const rr = Math.max(1, Math.min(r, (Math.abs(ty - sy) - 1) / 2, (cx - sx) / 2, (tx - cx) / 2));
  return [
    `M ${sx},${sy}`,
    `L ${cx - rr},${sy}`,
    `Q ${cx},${sy} ${cx},${sy + rr * dy}`,
    `L ${cx},${ty - rr * dy}`,
    `Q ${cx},${ty} ${cx + rr},${ty}`,
    `L ${tx},${ty}`
  ].join(' ');
}

// Arista del árbol: cada línea baja por su propio carril (data.lane, viene
// de asignarCarriles), así dos líneas cuyos tramos verticales se solapan
// nunca comparten tramo. Tope: el carril no puede pegarse al nodo destino.
function PasoArista({ id, sourceX, sourceY, targetX, targetY, markerEnd, style, data }) {
  const lane = Number(data?.lane) || 0;
  let cx = sourceX + 18 + lane * 20;
  cx = Math.min(cx, targetX - 28);
  if (cx < sourceX + 8) cx = (sourceX + targetX) / 2;
  return <BaseEdge id={id} path={codoPath(sourceX, sourceY, targetX, targetY, cx)} markerEnd={markerEnd} style={style} />;
}

// Eslabón gris de la cadena: un nodo del árbol REAL, repetido en la vista
// de ideas solo como contexto ("de dónde cuelga esto").
function GhostNodo({ data }) {
  return (
    <div className={'nodoGhost g-' + (data.tipo || 'nodo')} title={data.nombre}>
      <Handle type="target" position={Position.Left} className="asa" />
      {data.nombre}
      <Handle type="source" position={Position.Right} className="asa" />
    </div>
  );
}

// Tarjeta de idea. Las HECHAS son de solo lectura; las PENDIENTES se
// editan EN LA PROPIA tarjeta con autoguardado (petición del dueño,
// 23/07: nada de botón de guardar — crear, teclear y listo).
function IdeaNodo({ data }) {
  const [nombre, setNombre] = useState(data.nombre || '');
  const [texto, setTexto] = useState(data.texto || '');
  const [marca, setMarca] = useState('');
  const timer = useRef(null);
  const limpiar = useRef(null);
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(limpiar.current); }, []);

  if (data.estado === 'hecha') {
    const corto = (data.texto || '').length > 90 ? data.texto.slice(0, 90) + '…' : (data.texto || '');
    return (
      <div className="nodoIdea i-hecha">
        <Handle type="target" position={Position.Left} className="asa" />
        <div className="ideaCabecera">
          <span>#{data.id} · {String(data.creado).slice(5, 10).replace('-', '/')}</span>
          <span className="ideaEstado">✅ 已实现</span>
        </div>
        {data.nombre && <div className="ideaNombre">{data.nombre}</div>}
        <div className="ideaTexto">{corto}</div>
      </div>
    );
  }

  const programar = (n, t) => {
    setMarca('保存中…');
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const ok = await data.onEditar(data.id, { nombre: n, texto: t });
      setMarca(ok ? '✓ 已保存' : '✗ 没存上');
      clearTimeout(limpiar.current);
      limpiar.current = setTimeout(() => setMarca(''), 2000);
    }, 700);
  };

  // La ruta ya NO se edita con fichitas dentro de la tarjeta (imposible de
  // usar con el dedo, 24/07): aquí solo se LEE, y se cambia volviendo al
  // árbol en modo conexión, tocando los nodos de verdad.
  const cadena = data.cadena || [];

  return (
    <div className="nodoIdea i-pendiente i-editable nodrag nowheel">
      <Handle type="target" position={Position.Left} className="asa" />
      <div className="ideaCabecera">
        <span>#{data.id} · {String(data.creado).slice(5, 10).replace('-', '/')}</span>
        <span className="ideaEstado">{marca || '💡 待做'}</span>
        {/* Botón explícito: en táctil las tarjetas con 'nodrag' NO reciben
            el clic de nodo de React Flow, así que las acciones se abren
            desde aquí (un <button> sí recibe el toque). */}
        <button className="ideaAbrir" title="操作" onClick={(e) => { e.stopPropagation(); data.onAbrir(data.id); }}>⋯</button>
        <button className="ideaBorrar" title="删除这条" onClick={(e) => { e.stopPropagation(); data.onBorrar(data.id); }}>🗑</button>
      </div>
      <input
        className="borrNombre"
        placeholder="节点名字（短）"
        value={nombre}
        maxLength={60}
        autoFocus={data.autoFocus}
        onChange={(e) => { setNombre(e.target.value); programar(e.target.value, texto); }}
      />
      <textarea
        className="borrTexto"
        placeholder="设计/实现 prompt：想让它做什么、怎么算做好了…"
        value={texto}
        onChange={(e) => { setTexto(e.target.value); programar(nombre, e.target.value); }}
      />
      <div className="rutaEditor">
        <div className="rutaLinea">
          <span className="rutaTitulo">路线{data.ruta ? '（自定义）' : ''}</span>
          <button className="rutaCambiar" onClick={() => data.onCambiarRuta(data.id)}>🔗 在树上改</button>
        </div>
        <div className="rutaChips">
          {cadena.length === 0 && <span className="rutaVacia">（没挂在树上）</span>}
          {cadena.map((p, i) => (
            <span key={i} className={'rutaChip t-' + p.tipo} title={p.nombre}>{p.nombre}</span>
          ))}
        </div>
      </div>
      {/* Tirador de conexión: de aquí "sale" la siguiente idea encadenada,
          en vez del botón ancho de antes (petición del dueño, 24/07). */}
      <button className="ideaTirador" onClick={() => data.onColgarHija(data.id)} title="从这里拉出下一条想法">＋</button>
    </div>
  );
}

const TIPOS = { paso: PasoNodo, idea: IdeaNodo, ghost: GhostNodo };
const TIPOS_ARISTA = { paso: PasoArista };

// --- layouts ------------------------------------------------------------

function calcularPosiciones(nodos, edges) {
  // Componentes conexas (aristas tomadas como no dirigidas), en el orden en
  // que aparecen los nodos en flujo.yaml.
  const vecinos = new Map(nodos.map((n) => [n.id, []]));
  for (const e of edges) {
    vecinos.get(e.source)?.push(e.target);
    vecinos.get(e.target)?.push(e.source);
  }
  const visto = new Set();
  const componentes = [];
  for (const n of nodos) {
    if (visto.has(n.id)) continue;
    const comp = [];
    const cola = [n.id];
    visto.add(n.id);
    while (cola.length) {
      const id = cola.shift();
      comp.push(id);
      for (const v of vecinos.get(id) || []) {
        if (!visto.has(v)) { visto.add(v); cola.push(v); }
      }
    }
    componentes.push(comp);
  }
  // Cada componente se maqueta con dagre POR SEPARADO y se apila debajo de
  // la anterior (mismo orden que flujo.yaml): los grupos sueltos (AI 助手,
  // AI 修复, 下单提醒…) quedan en su propia franja, nunca intercalados con
  // el árbol principal (petición del dueño, 24/07).
  const pos = {};
  let yTope = 0;
  for (const comp of componentes) {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'LR', nodesep: 22, ranksep: 170, marginx: 20, marginy: 20 });
    for (const id of comp) g.setNode(id, { width: ANCHO, height: ALTO });
    for (const e of edges) if (comp.includes(e.source)) g.setEdge(e.source, e.target);
    dagre.layout(g);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const id of comp) {
      const p = g.node(id);
      minY = Math.min(minY, p.y - ALTO / 2);
      maxY = Math.max(maxY, p.y + ALTO / 2);
    }
    const desplaza = yTope - minY + (yTope > 0 ? 70 : 0);
    for (const id of comp) {
      const p = g.node(id);
      pos[id] = { x: p.x - ANCHO / 2, y: p.y - ALTO / 2 + desplaza };
    }
    yTope = maxY + desplaza;
  }
  return pos;
}

// Cada arista sale/entra por su PROPIO punto del borde del nodo (handles a
// distinta altura). El orden sigue la Y del nodo del otro extremo.
function asignarHandles(edges, pos) {
  const porFuente = new Map();
  const porDestino = new Map();
  for (const e of edges) {
    if (!porFuente.has(e.source)) porFuente.set(e.source, []);
    porFuente.get(e.source).push(e);
    if (!porDestino.has(e.target)) porDestino.set(e.target, []);
    porDestino.get(e.target).push(e);
  }
  const src = new Map();
  const tgt = new Map();
  const deArista = new Map();
  const repartir = (agrupado, otroCampo, coleccion, prefijo, clave) => {
    for (const [id, lista] of agrupado) {
      const orden = lista.slice().sort((a, b) => (pos[a[otroCampo]]?.y ?? 0) - (pos[b[otroCampo]]?.y ?? 0));
      const handles = orden.map((e, i) => ({ id: `${prefijo}${i}`, top: ((i + 1) * 100) / (orden.length + 1) }));
      coleccion.set(id, handles);
      orden.forEach((e, i) => {
        deArista.set(e.id, { ...(deArista.get(e.id) || {}), [clave]: handles[i].id });
      });
    }
  };
  repartir(porFuente, 'target', src, 's', 'sourceHandle');
  repartir(porDestino, 'source', tgt, 't', 'targetHandle');
  return { src, tgt, deArista };
}

// Carril vertical de cada arista, asignado por HUECO entre ranks (mismo x de
// origen) con coloración de intervalos: si los tramos verticales de dos
// aristas se solapan en Y, reciben carriles DISTINTOS; si no se solapan,
// pueden reutilizar el mismo (así el hueco no necesita 13 carriles, solo el
// máximo solape real). Devuelve Map edgeId → lane.
function asignarCarriles(edges, pos) {
  const grupos = new Map();
  for (const e of edges) {
    const ps = pos[e.source];
    const pt = pos[e.target];
    if (!ps || !pt) continue;
    const gx = ps.x + ANCHO; // borde derecho del nodo origen
    const y0 = Math.min(ps.y, pt.y);
    const y1 = Math.max(ps.y, pt.y);
    if (!grupos.has(gx)) grupos.set(gx, []);
    grupos.get(gx).push({ e, y0, y1 });
  }
  const carriles = new Map();
  for (const lista of grupos.values()) {
    lista.sort((a, b) => a.y0 - b.y0 || a.y1 - b.y1);
    const finDe = [];
    for (const it of lista) {
      let lane = finDe.findIndex((fin) => fin <= it.y0 - 4);
      if (lane === -1) { lane = finDe.length; finDe.push(0); }
      finDe[lane] = it.y1;
      carriles.set(it.e.id, lane);
    }
  }
  return carriles;
}

const bordeGhost = { stroke: '#3d4a5c', strokeWidth: 1.2, strokeDasharray: '5 4' };

// Vista 想法本: una FILA por idea pendiente — cadena de eslabones grises
// (su ruta en el árbol) y la tarjeta EDITABLE al final; debajo, las
// hechas en rejilla compacta de solo lectura.
function construirVistaIdeas(ideas, handlers, focoId) {
  const nodes = [];
  const edges = [];
  let y = 20;

  const filaCadena = (cadena, prefijo, finalNode, finalW, finalH) => {
    let x = 20;
    let anterior = null;
    cadena.forEach((parada, i) => {
      const id = `${prefijo}-g${i}`;
      nodes.push({
        id,
        type: 'ghost',
        position: { x, y: y + (finalH - GHOST_H) / 2 },
        data: { nombre: parada.nombre, tipo: parada.tipo },
        draggable: false,
        selectable: false
      });
      if (anterior) edges.push({ id: `${prefijo}-e${i}`, source: anterior, target: id, type: 'smoothstep', style: bordeGhost });
      anterior = id;
      x += GHOST_W + 26;
    });
    finalNode.position = { x, y };
    nodes.push(finalNode);
    if (anterior) {
      edges.push({
        id: `${prefijo}-efin`,
        source: anterior,
        target: finalNode.id,
        type: 'smoothstep',
        style: bordeGhost,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#3d4a5c', width: 14, height: 14 }
      });
    }
    y += finalH + 22;
  };

  const pend = ideas.filter((i) => i.estado === 'pendiente').slice().reverse();
  for (const idea of pend) {
    filaCadena(idea.cadena || [], `i${idea.id}`, {
      id: `idea-${idea.id}`,
      type: 'idea',
      data: {
        ...idea,
        nodosArbol: handlers.nodosArbol,
        onEditar: handlers.onEditar,
        onBorrar: handlers.onBorrar,
        onColgarHija: handlers.onColgarHija,
        onCambiarRuta: handlers.onCambiarRuta,
        onAbrir: handlers.onAbrir,
        autoFocus: idea.id === focoId
      },
      draggable: false
    }, IDEA_EDIT_W, IDEA_EDIT_H);
  }

  const hechas = ideas.filter((i) => i.estado === 'hecha').slice().reverse();
  if (hechas.length) {
    y += 18;
    hechas.forEach((idea, i) => {
      nodes.push({
        id: `idea-${idea.id}`,
        type: 'idea',
        position: { x: (i % 4) * (IDEA_W + 20) + 20, y: y + Math.floor(i / 4) * (IDEA_H + 16) },
        data: idea,
        draggable: false
      });
    });
  }
  return { nodes, edges };
}

// --- barras laterales ---------------------------------------------------

function Lateral({ nodo, detalle, onCerrar, onColgarIdea, onConectarDesde }) {
  const historia = detalle?.historia || [];
  const ultimoError = historia.find((h) => h.estado === 'error');
  const capturas = [];
  for (const h of historia) {
    if (h.captura && !capturas.some((c) => c.captura === h.captura)) capturas.push(h);
    if (capturas.length >= 3) break;
  }
  return (
    <aside className="lateral">
      <div className="latCabecera">
        <div>
          <div className="latGrupo">{nodo.grupo}</div>
          <div className="latNombre">{nodo.nombre}</div>
        </div>
        <button className="latCerrar" onClick={onCerrar}>✕</button>
      </div>
      <div className="latStats">
        {nodo.total === 0 ? '这个步骤还没跑过。'
          : `共 ${nodo.total} 次 · 成功率 ${nodo.exito}% · 平均耗时 ${fmtDur(nodo.duracionMediaMs)}`}
      </div>
      {nodo.desc && (
        <div className="latBloque">
          <div className="latTitulo">这个节点是干什么的</div>
          <div className="latDesc">{nodo.desc}</div>
        </div>
      )}
      <div className="latBloque ideaBotones">
        <button onClick={() => onColgarIdea(nodo.id)}>💡 在这里挂个想法</button>
        <button onClick={() => onConectarDesde(nodo.id)}>🔗 从这里连线</button>
      </div>
      {capturas.length > 0 && (
        <div className="latBloque">
          <div className="latTitulo">最近截图</div>
          <div className="latFotos">
            {capturas.map((h) => (
              <a key={h.captura} href={`/api/flujo/foto?f=${encodeURIComponent(h.captura)}`} target="_blank" rel="noreferrer">
                <img src={`/api/flujo/foto?f=${encodeURIComponent(h.captura)}`} alt={h.captura} />
                <span>{fmtHora(h.at)}</span>
              </a>
            ))}
          </div>
        </div>
      )}
      {ultimoError && (
        <div className="latBloque">
          <div className="latTitulo err">最近一次失败 · {fmtHora(ultimoError.at)}</div>
          <pre className="latError">{ultimoError.detalle || '（没有留下错误信息）'}</pre>
        </div>
      )}
      <div className="latBloque">
        <div className="latTitulo">历史记录</div>
        {historia.length === 0 && <div className="latVacio">还没有记录。</div>}
        <ul className="latHistoria">
          {historia.map((h, i) => (
            <li key={i} className={h.estado === 'ok' ? 'ok' : 'err'}>
              <span className="hIcono">{h.estado === 'ok' ? '✓' : '✗'}</span>
              <span className="hHora">{fmtHora(h.at)}</span>
              <span className="hDur">{fmtDur(h.duracionMs)}</span>
              {h.detalle && <span className="hDetalle" title={h.detalle}>{h.detalle}</span>}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function LateralIdea({ idea, onCerrar, onAccion, onColgarHija, onCambiarRuta }) {
  return (
    <aside className="lateral">
      <div className="latCabecera">
        <div>
          <div className="latGrupo">想法 #{idea.id} · {fmtHora(idea.creado)}</div>
          <div className="latNombre">{idea.nombre || (idea.estado === 'hecha' ? '✅ 已实现' : '💡 待做')}</div>
        </div>
        <button className="latCerrar" onClick={onCerrar}>✕</button>
      </div>
      {idea.cadena?.length > 0 && (
        <div className="latStats">位置：{idea.cadena.map((p) => p.nombre).join(' → ')} → <b>[新] {idea.nombre || '(未命名)'}</b></div>
      )}
      <div className="latBloque">
        <pre className="ideaCompleta">{idea.texto}</pre>
      </div>
      {idea.estado === 'hecha' && idea.hecha && (
        <div className="latStats">完成于 {fmtHora(idea.hecha)}</div>
      )}
      {/* Las acciones viven TAMBIÉN aquí porque en el móvil el lienzo va
          muy alejado y los tiradores de la tarjeta quedan diminutos; esta
          hoja no depende del zoom. */}
      {idea.estado === 'pendiente' && (
        <div className="latBloque ideaBotones">
          <button onClick={() => onColgarHija(idea.id)}>＋ 拉出下一条</button>
          <button onClick={() => onCambiarRuta(idea.id)}>🔗 在树上改路线</button>
        </div>
      )}
      <div className="latBloque ideaBotones">
        {idea.estado === 'pendiente' && (
          <button onClick={() => onAccion(`idea:done:${idea.id}`)}>✅ 标成已实现</button>
        )}
        <button className="peligro" onClick={() => onAccion(`idea:del:${idea.id}`)}>🗑 删除这条</button>
      </div>
    </aside>
  );
}

// --- app ----------------------------------------------------------------

function App() {
  const [vista, setVista] = useState('arbol');
  const [grafo, setGrafo] = useState(null);
  const [ideas, setIdeas] = useState([]);
  const [nodosArbol, setNodosArbol] = useState([]);
  const [sel, setSel] = useState('');
  const [detalle, setDetalle] = useState(null);
  const [focoId, setFocoId] = useState(0);
  const [aviso, setAviso] = useState('');
  // { paradas: [{id, nombre}], ideaId } — ideaId 0 = se creará una idea
  // nueva al terminar; >0 = se le cambia la ruta a esa idea.
  const [conexion, setConexion] = useState(null);
  const selRef = useRef('');
  const vistaRef = useRef('arbol');
  const conexionRef = useRef(null);
  selRef.current = sel;
  vistaRef.current = vista;
  conexionRef.current = conexion;

  const refrescar = useCallback(async () => {
    try {
      const r = await fetch('/api/flujo');
      if (r.ok) setGrafo(await r.json());
      const ri = await fetch('/api/flujo/ideas');
      if (ri.ok) {
        const j = await ri.json();
        setIdeas(j.ideas || []);
        if (j.nodosArbol) setNodosArbol(j.nodosArbol);
      }
      const id = selRef.current;
      if (id && vistaRef.current === 'arbol') {
        const d = await fetch(`/api/flujo/paso?id=${encodeURIComponent(id)}`);
        if (d.ok) setDetalle(await d.json());
      }
    } catch { /* el bot se está reiniciando: el siguiente poll lo recupera */ }
  }, []);

  useEffect(() => {
    refrescar();
    const t = setInterval(refrescar, 3000);
    return () => clearInterval(t);
  }, [refrescar]);

  const avisar = useCallback((texto) => {
    setAviso(texto);
    setTimeout(() => setAviso(''), 3500);
  }, []);

  const accionIdea = useCallback(async (data) => {
    const toast = await mandarCallback(data);
    if (toast) avisar(toast);
    setSel('');
    refrescar();
  }, [avisar, refrescar]);

  const nodos = grafo?.nodos || [];
  const edges = grafo?.edges || [];

  // Ruta raíz→nodo calculada en el cliente (primer padre de cada edge),
  // para pintar la cadena del borrador sin esperar al servidor.
  const rutaDe = useCallback((id) => {
    const padre = new Map();
    for (const e of edges) if (!padre.has(e.target)) padre.set(e.target, e.source);
    const nombre = new Map(nodos.map((n) => [n.id, n.nombre]));
    const ruta = [];
    let actual = id;
    for (let i = 0; i < 12 && actual && nombre.has(actual); i += 1) {
      ruta.unshift(nombre.get(actual));
      actual = padre.get(actual);
    }
    return ruta;
  }, [nodos, edges]);

  // Clic derecho en un nodo del árbol (o botón de la barra lateral): la
  // idea se CREA en el acto (vacía, anclada ahí) y salta a 想法本 con el
  // cursor en la tarjeta nueva; el contenido se autoguarda al teclear.
  const colgarIdea = useCallback(async (idNodo) => {
    try {
      const r = await fetch('/api/flujo/idea', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ancla: idNodo, nombre: '', texto: '' })
      });
      const j = await r.json();
      if (!j.ok) { avisar(j.error || '没建上'); return; }
      setFocoId(j.id);
      setVista('ideas');
      setSel('');
      setDetalle(null);
      await refrescar();
    } catch {
      avisar('没建上（bot 在重启？）');
    }
  }, [avisar, refrescar]);

  // Colgar una idea de OTRA idea: mismo camino, ancla 'idea:<id>'.
  const colgarHija = useCallback((idIdea) => colgarIdea(`idea:${idIdea}`), [colgarIdea]);

  // campos = { nombre?, texto?, ruta? } — solo se manda lo que cambia.
  const editarIdea = useCallback(async (id, campos) => {
    try {
      const r = await fetch('/api/flujo/idea', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, ...campos })
      });
      const ok = (await r.json()).ok === true;
      if (ok && campos.ruta !== undefined) refrescar(); // la cadena la repinta el servidor
      return ok;
    } catch {
      return false;
    }
  }, []);

  // dagre solo cuando cambia la TOPOLOGÍA (ids/edges), no en cada poll.
  const claveTopo = useMemo(
    () => nodos.map((n) => n.id).join('|') + '::' + edges.map((e) => e.id).join('|'),
    [nodos, edges]
  );
  const posiciones = useMemo(() => calcularPosiciones(nodos, edges), [claveTopo]); // eslint-disable-line react-hooks/exhaustive-deps
  const handles = useMemo(() => asignarHandles(edges, posiciones), [edges, posiciones]);
  const carriles = useMemo(() => asignarCarriles(edges, posiciones), [edges, posiciones]);

  const corriendo = new Set(nodos.filter((n) => n.estado === 'corriendo').map((n) => n.id));
  const rfNodosArbol = nodos.map((n) => ({
    id: n.id,
    type: 'paso',
    position: posiciones[n.id] || { x: 0, y: 0 },
    data: { ...n, src: handles.src.get(n.id) || [], tgt: handles.tgt.get(n.id) || [] },
    selected: sel === n.id
  }));
  const rfEdgesArbol = edges.map((e) => ({
    ...e,
    type: 'paso',
    sourceHandle: handles.deArista.get(e.id)?.sourceHandle,
    targetHandle: handles.deArista.get(e.id)?.targetHandle,
    data: { lane: carriles.get(e.id) || 0 },
    animated: corriendo.has(e.target) || corriendo.has(e.source),
    style: { stroke: '#3d4a5c', strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#3d4a5c', width: 16, height: 16 }
  }));

  const onBorrarIdea = useCallback((id) => accionIdea(`idea:del:${id}`), [accionIdea]);

  // --- modo conexión: armar la ruta tocando nodos del árbol -------------
  // Arranca con la ruta raíz→nodo (el contexto que ya se daba solo) y a
  // partir de ahí cada toque en un nodo añade una parada.
  const conectarDesde = useCallback((idNodo) => {
    const nombre = new Map(nodos.map((n) => [n.id, n.nombre]));
    const paradas = rutaDe(idNodo).map((nom) => ({ nombre: nom, id: [...nombre].find(([, v]) => v === nom)?.[0] }));
    setConexion({ paradas, ideaId: 0 });
    setVista('arbol');
    setSel('');
    setDetalle(null);
  }, [nodos, rutaDe]);

  // Cambiar la ruta de una idea que ya existe: mismo modo, pero al terminar
  // se GUARDA en esa idea en vez de crear una nueva.
  const cambiarRutaDeIdea = useCallback((idIdea) => {
    const idea = ideas.find((i) => i.id === idIdea);
    setConexion({ paradas: (idea?.cadena || []).map((p) => ({ nombre: p.nombre, id: p.id })), ideaId: idIdea });
    setVista('arbol');
    setSel('');
    setDetalle(null);
  }, [ideas]);

  const terminarConexion = useCallback(async () => {
    const c = conexionRef.current;
    if (!c) return;
    const ruta = c.paradas.map((p) => ({ nombre: p.nombre, id: p.id }));
    const ancla = [...c.paradas].reverse().find((p) => p.id && !String(p.id).startsWith('idea:'))?.id || '';
    setConexion(null);
    if (c.ideaId) {
      await editarIdea(c.ideaId, { ruta });
      setFocoId(c.ideaId);
    } else {
      try {
        const r = await fetch('/api/flujo/idea', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ancla, ruta, nombre: '', texto: '' })
        });
        const j = await r.json();
        if (!j.ok) { avisar(j.error || '没建上'); return; }
        setFocoId(j.id);
      } catch { avisar('没建上（bot 在重启？）'); return; }
    }
    setVista('ideas');
    setSel('');
    await refrescar();
  }, [editarIdea, avisar, refrescar]);

  const vistaIdeas = useMemo(
    () => construirVistaIdeas(ideas, { onEditar: editarIdea, onBorrar: onBorrarIdea, onColgarHija: colgarHija, onCambiarRuta: cambiarRutaDeIdea, onAbrir: (id) => setSel(`idea-${id}`), nodosArbol }, focoId),
    [ideas, editarIdea, onBorrarIdea, colgarHija, cambiarRutaDeIdea, nodosArbol, focoId]
  );

  const abrirNodo = useCallback((ev, nodo) => {
    if (nodo.type === 'ghost') return;
    // Teclear en una tarjeta editable no debe abrir la barra lateral.
    if (ev?.target?.closest && ev.target.closest('input, textarea, button')) return;
    // MODO CONEXIÓN: tocar un nodo lo añade a la ruta que se está armando
    // (objetivo del rediseño: construir la ruta tocando el árbol de verdad,
    // con objetivos grandes, en vez de fichitas dentro de la tarjeta).
    if (conexionRef.current && nodo.type === 'paso') {
      setConexion((c) => {
        if (!c) return c;
        if (c.paradas.some((p) => p.id === nodo.id)) return c; // ya está
        return { ...c, paradas: [...c.paradas, { id: nodo.id, nombre: nodo.data.nombre }] };
      });
      return;
    }
    setSel(nodo.id);
    if (vistaRef.current !== 'arbol') return;
    setDetalle(null);
    fetch(`/api/flujo/paso?id=${encodeURIComponent(nodo.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setDetalle(d); })
      .catch(() => {});
  }, []);

  const menuNodo = useCallback((ev, nodo) => {
    ev.preventDefault();
    if (nodo.type === 'paso') colgarIdea(nodo.id);
  }, [colgarIdea]);

  const cambiarVista = useCallback((v) => {
    setVista(v);
    setSel('');
    setDetalle(null);
  }, []);

  const nodoSel = vista === 'arbol' ? nodos.find((n) => n.id === sel) : null;
  const ideaSel = vista === 'ideas' ? ideas.find((i) => `idea-${i.id}` === sel) : null;
  const pendientes = ideas.filter((i) => i.estado === 'pendiente').length;

  return (
    <div className="pantalla">
      <header className="barra">
        <span className="titulo">流程图 · JARVIS</span>
        <span className="pestanas">
          <button className={vista === 'arbol' ? 'activa' : ''} onClick={() => cambiarVista('arbol')}>功能树</button>
          <button className={vista === 'ideas' ? 'activa' : ''} onClick={() => cambiarVista('ideas')}>想法本{pendientes ? ` ${pendientes}` : ''}</button>
        </span>
        {vista === 'arbol' && (
          <span className="leyenda">
            <i className="lg ok" />成功 <i className="lg run" />运行中 <i className="lg err" />失败 <i className="lg no" />没跑过 · 右键节点 = 挂想法
          </span>
        )}
        {vista === 'ideas' && pendientes > 0 && (
          <button className="exportar" onClick={() => accionIdea('idea:exp')}>📤 导出发给 Claude</button>
        )}
        <span className="hueco" />
        {aviso && <span className="toast">{aviso}</span>}
        <span className="pastilla">{grafo ? (grafo.motor === 'sqlite' ? 'SQLite' : 'NDJSON') : '…'}</span>
        {!embebido && <a className="volver" href="/">[ 返回面板 ]</a>}
      </header>
      {grafo?.error && vista === 'arbol' && <div className="aviso">{grafo.error}</div>}
      {conexion && (
        <div className="conexionBarra">
          <div className="conexionRuta">
            <b>连线中：</b>
            {conexion.paradas.map((p, i) => (
              <span key={i} className="conexionParada">{p.nombre}</span>
            ))}
            <span className="conexionPista">{conexion.ideaId ? '（改这条想法的路线）' : ''} 点树上的节点继续接</span>
          </div>
          <div className="conexionBotones">
            <button
              className="cbDeshacer"
              disabled={conexion.paradas.length <= 1}
              onClick={() => setConexion((c) => ({ ...c, paradas: c.paradas.slice(0, -1) }))}
            >↩ 退一站</button>
            <button className="cbCrear" onClick={terminarConexion}>
              {conexion.ideaId ? '✓ 用这条路线' : '✓ 在这里创建想法'}
            </button>
            <button className="cbCancelar" onClick={() => setConexion(null)}>✕</button>
          </div>
        </div>
      )}
      <div className="lienzo">
        {vista === 'arbol' ? (
          <ReactFlow
            nodes={rfNodosArbol}
            edges={rfEdgesArbol}
            nodeTypes={TIPOS}
            edgeTypes={TIPOS_ARISTA}
            onNodeClick={abrirNodo}
            onNodeContextMenu={menuNodo}
            onPaneClick={() => setSel('')}
            fitView
            minZoom={0.3}
            maxZoom={1.6}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable={false}
            colorMode="dark"
          >
            <Background color="#1c2530" gap={22} />
            <Controls showInteractive={false} />
          </ReactFlow>
        ) : ideas.length === 0 ? (
          <div className="ideasVacio">
            想法本还是空的。<br />
            去「功能树」里右键一个节点挂想法，或者在 Jarvis 里说「记个想法：…」。
          </div>
        ) : (
          <ReactFlow
            nodes={vistaIdeas.nodes}
            edges={vistaIdeas.edges}
            nodeTypes={TIPOS}
            onNodeClick={abrirNodo}
            onPaneClick={() => setSel('')}
            fitView
            minZoom={0.25}
            maxZoom={1.4}
            nodesDraggable={false}
            nodesConnectable={false}
            colorMode="dark"
          >
            <Background color="#1c2530" gap={22} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
        {nodoSel && <Lateral nodo={nodoSel} detalle={detalle} onCerrar={() => setSel('')} onColgarIdea={colgarIdea} onConectarDesde={conectarDesde} />}
        {ideaSel && <LateralIdea idea={ideaSel} onCerrar={() => setSel('')} onAccion={accionIdea} onColgarHija={colgarHija} onCambiarRuta={cambiarRutaDeIdea} />}
      </div>
    </div>
  );
}

createRoot(document.getElementById('raiz')).render(<App />);
