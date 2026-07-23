import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import './estilos.css';

// Panel de flujo del bot, DOS vistas (idea del dueño, 23/07):
// - 功能树: árbol de funciones (flujo.yaml) coloreado con el estado real
//   de ejecución (/api/flujo, cada 3 s).
// - 想法本: sus ideas de optimización como tarjetas (pendientes/hechas),
//   con completar/borrar/exportar vía el canal de botones del panel.
// Las dos series a propósito separadas: el árbol es la REALIDAD, las
// ideas son el deseo; cuando una idea se implementa, pasa de una a otra.

const ANCHO = 192;
const ALTO = 64;
const IDEA_W = 240;
const IDEA_H = 104;

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

// --- vista 功能树 -------------------------------------------------------

function PasoNodo({ data }) {
  return (
    <div className={`nodoPaso e-${data.estado}`}>
      <Handle type="target" position={Position.Left} className="asa" />
      <div className="nodoGrupo">{data.grupo}</div>
      <div className="nodoNombre">{data.nombre}</div>
      <div className="nodoStats">
        {data.estado === 'corriendo' ? '运行中…'
          : data.total === 0 ? '还没跑过'
          : `成功率 ${data.exito}% · 平均 ${fmtDur(data.duracionMediaMs)}`}
      </div>
      <Handle type="source" position={Position.Right} className="asa" />
    </div>
  );
}

function IdeaNodo({ data }) {
  const corto = data.texto.length > 90 ? data.texto.slice(0, 90) + '…' : data.texto;
  return (
    <div className={`nodoIdea ${data.estado === 'hecha' ? 'i-hecha' : 'i-pendiente'}`}>
      <div className="ideaCabecera">
        <span>#{data.id} · {String(data.creado).slice(5, 10).replace('-', '/')}</span>
        <span className="ideaEstado">{data.estado === 'hecha' ? '✅ 已实现' : '💡 待做'}</span>
      </div>
      <div className="ideaTexto">{corto}</div>
    </div>
  );
}

const TIPOS = { paso: PasoNodo, idea: IdeaNodo };

function calcularPosiciones(nodos, edges) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 22, ranksep: 80, marginx: 20, marginy: 20 });
  for (const n of nodos) g.setNode(n.id, { width: ANCHO, height: ALTO });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const pos = {};
  for (const n of nodos) {
    const p = g.node(n.id);
    pos[n.id] = { x: p.x - ANCHO / 2, y: p.y - ALTO / 2 };
  }
  return pos;
}

// Ideas en rejilla: pendientes arriba (nuevas primero), hechas debajo.
function posicionesIdeas(ideas) {
  const cols = 4;
  const pos = {};
  const colocar = (lista, desdeFila) => {
    lista.forEach((idea, i) => {
      pos[`idea-${idea.id}`] = {
        x: (i % cols) * (IDEA_W + 20) + 20,
        y: (desdeFila + Math.floor(i / cols)) * (IDEA_H + 18) + 20
      };
    });
    return desdeFila + Math.ceil(lista.length / cols);
  };
  const pend = ideas.filter((i) => i.estado === 'pendiente').slice().reverse();
  const hechas = ideas.filter((i) => i.estado === 'hecha').slice().reverse();
  let fila = colocar(pend, 0);
  if (hechas.length) colocar(hechas, fila + (pend.length ? 0.35 : 0));
  return pos;
}

