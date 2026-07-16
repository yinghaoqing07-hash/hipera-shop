// Página del panel: la versión minimalista que la dueña fue puliendo
// (reloj + chat a toda altura + entrada abajo + cajón izquierdo para los
// teclados interactivos + lector derecho para informes largos), recuperada
// tras el experimento de consola multivista, y con lo nuevo integrado:
// tarjeta de tareas programadas y ciclo de actualización robusto.
export function renderPanelPage(version) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>JARVIS</title>
<style>
  :root {
    --motion-fast: 180ms;
    --motion-base: 260ms;
    --motion-slow: 360ms;
    --motion-ease: cubic-bezier(.22, 1, .36, 1);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; background: #111927; color: #d7e1ea;
    font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
    display: flex; flex-direction: column;
    background-image: radial-gradient(ellipse 70% 45% at 50% 38%, rgba(56,189,248,.12), transparent 70%);
  }
  header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 18px 26px; font-size: 12px; letter-spacing: .18em; color: #76879a;
    animation: aparecerSuave var(--motion-slow) var(--motion-ease) both;
  }
  #logo { color: #7dd3fc; font-weight: 600; }
  #estado { display: flex; gap: 18px; align-items: center; }
  #btnCajon {
    background: none; border: 1px solid rgba(125,211,252,.3); color: #97c9e3;
    border-radius: 999px; padding: 5px 16px; font-size: 11px; letter-spacing: .25em;
    cursor: pointer; font-family: inherit;
  }
  #btnCajon:hover { border-color: rgba(125,211,252,.65); color: #d5ecf8; }
  #punto { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; display: inline-block; margin-right: 7px; vertical-align: 1px; animation: latido 2.4s ease-in-out infinite; }
  #punto.rojo { background: #ef4444; animation: none; }
  /* Paso de escritorio EN VIVO (lo escribe unideges-search.ps1 antes de
     cada paso): vacío = invisible, error en rojo. */
  #vivoEsc { margin-left: 16px; color: #7dd3fc; }
  #vivoEsc:empty { display: none; }
  #vivoEsc::before {
    content: ''; display: inline-block; width: 6px; height: 6px;
    border-radius: 50%; background: #38bdf8; margin-right: 8px;
    vertical-align: 1px; animation: latido 1.1s ease-in-out infinite;
  }
  #vivoEsc.err { color: #f87171; }
  #vivoEsc.err::before { background: #f87171; animation: none; }
  #vivoEsc.cambio { animation: destelloEstado 520ms var(--motion-ease); }
  @keyframes latido { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
  main {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    padding: 0 24px 24px; min-height: 0;
    animation: subirSuave var(--motion-slow) var(--motion-ease) 70ms both;
  }
  #zona {
    flex: 1; min-height: 0; width: 100%;
    display: grid; grid-template-columns: minmax(320px, 470px) minmax(0, 1fr) minmax(300px, 400px);
    gap: 18px;
  }
  #centro { grid-column: 2; grid-row: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; align-items: center; }
  #saludo { font-size: 13px; letter-spacing: .3em; color: #5f7184; margin-bottom: 26px; text-transform: uppercase; }
  #linea {
    width: min(800px, 100%); display: flex; align-items: center; gap: 14px;
    border-bottom: 1px solid rgba(125,211,252,.25); padding: 6px 4px 12px;
    transition: border-color .25s;
  }
  #linea:focus-within { border-color: rgba(125,211,252,.75); }
  #linea::before { content: "›"; color: #38bdf8; font-size: 26px; line-height: 1; }
  #libre {
    flex: 1; background: none; border: none; outline: none; color: #e6eef4;
    font-size: 20px; font-weight: 300; letter-spacing: .02em; caret-color: #38bdf8;
  }
  #libre::placeholder { color: #53657a; }
  /* Subir archivo: discreto al final de la línea de comandos. */
  #btnSubir {
    background: none; border: none; color: rgba(125,211,252,.4); cursor: pointer;
    font-size: 22px; line-height: 1; padding: 0 2px; font-family: inherit;
  }
  #btnSubir:hover { color: #cfe9f7; }
  #pills { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
  .pill {
    background: none; border: 1px solid rgba(200,211,220,.22); color: #b6c4d1;
    border-radius: 999px; padding: 9px 18px; font-size: 14px; cursor: pointer;
    transition: all .2s;
  }
  .pill:hover { border-color: rgba(125,211,252,.6); color: #cfe9f7; }
  .pill:active { transform: scale(.97); }
  #reloj { margin-top: 2vh; font-size: 76px; font-weight: 200; letter-spacing: .06em; color: #eef5fa; line-height: 1; font-variant-numeric: tabular-nums; }
  #reloj span.seg { font-size: 26px; color: #38bdf8; font-weight: 300; margin-left: 6px; }
  #fecha { margin: 12px 0 40px; font-size: 13px; letter-spacing: .28em; color: #76879a; text-transform: uppercase; }
  #tarjetas { margin-top: 22px; display: grid; gap: 10px; grid-template-columns: 1fr; }
  #mantenimiento { margin-top: 26px; padding-top: 14px; border-top: 1px solid rgba(200,211,220,.12); display: flex; gap: 8px; }
  #cajonTeclado { display: none; }
  .tarjeta { border: 1px solid rgba(200,211,220,.16); background: rgba(148,180,205,.05); border-radius: 12px; padding: 14px 16px; min-height: 88px; }
  .tarjeta .titulo { font-size: 11px; letter-spacing: .25em; color: #5f7184; margin-bottom: 9px; }
  .tarjeta .dato { font-size: 14px; color: #aebdcb; line-height: 1.65; }
  .tarjeta .dato b { color: #cfe9f7; font-weight: 500; }
  .tarjeta .dato .hora { color: #5f7184; font-size: 12px; margin-right: 8px; font-variant-numeric: tabular-nums; }
  #charla {
    /* flex 1: el chat se estira hasta la línea de comando, pegada abajo */
    flex: 1 1 0; min-height: 0; width: min(800px, 100%); overflow-y: auto;
    margin: 8px 0 20px; scrollbar-width: thin;
    scrollbar-color: rgba(125,211,252,.2) transparent;
    -webkit-mask-image: linear-gradient(to bottom, transparent, black 24px);
  }
  .msg { display: flex; margin: 13px 0; transform-origin: left center; }
  .msg.mia { justify-content: flex-end; transform-origin: right center; }
  .msg.entrando { animation: mensajeEntra var(--motion-base) var(--motion-ease) both; }
  .msg.mia.entrando { animation-name: mensajePropioEntra; }
  .msg.saliendo { animation: mensajeSale var(--motion-fast) ease-in both; pointer-events: none; }
  .burbuja {
    max-width: 84%;
    font-size: 15.5px; line-height: 1.65; white-space: pre-wrap; word-break: break-word;
    color: #b4c2cf;
  }
  .mia .burbuja { color: #cfe9f7; text-align: right; }
  .burbuja.actualizada { animation: burbujaActualizada 460ms var(--motion-ease); }
  .textoMensaje.escribiendo::after {
    content: ''; display: inline-block; width: 1px; height: 1.05em;
    margin-left: 4px; vertical-align: -.12em; background: #38bdf8;
    animation: cursorEscritura 620ms steps(1, end) infinite;
  }
  @keyframes cursorEscritura {
    0%, 46% { opacity: .95; }
    47%, 100% { opacity: 0; }
  }
  .burbuja.esperando { display: inline-flex; align-items: center; gap: 10px; color: #7dd3fc; }
  .esperandoTexto { font-size: 11px; letter-spacing: .2em; color: #7c91a6; }
  .esperandoPuntos { display: inline-flex; gap: 5px; }
  .esperandoPuntos i {
    width: 5px; height: 5px; border-radius: 50%; background: #38bdf8;
    animation: puntoPensando 1.05s ease-in-out infinite;
  }
  .esperandoPuntos i:nth-child(2) { animation-delay: 120ms; }
  .esperandoPuntos i:nth-child(3) { animation-delay: 240ms; }
  .burbuja .meta { display: block; font-size: 10.5px; color: #53657a; letter-spacing: .14em; margin-top: 4px; }
  .chipTeclado, .chipLeer {
    display: inline-flex; align-items: center; margin: 8px 8px 0 0;
    background: none; border: 1px solid rgba(56,189,248,.4); color: #97c9e3;
    border-radius: 999px; padding: 4px 14px; font-size: 12px; cursor: pointer; letter-spacing: .12em;
    transition: transform var(--motion-fast) var(--motion-ease), border-color var(--motion-fast), color var(--motion-fast), background var(--motion-fast);
  }
  .chipTeclado:hover, .chipLeer:hover { border-color: rgba(125,211,252,.6); color: #d5ecf8; background: rgba(56,189,248,.06); transform: translateY(-1px); }
  .chipTeclado:active, .chipLeer:active { transform: translateY(0) scale(.97); }
  /* --- cajón lateral: donde viven los teclados interactivos --- */
  /* Nada de paneles que se deslizan por encima: el cajón y el lector viven
     en las columnas laterales, que siempre están ahí vacías — el contenido
     aparece en el hueco y el chat no se mueve ni se tapa. */
  #cajon {
    grid-column: 1; grid-row: 1;
    min-height: 0; display: flex; flex-direction: column;
    opacity: 0; visibility: hidden; pointer-events: none;
    transform: translateX(-14px);
    transition: opacity var(--motion-base) var(--motion-ease), transform var(--motion-base) var(--motion-ease), visibility 0s linear var(--motion-base);
  }
  #cajon.abierto {
    opacity: 1; visibility: visible; pointer-events: auto; transform: translateX(0);
    transition-delay: 0s;
  }
  #cajon .contenidoNuevo { animation: contenidoLateral var(--motion-base) var(--motion-ease) both; }
  #cajon .cab {
    display: flex; justify-content: flex-end; align-items: center;
    padding: 0 6px 2px; font-size: 11px; color: #76879a;
  }
  #cajon .cab b { color: #7dd3fc; font-weight: 600; }
  #cajon .cab button {
    background: none; border: none; color: #76879a; font-size: 18px; cursor: pointer; padding: 2px 6px;
  }
  #cajon .cab button:hover { color: #cfe9f7; }
  #cajon .cuerpo { flex: 1; overflow-y: auto; padding: 4px 6px 24px; scrollbar-width: thin; scrollbar-color: rgba(125,211,252,.2) transparent; }
  #cajon .texto { font-size: 13.5px; color: #aebdcb; line-height: 1.6; white-space: pre-wrap; margin-bottom: 14px; }
  #cajon img { max-width: 100%; border-radius: 10px; border: 1px solid rgba(200,211,220,.12); margin-bottom: 14px; display: block; }
  #cajon .filaB { display: flex; gap: 8px; margin-bottom: 8px; }
  #cajon .filaB button {
    flex: 1; min-width: 0; background: rgba(56,189,248,.06); border: 1px solid rgba(56,189,248,.35); color: #b9e2f6;
    border-radius: 10px; padding: 11px 8px; font-size: 14px; cursor: pointer; transition: all .15s;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  #cajon .filaB button:hover { background: rgba(56,189,248,.16); color: #e2f3fc; }
  #cajon .filaB button:active { transform: scale(.97); }
  #lector {
    grid-column: 3; grid-row: 1;
    min-height: 0; display: flex; flex-direction: column;
    opacity: 0; visibility: hidden; pointer-events: none;
    transform: translateX(14px);
    transition: opacity var(--motion-base) var(--motion-ease), transform var(--motion-base) var(--motion-ease), visibility 0s linear var(--motion-base);
  }
  #lector.abierto {
    opacity: 1; visibility: visible; pointer-events: auto; transform: translateX(0);
    transition-delay: 0s;
  }
  #lector .contenidoNuevo { animation: contenidoLateral var(--motion-base) var(--motion-ease) both; }
  #lector .cab {
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
    padding: 0 6px 2px; font-size: 11px; color: #76879a;
  }
  #lector .cab b { color: #7dd3fc; font-weight: 600; white-space: nowrap; }
  #lectorFoto { padding: 0 6px; }
  #lectorFoto img { max-width: 100%; border-radius: 10px; border: 1px solid rgba(200,211,220,.12); }
  #lector .cab span.titulo { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; text-align: left; letter-spacing: .1em; }
  #lector .cab button { background: none; border: none; color: #76879a; font-size: 18px; cursor: pointer; padding: 2px 6px; }
  #lector .cab button:hover { color: #cfe9f7; }
  #lector pre {
    flex: 1; overflow: auto; margin: 0; padding: 6px 6px 24px;
    font-family: Consolas, "Courier New", monospace; font-size: 13px; line-height: 1.6;
    color: #bdcad7; white-space: pre-wrap; word-break: break-word;
    scrollbar-width: thin; scrollbar-color: rgba(125,211,252,.2) transparent;
  }
  /* Registro en vivo (columna derecha): TODO lo que la automatización va
     haciendo, con hora, sin caja. Texto seleccionable para copiar; la
     flecha de abajo lo pliega. Invisible hasta que exista la primera
     línea; si el lector se abre en esa columna, el registro se aparta. */
  #registro {
    grid-column: 3; grid-row: 1; min-height: 0;
    display: flex; flex-direction: column;
  }
  #registro:not(.con) { display: none; }
  #lector.abierto ~ #registro { display: none; }
  #registroLineas {
    margin-top: auto; overflow: auto; padding: 6px 6px 4px; min-height: 0;
    font-family: Consolas, "Courier New", monospace; font-size: 12px; line-height: 1.7;
    color: #8fa2b5; white-space: pre-wrap; word-break: break-word;
    user-select: text; scrollbar-width: thin; scrollbar-color: rgba(125,211,252,.2) transparent;
  }
  #registroLineas > div { transform-origin: right bottom; }
  #registroLineas > div.lineaNueva { animation: lineaRegistroEntra var(--motion-base) var(--motion-ease) both; }
  #registroLineas .err { color: #f87171; }
  #registroLineas .hora { color: #566b80; margin-right: 8px; }
  #registro.oculto #registroLineas { display: none; }
  #registroBtn {
    background: none; border: none; color: rgba(125,211,252,.4); cursor: pointer;
    font-size: 13px; padding: 2px 0 4px; align-self: center; letter-spacing: .2em;
  }
  #registroBtn:hover { color: #cfe9f7; }
  /* Plegado, la flecha se queda abajo (donde el dueño la espera). */
  #registro.oculto #registroBtn { margin-top: auto; }
  #aviso {
    position: fixed; left: 50%; bottom: 34px; transform: translate(-50%, 8px);
    color: #7dd3fc; font-size: 13px; letter-spacing: .12em;
    opacity: 0; transition: opacity var(--motion-base) ease, transform var(--motion-base) var(--motion-ease); pointer-events: none;
  }
  #aviso.visible { opacity: .9; transform: translate(-50%, 0); }
  #ver { position: fixed; right: 16px; bottom: 10px; font-size: 10px; letter-spacing: .12em; color: rgba(125,211,252,.45); pointer-events: none; }
  @keyframes aparecerSuave {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes subirSuave {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes mensajeEntra {
    from { opacity: 0; transform: translate(-10px, 5px) scale(.985); }
    to { opacity: 1; transform: translate(0, 0) scale(1); }
  }
  @keyframes mensajePropioEntra {
    from { opacity: 0; transform: translate(10px, 5px) scale(.985); }
    to { opacity: 1; transform: translate(0, 0) scale(1); }
  }
  @keyframes mensajeSale {
    to { opacity: 0; transform: translateY(-5px) scale(.98); }
  }
  @keyframes burbujaActualizada {
    0% { opacity: .58; transform: translateY(3px); }
    45% { color: #d8f2ff; }
    100% { opacity: 1; transform: translateY(0); }
  }
  @keyframes puntoPensando {
    0%, 70%, 100% { opacity: .25; transform: translateY(0); }
    35% { opacity: 1; transform: translateY(-3px); }
  }
  @keyframes contenidoLateral {
    from { opacity: 0; transform: translateY(5px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes lineaRegistroEntra {
    from { opacity: 0; transform: translateY(5px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes destelloEstado {
    0% { opacity: .35; filter: brightness(.8); }
    45% { opacity: 1; filter: brightness(1.45); }
    100% { opacity: 1; filter: brightness(1); }
  }
</style>
</head>
<body>
<header>
  <span id="logo">J A R V I S</span>
  <span id="estado"><button id="btnCajon" onclick="abrirCajonInicio()">操 作 台</button><span><span id="punto"></span><span id="txtEstado">连接中</span><span id="vivoEsc"></span></span></span>
</header>
<main>
  <div id="zona">
    <div id="cajon">
  <div class="cab"><button onclick="cerrarCajon()" title="关闭">✕</button></div>
  <div class="cuerpo">
    <div id="cajonInicio">
      <div id="pills">
        <button class="pill" onclick="run('/llegada')">打印今天清单</button>
        <button class="pill" onclick="run('/promociones')">刷新促销</button>
        <button class="pill" onclick="run('/ahorro_pedido')">PDA 省钱分析</button>
        <button class="pill" onclick="run('/pedido')">叫货提醒</button>
        <button class="pill" onclick="run('/carne')">肉类盘点</button>
        <button class="pill" onclick="run('/fruta')">果蔬盘点</button>
        <button class="pill" onclick="run('/ahorro')">总体省钱策略</button>
      </div>
      <div id="tarjetas">
        <div class="tarjeta">
          <div class="titulo">今日</div>
          <div class="dato" id="tHoy">—</div>
        </div>
        <div class="tarjeta">
          <div class="titulo">促销</div>
          <div class="dato" id="tPromo">—</div>
        </div>
        <div class="tarjeta ancha" id="tTareasCard" style="display:none">
          <div class="titulo">定时任务</div>
          <div class="dato" id="tTareas">—</div>
        </div>
        <div class="tarjeta ancha">
          <div class="titulo">最近动态</div>
          <div class="dato" id="tActividad">—</div>
        </div>
      </div>
      <div id="mantenimiento">
        <button class="pill" onclick="admin('update')">更新 BOT</button>
      </div>
    </div>
    <div id="cajonTeclado">
      <div class="texto" id="cajonTexto"></div>
      <div id="cajonFoto"></div>
      <div id="cajonBotones"></div>
    </div>
  </div>
    </div>
    <div id="centro">
      <div id="reloj">--:--</div>
      <div id="fecha">&nbsp;</div>
      <div id="saludo">需要我做什么</div>
      <div id="charla"></div>
      <div id="linea">
        <input id="libre" autofocus>
        <button id="btnSubir" title="上传文件（也可以直接拖进窗口）">＋</button>
        <input type="file" id="ficheroSubir" accept=".xlsx,.csv" style="display:none">
      </div>
    </div>
    <div id="lector">
      <div class="cab"><span class="titulo" id="lectorTitulo"></span><button onclick="cerrarLector()" title="关闭">✕</button></div>
      <div id="lectorFoto"></div>
      <pre id="lectorTexto"></pre>
    </div>
    <div id="registro">
      <div id="registroLineas"></div>
      <button id="registroBtn" onclick="plegarRegistro()" title="收起/展开">︿</button>
    </div>
  </div>
</main>
<div id="aviso"></div>
<div id="ver">${version}</div>
<script>
const libre = document.getElementById('libre');
libre.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && libre.value.trim()) { run(libre.value.trim()); libre.value = ''; }
});

// --- chat sincronizado con Telegram: el bot guarda la transcripción y el
// panel la va pidiendo (solo lo nuevo, por seq). Lo tecleado aquí llega a
// Telegram como eco "🖥 …", y lo del móvil aparece aquí solo.
let chatSeq = 0;
let cargaInicial = true;
let pensandoFila = null;
let pensandoTimer = 0;

function relanzarAnimacion(el, clase) {
  if (!el) return;
  el.classList.remove(clase);
  void el.offsetWidth;
  el.classList.add(clase);
}
function animarContenido(el) {
  relanzarAnimacion(el, 'contenidoNuevo');
}
function mostrarPensando() {
  if (pensandoFila) return;
  const caja = document.getElementById('charla');
  const fila = document.createElement('div');
  fila.className = 'msg entrando';
  fila.dataset.transitorio = 'pensando';
  const b = document.createElement('div');
  b.className = 'burbuja esperando';
  const nombre = document.createElement('span');
  nombre.className = 'esperandoTexto';
  nombre.textContent = 'JARVIS';
  const puntos = document.createElement('span');
  puntos.className = 'esperandoPuntos';
  for (let i = 0; i < 3; i++) puntos.appendChild(document.createElement('i'));
  b.appendChild(nombre);
  b.appendChild(puntos);
  fila.appendChild(b);
  caja.appendChild(fila);
  pensandoFila = fila;
  caja.scrollTop = caja.scrollHeight;
  clearTimeout(pensandoTimer);
  pensandoTimer = setTimeout(() => ocultarPensando(), 120000);
}
function ocultarPensando(inmediato = false) {
  clearTimeout(pensandoTimer);
  if (!pensandoFila) return;
  const fila = pensandoFila;
  pensandoFila = null;
  if (inmediato) { fila.remove(); return; }
  fila.classList.remove('entrando');
  fila.classList.add('saliendo');
  setTimeout(() => fila.remove(), 190);
}

const filas = new Map(); // id → elemento .msg (para actualizar botones editados en sitio)
// El panel es sobrio: los emojis de los mensajes (pensados para Telegram)
// se filtran solo en la VISUALIZACION; en Telegram y en el registro siguen.
function sinEmoji(s) {
  return String(s || '').replace(/[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{2300}-\\u{23FF}\\u{FE0F}\\u{200D}]/gu, '').replace(/  +/g, ' ').replace(/^ +/gm, '').trim();
}
// El CSV de promociones (pensado para Excel) es ilegible en crudo: el lector
// lo convierte en una lista agrupada por promoción, con precio de oferta,
// precio anterior y condiciones. Cualquier otro archivo se muestra tal cual.
function trocearCsv(texto) {
  const tabla = []; let fila = []; let campo = ''; let dentro = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentro) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else { dentro = false; } }
      else { campo += c; }
    } else if (c === '"') { dentro = true; }
    else if (c === ';') { fila.push(campo); campo = ''; }
    else if (c === '\\n') { fila.push(campo); tabla.push(fila); fila = []; campo = ''; }
    else if (c !== '\\r') { campo += c; }
  }
  if (campo !== '' || fila.length) { fila.push(campo); tabla.push(fila); }
  return tabla;
}
function csvLegible(texto) {
  const tabla = trocearCsv(texto);
  if (tabla.length < 2) return null;
  const cab = tabla[0].map((s) => s.trim().toLowerCase());
  const col = (n) => cab.indexOf(n);
  const iCod = col('codigo_promocion');
  const iNom = col('promocion'), iD = col('desde_promocion'), iH = col('hasta_promocion');
  const iArt = col('descripcion_articulo'), iPvp = col('pvp'), iOf = col('oferta'), iTx = col('texto_oferta');
  if (iCod < 0 || iArt < 0) return null;
  const grupos = new Map();
  for (const f of tabla.slice(1)) {
    if (f.length < 6) continue;
    const k = f[iCod] + '|' + (f[iNom] || '');
    if (!grupos.has(k)) grupos.set(k, { nombre: (f[iNom] || f[iCod] || '').trim(), desde: (f[iD] || '').trim(), hasta: (f[iH] || '').trim(), arts: [] });
    grupos.get(k).arts.push(f);
  }
  // Muchas campañas (NOVEDAD/STOCK semanal, sobre todo fruta) llevan el
  // MISMO precio en PVD y PVD Promoción: no hay rebaja, es el precio de la
  // semana. Señalarlo evita leerlo como si fuera un descuento.
  const aNum = (s) => parseFloat(String(s || '').replace(/[^0-9,.]/g, '').replace(',', '.'));
  const L = ['共 ' + grupos.size + ' 个促销活动', ''];
  for (const g of grupos.values()) {
    L.push('◆ ' + g.nombre + (g.desde ? '　（' + g.desde + ' → ' + g.hasta + '）' : ''));
    for (const f of g.arts) {
      let precio = (f[iOf] || '').trim();
      if (precio && precio.indexOf('€') < 0) precio = precio.replace(/(,\\d\\d)0$/, '$1') + ' €';
      const antes = (f[iPvp] || '').trim().replace(/(,\\d\\d)0(\\s*€)/, '$1$2');
      const sinRebaja = antes && Number.isFinite(aNum(precio)) && Math.abs(aNum(precio) - aNum(antes)) < 0.0005;
      L.push('　· ' + (f[iArt] || '').trim() + '　→ ' + precio + (sinRebaja ? '（本周价，无折扣）' : antes ? '（原价 ' + antes + '）' : ''));
      const tx = (f[iTx] || '').trim();
      if (tx && !sinRebaja) L.push('　　' + tx.toLowerCase());
    }
    L.push('');
  }
  return L.join('\\n');
}
function escribirTexto(el, texto) {
  // OJO: nada de prefers-reduced-motion aquí. El PC de la tienda tiene las
  // animaciones de Windows desactivadas y ese respeto tan educado dejaba el
  // panel completamente estático — el dueño QUIERE el movimiento.
  const contenido = String(texto || '');
  if (!contenido) { el.textContent = contenido; return; }
  el.textContent = '';
  el.classList.add('escribiendo');
  const duracion = Math.min(1050, Math.max(260, contenido.length * 13));
  const inicio = performance.now();
  const avanzar = (ahora) => {
    const progreso = Math.min(1, (ahora - inicio) / duracion);
    const visibles = Math.min(contenido.length, Math.max(1, Math.ceil(progreso * contenido.length)));
    el.textContent = contenido.slice(0, visibles);
    if (visibles < contenido.length) requestAnimationFrame(avanzar);
    else el.classList.remove('escribiendo');
  };
  requestAnimationFrame(avanzar);
}
function pintarBurbuja(m, { escribir = false } = {}) {
  const b = document.createElement('div');
  b.className = 'burbuja';
  const cuerpo = document.createElement('div');
  cuerpo.className = 'textoMensaje';
  // Los mensajes de teclado NUNCA enseñan su plantilla en el chat: frase de
  // la IA si llegó (resumen), y si no una fija — las instrucciones completas
  // viven junto a los botones, en la columna izquierda.
  const textoBruto = String(m.text || '');
  const esTeclado = m.buttons && m.buttons.length;
  const tecladoLargo = esTeclado && (textoBruto.length > 30 || textoBruto.split('\\n').length > 1);
  const completo = sinEmoji(m.resumen ? m.resumen : (tecladoLargo ? '操作面板已在左侧打开，按提示点就行。' : textoBruto));
  const esLargo = completo.length > 380 || completo.split('\\n').length > 8;
  let textoVisible = completo;
  if (esLargo) {
    // Los informes largos no llenan el chat: recorte + "展开" en el lector.
    const lineas = completo.split('\\n').slice(0, 4).join('\\n');
    textoVisible = (lineas.length > 380 ? lineas.slice(0, 380) : lineas) + ' …';
  }
  if (escribir) escribirTexto(cuerpo, textoVisible);
  else cuerpo.textContent = textoVisible;
  b.appendChild(cuerpo);
  const chips = document.createElement('div');
  if (esLargo) {
    const chip = document.createElement('span');
    chip.className = 'chipLeer';
    chip.textContent = '展开阅读';
    chip.onclick = () => abrirLector(sinEmoji(m.text).split('\\n')[0].slice(0, 40), sinEmoji(m.text));
    chips.appendChild(chip);
  }
  if (m.doc) {
    const nombreDoc = String(m.docName || '');
    // Los volcados .html/.zip no se pueden leer en el lector: para esos
    // solo tiene sentido descargarlos (p. ej. para mandarlos a Claude).
    const esLegible = !nombreDoc || /\.(csv|txt|log|json)$/i.test(nombreDoc);
    if (esLegible) {
      const chip = document.createElement('span');
      chip.className = 'chipLeer';
      chip.textContent = '打开文件';
      chip.onclick = async () => {
        try {
          const r = await fetch('/file/' + m.id);
          if (!r.ok) { aviso('文件已不在（可能重启后被清理）'); return; }
          const crudo = await r.text();
          abrirLector(sinEmoji(m.text).slice(0, 40), csvLegible(crudo) || crudo);
        } catch { aviso('连不上 BOT'); }
      };
      chips.appendChild(chip);
    }
    const chipD = document.createElement('span');
    chipD.className = 'chipLeer';
    chipD.textContent = '下载';
    chipD.onclick = () => {
      const a = document.createElement('a');
      a.href = '/file/' + m.id + '?dl=1&s=' + m.seq;
      a.download = nombreDoc || 'archivo';
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    chips.appendChild(chipD);
  }
  if (m.photo && !(m.buttons && m.buttons.length)) {
    // Las capturas no se incrustan en el chat: se abren en el lector. Las de
    // tarjetas con botones ya se ven en el cajón de operaciones.
    const chip = document.createElement('span');
    chip.className = 'chipLeer';
    chip.textContent = '查看截图';
    chip.onclick = () => abrirLector(sinEmoji(m.text).slice(0, 40), '', '/file/' + m.id + '?s=' + m.seq);
    chips.appendChild(chip);
  }
  if (m.buttons && m.buttons.length) {
    // Los teclados NO se pintan en la burbuja: viven en el cajón lateral.
    const chip = document.createElement('span');
    chip.className = 'chipTeclado';
    chip.textContent = '操作台';
    chip.onclick = () => abrirCajon(m.id);
    chips.appendChild(chip);
  }
  if (chips.children.length) b.appendChild(chips);
  const meta = document.createElement('span');
  meta.className = 'meta';
  const t = new Date(m.at);
  meta.textContent = (m.from === 'bot' ? 'JARVIS' : m.from === 'panel' ? '面板' : '你') + ' · ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  b.appendChild(meta);
  return b;
}
// --- lector (cajón derecho para contenido largo) ---------------------------
function abrirLector(titulo, texto, fotoUrl) {
  document.getElementById('lectorTitulo').textContent = titulo || '';
  document.getElementById('lectorTexto').textContent = texto || '';
  const foto = document.getElementById('lectorFoto');
  foto.innerHTML = '';
  if (fotoUrl) {
    const img = document.createElement('img');
    img.src = fotoUrl;
    foto.appendChild(img);
  }
  document.getElementById('lector').classList.add('abierto');
  animarContenido(document.getElementById('lectorTexto'));
  animarContenido(foto);
}
function cerrarLector() { document.getElementById('lector').classList.remove('abierto'); }

// --- cajón lateral -------------------------------------------------------
const datos = new Map();      // id → último estado del mensaje (para re-render)
const cajonCerrados = new Set(); // teclados que el usuario cerró a mano
let cajonId = null;
function renderCajon(m) {
  document.getElementById('cajonInicio').style.display = 'none';
  document.getElementById('cajonTeclado').style.display = 'block';
  document.getElementById('cajonTexto').textContent = sinEmoji(m.text);
  const foto = document.getElementById('cajonFoto');
  foto.innerHTML = '';
  if (m.photo) {
    const img = document.createElement('img');
    img.src = '/file/' + m.id + '?s=' + m.seq;
    foto.appendChild(img);
  }
  const zona = document.getElementById('cajonBotones');
  zona.innerHTML = '';
  // Los teclados de lista (un boton por fila en Telegram) se reempaquetan a
  // DOS por fila; las filas que ya traen varios botones no se tocan.
  const filas = [];
  let sueltos = [];
  const volcar = () => {
    for (let i = 0; i < sueltos.length; i += 2) filas.push(sueltos.slice(i, i + 2));
    sueltos = [];
  };
  for (const fila of m.buttons || []) {
    if (fila.length === 1) sueltos.push(fila[0]);
    else { volcar(); filas.push(fila); }
  }
  volcar();
  for (const fila of filas) {
    const f = document.createElement('div');
    f.className = 'filaB';
    for (const bot of fila) {
      const btn = document.createElement('button');
      btn.textContent = sinEmoji(bot.t) || bot.t;
      btn.onclick = () => pulsar(bot.d);
      f.appendChild(btn);
    }
    zona.appendChild(f);
  }
  document.getElementById('cajon').classList.add('abierto');
  animarContenido(document.getElementById('cajonTeclado'));
}
function abrirCajon(id) {
  const m = datos.get(id);
  if (!m) return;
  cajonCerrados.delete(id);
  cajonId = id;
  renderCajon(m);
}
function cerrarCajon() {
  if (cajonId != null) cajonCerrados.add(cajonId);
  document.getElementById('cajon').classList.remove('abierto');
}
// Vista por defecto del cajón: los accesos rápidos y las tarjetas de estado
// (antes vivían en el centro de la página; el chat necesitaba el sitio).
function abrirCajonInicio() {
  cajonId = null;
  document.getElementById('cajonTeclado').style.display = 'none';
  document.getElementById('cajonInicio').style.display = 'block';
  document.getElementById('cajon').classList.add('abierto');
  animarContenido(document.getElementById('cajonInicio'));
}

// Mantenimiento desde el panel: actualizar el bot sin tocar ningun script.
// Para apagarlo basta cerrar la ventana (la X): el bot se apaga solo.
// Ciclo de la actualización, con feedback real de principio a fin:
//   1. se marca actualizando y el estado pasa a "正在更新…" (polling rápido)
//   2. el bot cae (fase de instalación) — el estado lo dice, no "离线"
//   3. vuelve: si /status trae otra versión, la página se recarga sola y
//      tras recargar enseña "更新完成"; si vuelve con la MISMA versión,
//      se avisa de que no ha cambiado nada.
let actualizando = 0;   // timestamp del clic, 0 = no estamos actualizando
let vioCaida = false;   // ya pasó por la fase "bot apagado"
let hechoVisto = 0;     // cuándo apareció "hecho:" sin que el bot reiniciara
let caidaDesde = 0;     // desde cuándo lleva el bot sin responder
async function admin(accion) {
  if (!confirm('现在后台更新 BOT？更新期间面板会断开一两分钟，完成后自己恢复。')) return;
  try {
    const r = await (await fetch('/admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion }) })).json();
    if (r.toast) aviso(r.toast);
    if (accion === 'update') { actualizando = Date.now(); vioCaida = false; hechoVisto = 0; caidaDesde = 0; refrescar(); }
  } catch { aviso('连不上 BOT'); }
}
// La X de la ventana apaga el bot: beacon de despedida al cerrarse la página.
// Una recarga también lo manda, pero la página vuelve al instante y el bot
// cancela el apagado (margen de 3 s en el servidor).
addEventListener('pagehide', () => {
  try { navigator.sendBeacon('/admin', new Blob([JSON.stringify({ accion: 'adios' })], { type: 'application/json' })); } catch { }
});
async function pulsar(data) {
  // Cancelar recoge el cajón al instante, sin esperar la vuelta del bot.
  if (String(data).indexOf('cancel:') === 0) cerrarCajon();
  mostrarPensando();
  try {
    const r = await (await fetch('/callback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data }) })).json();
    if (r.toast) aviso(r.toast);
    setTimeout(pollChat, 300);
  } catch { ocultarPensando(); aviso('连不上 BOT'); }
}
function plegarRegistro() {
  const reg = document.getElementById('registro');
  const btn = document.getElementById('registroBtn');
  const oculto = reg.classList.toggle('oculto');
  btn.textContent = oculto ? '﹀' : '︿';
  try { localStorage.setItem('registroPlegado', oculto ? '1' : ''); } catch (e) { }
}
try {
  if (localStorage.getItem('registroPlegado')) {
    document.getElementById('registro').classList.add('oculto');
    document.getElementById('registroBtn').textContent = '﹀';
  }
} catch (e) { }
// Subida de archivos al bot (hoy: el export de /diagnostico_productos).
// Botón ＋ de la línea de comandos o arrastrar el archivo a la ventana.
document.getElementById('btnSubir').onclick = () => document.getElementById('ficheroSubir').click();
document.getElementById('ficheroSubir').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) subirArchivo(f);
  e.target.value = '';
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) subirArchivo(f);
});
async function subirArchivo(f) {
  if (f.size > 30 * 1024 * 1024) { aviso('文件太大（上限 30MB）'); return; }
  mostrarPensando();
  try {
    const r = await (await fetch('/subir', { method: 'POST', headers: { 'x-nombre': encodeURIComponent(f.name) }, body: f })).json();
    aviso(r.toast || (r.ok ? '已上传' : '上传失败'));
    if (!r.ok) ocultarPensando();
    setTimeout(pollChat, 350);
  } catch { ocultarPensando(); aviso('连不上 BOT'); }
}
async function pollChat() {
  try {
    const r = await (await fetch('/chat?since=' + chatSeq)).json();
    // Paso de escritorio en vivo: viaja con este poll (2,5 s) porque el de
    // /status es demasiado lento (15 s) para ver pasos de 1-2 segundos.
    const vivo = document.getElementById('vivoEsc');
    if (vivo) {
      const dl = r.desktopLive;
      let t = '';
      if (dl && dl.line) {
        if (dl.line.indexOf('ERROR') >= 0) { if (dl.ageSec < 120) t = dl.line.slice(0, 110); }
        else if (dl.line.indexOf('listo') >= 0) { if (dl.ageSec < 8) t = dl.line.slice(0, 40); }
        else if (dl.ageSec < 60) t = dl.line.slice(0, 110);
      }
      if (vivo.textContent !== t) {
        vivo.textContent = t;
        if (t) relanzarAnimacion(vivo, 'cambio');
      }
      vivo.classList.toggle('err', t.indexOf('ERROR') >= 0);
    }
    const reg = document.getElementById('registro');
    if (reg && Array.isArray(r.liveLog) && r.liveLog.length) {
      reg.classList.add('con');
      const cont = document.getElementById('registroLineas');
      const clave = r.liveLog.length + '|' + r.liveLog[r.liveLog.length - 1].t;
      if (cont && cont.dataset.clave !== clave) {
        cont.dataset.clave = clave;
        const pegado = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 40;
        const clavesAnteriores = new Set(Array.from(cont.children).map((el) => el.dataset.claveLinea).filter(Boolean));
        const habiaLineas = cont.children.length > 0;
        cont.textContent = '';
        for (const e of r.liveLog) {
          const div = document.createElement('div');
          const claveLinea = String(e.t) + '|' + String(e.line);
          div.dataset.claveLinea = claveLinea;
          if (String(e.line).indexOf('ERROR') >= 0) div.classList.add('err');
          if (habiaLineas && !clavesAnteriores.has(claveLinea)) div.classList.add('lineaNueva');
          const hora = document.createElement('span');
          hora.className = 'hora';
          const d = new Date(e.t);
          hora.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
          div.appendChild(hora);
          div.appendChild(document.createTextNode(String(e.line)));
          cont.appendChild(div);
        }
        if (pegado || !cont.dataset.visto) { cont.scrollTop = cont.scrollHeight; cont.dataset.visto = '1'; }
      }
    }
    if (r.messages && r.messages.length) {
      const caja = document.getElementById('charla');
      const pegado = caja.scrollHeight - caja.scrollTop - caja.clientHeight < 60;
      let nuevos = false;
      for (const m of r.messages) {
        chatSeq = Math.max(chatSeq, m.seq);
        if (m.from === 'bot') ocultarPensando();
        if (m.cierraCajon) cerrarCajon();
        if (m.buttons && m.buttons.length) {
          datos.set(m.id, m);
          if (!cajonCerrados.has(m.id) && (cajonId == null || m.seq >= (datos.get(cajonId)?.seq || 0) || m.id === cajonId)) {
            cajonId = m.id;
            renderCajon(m);
          } else if (m.id === cajonId) {
            renderCajon(m);
          }
        }
        const previa = filas.get(m.id);
        if (previa) {
          // Entrada editada (teclado del recuento, etc.): refrescar en sitio.
          const vieja = previa.querySelector('.burbuja');
          const nueva = pintarBurbuja(m);
          nueva.classList.add('actualizada');
          previa.replaceChild(nueva, vieja);
          continue;
        }
        const fila = document.createElement('div');
        fila.className = 'msg' + (m.from === 'bot' ? '' : ' mia') + (!cargaInicial ? ' entrando' : '');
        fila.appendChild(pintarBurbuja(m, { escribir: !cargaInicial && m.from === 'bot' }));
        caja.appendChild(fila);
        filas.set(m.id, fila);
        nuevos = true;
      }
      while (caja.children.length > 120) {
        const primero = caja.firstChild;
        for (const [id, el] of filas) if (el === primero) filas.delete(id);
        caja.removeChild(primero);
      }
      caja.classList.add('con');
      if (pegado && nuevos) caja.scrollTop = caja.scrollHeight;
    }
    cargaInicial = false;
  } catch { /* bot apagado: el punto rojo ya lo dice */ }
}
pollChat();
setInterval(pollChat, 2500);
async function run(cmd) {
  if (/^(取消|算了|不要|不用了?|no|cancelar?)$/i.test(String(cmd).trim())) cerrarCajon();
  mostrarPensando();
  try {
    const r = await fetch('/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd }) });
    aviso(r.ok ? '已收到' : '发送失败');
    if (!r.ok) ocultarPensando();
    setTimeout(pollChat, 350);
  } catch { ocultarPensando(); aviso('连不上 BOT'); }
}
function aviso(txt) {
  const el = document.getElementById('aviso');
  el.textContent = txt;
  el.classList.add('visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visible'), 2400);
}
const VERSION_PAGINA = '${version}';
let bootVisto = null; // arranque del bot visto en el último /status
async function refrescar() {
  const punto = document.getElementById('punto');
  const txt = document.getElementById('txtEstado');
  try {
    const s = await (await fetch('/status')).json();
    // Versión del servidor distinta de la de esta página = el bot ya corre
    // código nuevo: recargar para estrenar la interfaz nueva. El aviso de
    // "hecho" se enseña tras la recarga (sessionStorage sobrevive a ella).
    if (s.version && VERSION_PAGINA && s.version !== VERSION_PAGINA) {
      try { sessionStorage.setItem('jarvisActualizado', s.version); } catch { }
      location.reload();
      return;
    }
    // El bot se ha REINICIADO (boot nuevo) pero la versión es la misma: la
    // actualización terminó sin traer nada nuevo. Marcador duro — funciona
    // aunque el corte fuera tan corto que ningún poll lo pillara.
    if (actualizando && bootVisto && s.boot && s.boot !== bootVisto) {
      actualizando = 0;
      aviso('更新跑完了，但版本没变 — 可能本来就是最新');
    } else if (actualizando && s.updateLine && s.updateLine.indexOf('ERROR') === 0) {
      // El updater dejó escrito el motivo del fallo: enseñarlo tal cual.
      actualizando = 0;
      aviso('更新失败 — ' + s.updateLine.slice(0, 90));
    } else if (actualizando && s.updateLine && s.updateLine.indexOf('hecho') === 0) {
      // "hecho" pero el bot sigue siendo el MISMO proceso (boot igual):
      // el reinicio no cuajó. Darle medio minuto y avisar con el remedio.
      if (!hechoVisto) hechoVisto = Date.now();
      else if (Date.now() - hechoVisto > 30000) {
        actualizando = 0;
        aviso('装完了但 bot 没重启成 — 跑一下 stop-bot.cmd 再开 panel.cmd');
      }
    } else if (actualizando && Date.now() - actualizando > 300000) {
      actualizando = 0;
      aviso('更新超时 — 看一眼 logs/update-estado.txt 或跑 start-bot.cmd');
    }
    if (s.boot) bootVisto = s.boot;
    caidaDesde = 0;
    punto.classList.remove('rojo');
    const partes = ['在线 ' + s.uptime];
    partes.push('促销 ' + (s.promoCsv || '无'));
    partes.push(s.autoRanToday ? '晨务 已办' : '晨务 —');
    const off = [];
    if (!s.webOrder) off.push('网页');
    if (!s.desktop) off.push('桌面');
    if (!s.llm) off.push('AI');
    if (off.length) partes.push(off.join('/') + ' 关');
    // Mientras se actualiza, la línea real del updater (de su log) es el
    // mejor indicador de por dónde va; si aún no hay, un genérico.
    if (actualizando) partes.unshift('正在更新：' + (s.updateLine || '启动更新器…'));
    txt.textContent = partes.join('　·　');
    pintarTarjetas(s);
  } catch {
    punto.classList.add('rojo');
    if (!caidaDesde) caidaDesde = Date.now();
    if (actualizando) {
      vioCaida = true;
      // La instalación normal tarda segundos; si el bot lleva minutos sin
      // volver, algo se torció — decir la verdad y el remedio.
      txt.textContent = Date.now() - caidaDesde > 180000
        ? '更新后 bot 一直没回来 — 去电脑上双击 panel.cmd 或 start-bot.cmd'
        : '正在更新（安装中，面板马上自己回来）…';
    } else {
      txt.textContent = '离线 — 黑窗口开着吗？';
    }
  }
}
function tic() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  document.getElementById('reloj').innerHTML = hh + ':' + mm + '<span class="seg">' + ss + '</span>';
  const dias = ['周日','周一','周二','周三','周四','周五','周六'];
  document.getElementById('fecha').textContent = d.getFullYear() + ' / ' + String(d.getMonth() + 1).padStart(2, '0') + ' / ' + String(d.getDate()).padStart(2, '0') + '　' + dias[d.getDay()];
  const h = d.getHours();
  document.getElementById('saludo').textContent = (h < 6 ? '夜深了' : h < 12 ? '早上好' : h < 20 ? '下午好' : '晚上好') + '，需要我做什么';
}
tic();
setInterval(tic, 1000);
function pintarTarjetas(s) {
  document.getElementById('tHoy').innerHTML =
    '预计到货 <b>' + (s.arrivingToday ?? 0) + '</b> 单<br>晨务 ' + (s.autoRanToday ? '<b>已完成</b>' : '还没跑');
  if (s.promoStats) {
    document.getElementById('tPromo').innerHTML =
      '<b>' + s.promoStats.promos + '</b> 个活动 · <b>' + s.promoStats.items + '</b> 个商品<br>今明到期 <b>' + s.promoStats.endingSoon + '</b> 个' + (s.promoCsv ? '<br>数据：' + s.promoCsv : '');
  } else {
    document.getElementById('tPromo').textContent = '还没有促销数据，点「刷新促销」';
  }
  const tareas = Array.isArray(s.scheduledTasks) ? s.scheduledTasks : [];
  const tarjetaTareas = document.getElementById('tTareasCard');
  tarjetaTareas.style.display = tareas.length ? '' : 'none';
  const contTareas = document.getElementById('tTareas');
  contTareas.innerHTML = '';
  tareas.slice(0, 6).forEach((t) => {
    const fila = document.createElement('div');
    const hora = document.createElement('span');
    hora.className = 'hora';
    const d = new Date(t.runAt);
    hora.textContent = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const nombre = document.createElement('span');
    nombre.textContent = ' ' + (t.label || t.command || '定时任务') + ' ';
    const quitar = document.createElement('button');
    quitar.textContent = '×';
    quitar.title = '取消任务';
    quitar.style.cssText = 'background:none;border:1px solid rgba(200,211,220,.25);border-radius:6px;color:#8195a7;cursor:pointer;margin-left:6px;padding:0 7px;';
    quitar.onclick = async () => {
      try {
        const r = await (await fetch('/task/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: t.id }) })).json();
        aviso(r.toast || '已取消');
        refrescar();
      } catch { aviso('连不上 BOT'); }
    };
    fila.append(hora, nombre, quitar);
    contTareas.appendChild(fila);
  });
  const act = (s.activity || []).slice(0, 4).map((a) => {
    const t = new Date(a.at);
    const hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    return '<span class="hora">' + hh + '</span>' + escapar(a.text);
  });
  document.getElementById('tActividad').innerHTML = act.length ? act.join('<br>') : '还没有动静';
}
function escapar(x) { const d = document.createElement('div'); d.textContent = x; return d.innerHTML; }
refrescar();
// Polling adaptativo: cada 15 s en reposo, cada 3 s mientras se actualiza
// (para pillar el momento en que el bot vuelve con la versión nueva).
(function cicloEstado() {
  setTimeout(async () => { await refrescar(); cicloEstado(); }, actualizando ? 3000 : 15000);
})();
// Aviso post-recarga: la actualización terminó y ESTA página ya es la nueva.
try {
  if (sessionStorage.getItem('jarvisActualizado')) {
    sessionStorage.removeItem('jarvisActualizado');
    aviso('更新完成，现在是 ' + (VERSION_PAGINA || '新版本'));
  }
} catch { }
</script>
</body>
</html>`;
}
