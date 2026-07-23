import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import './estilos.css';

// Panel de flujo del bot: árbol de funciones (flujo.yaml) coloreado con el
// estado real de ejecución (/api/flujo, cada 3 s). Clic en un nodo → barra
// lateral con historial, capturas y el último error completo.

const ANCHO = 192;
const ALTO = 64;

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

const TIPOS = { paso: PasoNodo };

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

function App() {
  const [grafo, setGrafo] = useState(null);
  const [sel, setSel] = useState('');
  const [detalle, setDetalle] = useState(null);
  const selRef = useRef('');
  selRef.current = sel;

  const refrescar = useCallback(async () => {
    try {
      const r = await fetch('/api/flujo');
      if (r.ok) setGrafo(await r.json());
      const id = selRef.current;
      if (id) {
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

  const nodos = grafo?.nodos || [];
  const edges = grafo?.edges || [];

  // dagre solo cuando cambia la TOPOLOGÍA (ids/edges), no en cada poll:
  // así el grafo no "salta" mientras los nodos cambian de color.
  const claveTopo = useMemo(
    () => nodos.map((n) => n.id).join('|') + '::' + edges.map((e) => e.id).join('|'),
    [nodos, edges]
  );
  const posiciones = useMemo(() => calcularPosiciones(nodos, edges), [claveTopo]); // eslint-disable-line react-hooks/exhaustive-deps

  const rfNodos = nodos.map((n) => ({
    id: n.id,
    type: 'paso',
    position: posiciones[n.id] || { x: 0, y: 0 },
    data: n,
    selected: sel === n.id
  }));
  const corriendo = new Set(nodos.filter((n) => n.estado === 'corriendo').map((n) => n.id));
  const rfEdges = edges.map((e) => ({
    ...e,
    animated: corriendo.has(e.target) || corriendo.has(e.source),
    style: { stroke: '#3d4a5c', strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#3d4a5c', width: 16, height: 16 }
  }));

  const abrirNodo = useCallback((_ev, nodo) => {
    setSel(nodo.id);
    setDetalle(null);
    fetch(`/api/flujo/paso?id=${encodeURIComponent(nodo.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setDetalle(d); })
      .catch(() => {});
  }, []);

  const nodoSel = nodos.find((n) => n.id === sel);

  return (
    <div className="pantalla">
      <header className="barra">
        <span className="titulo">流程图 · JARVIS</span>
        <span className="pastilla">{grafo ? (grafo.motor === 'sqlite' ? 'SQLite' : 'NDJSON') : '…'}</span>
        <span className="leyenda">
          <i className="lg ok" />成功 <i className="lg run" />运行中 <i className="lg err" />失败 <i className="lg no" />没跑过
        </span>
        <span className="hueco" />
        <a className="volver" href="/">[ 返回面板 ]</a>
      </header>
      {grafo?.error && <div className="aviso">{grafo.error}</div>}
      <div className="lienzo">
        <ReactFlow
          nodes={rfNodos}
          edges={rfEdges}
          nodeTypes={TIPOS}
          onNodeClick={abrirNodo}
          onPaneClick={() => setSel('')}
          fitView
          minZoom={0.3}
          maxZoom={1.6}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          proOptions={{ hideAttribution: false }}
          colorMode="dark"
        >
          <Background color="#1c2530" gap={22} />
          <Controls showInteractive={false} />
        </ReactFlow>
        {nodoSel && <Lateral nodo={nodoSel} detalle={detalle} onCerrar={() => setSel('')} />}
      </div>
    </div>
  );
}

createRoot(document.getElementById('raiz')).render(<App />);