function Lateral({ nodo, detalle, onCerrar }) {
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

function LateralIdea({ idea, onCerrar, onAccion }) {
  return (
    <aside className="lateral">
      <div className="latCabecera">
        <div>
          <div className="latGrupo">想法 #{idea.id} · {fmtHora(idea.creado)}</div>
          <div className="latNombre">{idea.estado === 'hecha' ? '✅ 已实现' : '💡 待做'}</div>
        </div>
        <button className="latCerrar" onClick={onCerrar}>✕</button>
      </div>
      <div className="latBloque">
        <pre className="ideaCompleta">{idea.texto}</pre>
      </div>
      {idea.estado === 'hecha' && idea.hecha && (
        <div className="latStats">完成于 {fmtHora(idea.hecha)}</div>
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

function App() {
  const [vista, setVista] = useState('arbol');
  const [grafo, setGrafo] = useState(null);
  const [ideas, setIdeas] = useState([]);
  const [sel, setSel] = useState('');
  const [detalle, setDetalle] = useState(null);
  const [aviso, setAviso] = useState('');
  const selRef = useRef('');
  const vistaRef = useRef('arbol');
  selRef.current = sel;
  vistaRef.current = vista;

  const refrescar = useCallback(async () => {
    try {
      const r = await fetch('/api/flujo');
      if (r.ok) setGrafo(await r.json());
      const ri = await fetch('/api/flujo/ideas');
      if (ri.ok) setIdeas((await ri.json()).ideas || []);
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

  // dagre solo cuando cambia la TOPOLOGÍA (ids/edges), no en cada poll:
  // así el grafo no "salta" mientras los nodos cambian de color.
  const claveTopo = useMemo(
    () => nodos.map((n) => n.id).join('|') + '::' + edges.map((e) => e.id).join('|'),
    [nodos, edges]
  );
  const posiciones = useMemo(() => calcularPosiciones(nodos, edges), [claveTopo]); // eslint-disable-line react-hooks/exhaustive-deps

  const corriendo = new Set(nodos.filter((n) => n.estado === 'corriendo').map((n) => n.id));
  const rfNodosArbol = nodos.map((n) => ({
    id: n.id,
    type: 'paso',
    position: posiciones[n.id] || { x: 0, y: 0 },
    data: n,
    selected: sel === n.id
  }));
  const rfEdgesArbol = edges.map((e) => ({
    ...e,
    animated: corriendo.has(e.target) || corriendo.has(e.source),
    style: { stroke: '#3d4a5c', strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#3d4a5c', width: 16, height: 16 }
  }));

  const posIdeas = useMemo(
    () => posicionesIdeas(ideas),
    [ideas.map((i) => `${i.id}:${i.estado}`).join('|')] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const rfNodosIdeas = ideas.map((i) => ({
    id: `idea-${i.id}`,
    type: 'idea',
    position: posIdeas[`idea-${i.id}`] || { x: 0, y: 0 },
    data: i,
    selected: sel === `idea-${i.id}`
  }));

  const abrirNodo = useCallback((_ev, nodo) => {
    setSel(nodo.id);
    if (vistaRef.current !== 'arbol') return;
    setDetalle(null);
    fetch(`/api/flujo/paso?id=${encodeURIComponent(nodo.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setDetalle(d); })
      .catch(() => {});
  }, []);

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
            <i className="lg ok" />成功 <i className="lg run" />运行中 <i className="lg err" />失败 <i className="lg no" />没跑过
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
      <div className="lienzo">
        {vista === 'arbol' ? (
          <ReactFlow
            nodes={rfNodosArbol}
            edges={rfEdgesArbol}
            nodeTypes={TIPOS}
            onNodeClick={abrirNodo}
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
            在 Jarvis 里说「记个想法：…」或者发 /idea 就会出现在这里。
          </div>
        ) : (
          <ReactFlow
            nodes={rfNodosIdeas}
            edges={[]}
            nodeTypes={TIPOS}
            onNodeClick={abrirNodo}
            onPaneClick={() => setSel('')}
            fitView
            minZoom={0.3}
            maxZoom={1.4}
            nodesDraggable={false}
            nodesConnectable={false}
            colorMode="dark"
          >
            <Background color="#1c2530" gap={22} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
        {nodoSel && <Lateral nodo={nodoSel} detalle={detalle} onCerrar={() => setSel('')} />}
        {ideaSel && <LateralIdea idea={ideaSel} onCerrar={() => setSel('')} onAccion={accionIdea} />}
      </div>
    </div>
  );
}

createRoot(document.getElementById('raiz')).render(<App />);
