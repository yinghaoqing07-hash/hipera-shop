import fs from 'node:fs';
import http from 'node:http';

// Panel de escritorio del bot: un mini servidor HTTP SOLO en 127.0.0.1 con
// una página de botones grandes para las acciones de cada día (imprimir la
// lista de llegada, refrescar promociones, análisis de ahorro…). Los botones
// despachan EXACTAMENTE los mismos comandos que se escribirían en Telegram
// (mismo código, mismas guardas, misma confirmación de escritura) y el
// resultado llega por Telegram como siempre — el panel es un mando a
// distancia con estado, no un segundo canal de salida. Sin dependencias:
// node:http y una página autocontenida. panel.cmd lo abre en el navegador.

export function startPanel(config, logger, hooks) {
  const port = Number(config.panel?.port) || 8765;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(renderPage());
        return;
      }
      if (req.method === 'GET' && req.url === '/status') {
        const status = await hooks.status();
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(status));
        return;
      }
      if (req.method === 'GET' && req.url.startsWith('/chat')) {
        const since = new URL(req.url, 'http://x').searchParams.get('since') || '0';
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(hooks.chat ? hooks.chat(since) : { seq: 0, messages: [] }));
        return;
      }
      if (req.method === 'POST' && req.url === '/callback') {
        const body = await readBody(req);
        let data = '';
        try { data = String(JSON.parse(body || '{}').data || '').trim(); } catch { /* json roto */ }
        if (!data) { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"ok":false}'); return; }
        logger?.info('panel callback', { data });
        const toast = hooks.callback ? await hooks.callback(data) : '';
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, toast }));
        return;
      }
      if (req.method === 'GET' && req.url.startsWith('/file/')) {
        const filePath = hooks.file ? hooks.file(req.url.slice(6)) : null;
        if (!filePath) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'content-type': filePath.toLowerCase().endsWith('.jpg') || filePath.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/png' });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
      if (req.method === 'GET' && req.url === '/comandos') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(hooks.commandList());
        return;
      }
      if (req.method === 'POST' && req.url === '/run') {
        const body = await readBody(req);
        let cmd = '';
        try { cmd = String(JSON.parse(body || '{}').cmd || '').trim(); } catch { /* json roto */ }
        if (!cmd) { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"ok":false,"error":"cmd vacio"}'); return; }
        logger?.info('panel command', { cmd });
        // No se espera al resultado (una impresión o un análisis tardan
        // minutos): se despacha y la respuesta llega por Telegram.
        hooks.dispatch(cmd).catch((error) => logger?.error('panel dispatch failed', { cmd, error: error.message }));
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('no existe');
    } catch (error) {
      logger?.error('panel request failed', { url: req.url, error: error.message });
      try { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"ok":false}'); } catch { /* ya cerrado */ }
    }
  });
  server.on('error', (error) => logger?.warn('panel server error', { error: error.message }));
  // SOLO loopback: el panel no lleva autenticación, no debe salir del PC.
  server.listen(port, '127.0.0.1', () => logger?.info('panel listening', { url: `http://127.0.0.1:${port}` }));
  return server;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 65536) { reject(new Error('body demasiado grande')); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function renderPage() {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>JARVIS</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; background: #07090c; color: #c8d3dc;
    font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
    display: flex; flex-direction: column;
    background-image: radial-gradient(ellipse 70% 45% at 50% 38%, rgba(56,189,248,.07), transparent 70%);
  }
  header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 18px 26px; font-size: 12px; letter-spacing: .18em; color: #4a5865;
  }
  #logo { color: #7dd3fc; font-weight: 600; }
  #estado { display: flex; gap: 18px; align-items: center; }
  #punto { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; display: inline-block; margin-right: 7px; vertical-align: 1px; animation: latido 2.4s ease-in-out infinite; }
  #punto.rojo { background: #ef4444; animation: none; }
  @keyframes latido { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
  main { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 0 24px 8vh; }
  #saludo { font-size: 13px; letter-spacing: .3em; color: #3d4a56; margin-bottom: 26px; text-transform: uppercase; }
  #linea {
    width: min(680px, 92vw); display: flex; align-items: center; gap: 14px;
    border-bottom: 1px solid rgba(125,211,252,.25); padding: 6px 4px 12px;
    transition: border-color .25s;
  }
  #linea:focus-within { border-color: rgba(125,211,252,.75); }
  #linea::before { content: "›"; color: #38bdf8; font-size: 26px; line-height: 1; }
  #libre {
    flex: 1; background: none; border: none; outline: none; color: #e6eef4;
    font-size: 20px; font-weight: 300; letter-spacing: .02em; caret-color: #38bdf8;
  }
  #libre::placeholder { color: #38424d; }
  #pills { margin-top: 44px; display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; max-width: 680px; }
  .pill {
    background: none; border: 1px solid rgba(200,211,220,.14); color: #8b98a5;
    border-radius: 999px; padding: 9px 18px; font-size: 14px; cursor: pointer;
    transition: all .2s;
  }
  .pill:hover { border-color: rgba(125,211,252,.6); color: #cfe9f7; }
  .pill:active { transform: scale(.97); }
  #reloj { font-size: 76px; font-weight: 200; letter-spacing: .06em; color: #dbe7ef; line-height: 1; font-variant-numeric: tabular-nums; }
  #reloj span.seg { font-size: 26px; color: #38bdf8; font-weight: 300; margin-left: 6px; }
  #fecha { margin: 12px 0 40px; font-size: 13px; letter-spacing: .28em; color: #4a5865; text-transform: uppercase; }
  #tarjetas {
    margin-top: 52px; display: grid; gap: 12px; width: min(820px, 94vw);
    grid-template-columns: 1fr 1fr 1.6fr;
  }
  @media (max-width: 700px) { #tarjetas { grid-template-columns: 1fr; } }
  .tarjeta { border: 1px solid rgba(200,211,220,.09); border-radius: 12px; padding: 14px 16px; min-height: 88px; }
  .tarjeta .titulo { font-size: 11px; letter-spacing: .25em; color: #3d4a56; margin-bottom: 9px; }
  .tarjeta .dato { font-size: 14px; color: #93a3b1; line-height: 1.65; }
  .tarjeta .dato b { color: #cfe9f7; font-weight: 500; }
  .tarjeta .dato .hora { color: #3d4a56; font-size: 12px; margin-right: 8px; font-variant-numeric: tabular-nums; }
  #charla {
    width: min(680px, 92vw); max-height: 34vh; overflow-y: auto;
    margin-bottom: 26px; display: none; scrollbar-width: thin;
    scrollbar-color: rgba(125,211,252,.2) transparent;
    -webkit-mask-image: linear-gradient(to bottom, transparent, black 24px);
  }
  #charla.con { display: block; }
  .msg { display: flex; margin: 7px 0; }
  .msg.mia { justify-content: flex-end; }
  .burbuja {
    max-width: 80%; padding: 8px 14px; border-radius: 14px;
    font-size: 14.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
    border: 1px solid rgba(200,211,220,.12); color: #a7b4c1;
  }
  .mia .burbuja { border-color: rgba(56,189,248,.4); color: #d5ecf8; border-bottom-right-radius: 4px; }
  .msg:not(.mia) .burbuja { border-bottom-left-radius: 4px; }
  .burbuja .meta { display: block; font-size: 10.5px; color: #3d4a56; letter-spacing: .1em; margin-top: 5px; }
  .burbuja img { display: block; max-width: 100%; border-radius: 8px; margin: 6px 0 2px; border: 1px solid rgba(200,211,220,.1); }
  .chipTeclado {
    display: inline-flex; align-items: center; gap: 6px; margin-top: 8px;
    background: rgba(56,189,248,.07); border: 1px solid rgba(56,189,248,.35); color: #a9dcf5;
    border-radius: 999px; padding: 5px 13px; font-size: 12.5px; cursor: pointer; letter-spacing: .08em;
  }
  .chipTeclado:hover { background: rgba(56,189,248,.16); color: #d5ecf8; }
  /* --- cajón lateral: donde viven los teclados interactivos --- */
  #cajon {
    position: fixed; top: 0; left: 0; bottom: 0; width: min(400px, 88vw);
    background: rgba(10,14,19,.97); border-right: 1px solid rgba(125,211,252,.18);
    box-shadow: 18px 0 50px rgba(0,0,0,.45);
    transform: translateX(-102%); transition: transform .28s ease;
    display: flex; flex-direction: column; z-index: 30;
  }
  #cajon.abierto { transform: translateX(0); }
  #cajon .cab {
    display: flex; justify-content: space-between; align-items: center;
    padding: 18px 20px 12px; font-size: 11px; letter-spacing: .3em; color: #4a5865;
  }
  #cajon .cab b { color: #7dd3fc; font-weight: 600; }
  #cajon .cab button {
    background: none; border: none; color: #4a5865; font-size: 18px; cursor: pointer; padding: 2px 6px;
  }
  #cajon .cab button:hover { color: #cfe9f7; }
  #cajon .cuerpo { flex: 1; overflow-y: auto; padding: 4px 20px 24px; scrollbar-width: thin; scrollbar-color: rgba(125,211,252,.2) transparent; }
  #cajon .texto { font-size: 13.5px; color: #93a3b1; line-height: 1.6; white-space: pre-wrap; margin-bottom: 14px; }
  #cajon img { max-width: 100%; border-radius: 10px; border: 1px solid rgba(200,211,220,.12); margin-bottom: 14px; display: block; }
  #cajon .filaB { display: flex; gap: 8px; margin-bottom: 8px; }
  #cajon .filaB button {
    flex: 1; background: rgba(56,189,248,.06); border: 1px solid rgba(56,189,248,.35); color: #b9e2f6;
    border-radius: 10px; padding: 13px 10px; font-size: 15px; cursor: pointer; transition: all .15s;
  }
  #cajon .filaB button:hover { background: rgba(56,189,248,.16); color: #e2f3fc; }
  #cajon .filaB button:active { transform: scale(.97); }
  #aviso {
    position: fixed; left: 50%; bottom: 34px; transform: translateX(-50%);
    color: #7dd3fc; font-size: 13px; letter-spacing: .12em;
    opacity: 0; transition: opacity .35s; pointer-events: none;
  }
  #aviso.visible { opacity: .9; }
</style>
</head>
<body>
<header>
  <span id="logo">J A R V I S</span>
  <span id="estado"><span><span id="punto"></span><span id="txtEstado">连接中</span></span></span>
</header>
<main>
  <div id="reloj">--:--</div>
  <div id="fecha">&nbsp;</div>
  <div id="saludo">需要我做什么</div>
  <div id="charla"></div>
  <div id="linea">
    <input id="libre" placeholder="打印今天的清单 · 看看153划不划算 · 香蕉改成2,99 …" autofocus>
  </div>
  <div id="pills">
    <button class="pill" onclick="run('/llegada')">打印今天清单</button>
    <button class="pill" onclick="run('/promociones')">刷新促销</button>
    <button class="pill" onclick="run('/ahorro_pedido')">PDA 省钱分析</button>
    <button class="pill" onclick="run('/pedido')">叫货提醒</button>
    <button class="pill" onclick="run('/carne')">肉类盘点</button>
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
    <div class="tarjeta ancha">
      <div class="titulo">最近动态</div>
      <div class="dato" id="tActividad">—</div>
    </div>
  </div>
</main>
<div id="cajon">
  <div class="cab"><span><b>⌨ 操作台</b></span><button onclick="cerrarCajon()" title="关闭">✕</button></div>
  <div class="cuerpo">
    <div class="texto" id="cajonTexto"></div>
    <div id="cajonFoto"></div>
    <div id="cajonBotones"></div>
  </div>
</div>
<div id="aviso"></div>
<script>
const libre = document.getElementById('libre');
libre.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && libre.value.trim()) { run(libre.value.trim()); libre.value = ''; }
});

// --- chat sincronizado con Telegram: el bot guarda la transcripción y el
// panel la va pidiendo (solo lo nuevo, por seq). Lo tecleado aquí llega a
// Telegram como eco "🖥 …", y lo del móvil aparece aquí solo.
let chatSeq = 0;
const filas = new Map(); // id → elemento .msg (para actualizar botones editados en sitio)
function pintarBurbuja(m) {
  const b = document.createElement('div');
  b.className = 'burbuja';
  const cuerpo = document.createElement('div');
  cuerpo.textContent = (m.from === 'panel' ? '🖥 ' : '') + m.text;
  b.appendChild(cuerpo);
  if (m.photo) {
    const img = document.createElement('img');
    img.src = '/file/' + m.id + '?s=' + m.seq;
    img.loading = 'lazy';
    b.appendChild(img);
  }
  if (m.buttons && m.buttons.length) {
    // Los teclados NO se pintan en la burbuja: viven en el cajón lateral.
    // El chip permite reabrir el de un mensaje antiguo.
    const chip = document.createElement('span');
    chip.className = 'chipTeclado';
    chip.textContent = '⌨ 操作台';
    chip.onclick = () => abrirCajon(m.id);
    b.appendChild(document.createElement('br'));
    b.appendChild(chip);
  }
  const meta = document.createElement('span');
  meta.className = 'meta';
  const t = new Date(m.at);
  meta.textContent = (m.from === 'bot' ? 'JARVIS' : m.from === 'panel' ? '面板' : '你') + ' · ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  b.appendChild(meta);
  return b;
}
// --- cajón lateral -------------------------------------------------------
const datos = new Map();      // id → último estado del mensaje (para re-render)
const cajonCerrados = new Set(); // teclados que el usuario cerró a mano
let cajonId = null;
function renderCajon(m) {
  document.getElementById('cajonTexto').textContent = m.text || '';
  const foto = document.getElementById('cajonFoto');
  foto.innerHTML = '';
  if (m.photo) {
    const img = document.createElement('img');
    img.src = '/file/' + m.id + '?s=' + m.seq;
    foto.appendChild(img);
  }
  const zona = document.getElementById('cajonBotones');
  zona.innerHTML = '';
  for (const fila of m.buttons || []) {
    const f = document.createElement('div');
    f.className = 'filaB';
    for (const bot of fila) {
      const btn = document.createElement('button');
      btn.textContent = bot.t;
      btn.onclick = () => pulsar(bot.d);
      f.appendChild(btn);
    }
    zona.appendChild(f);
  }
  document.getElementById('cajon').classList.add('abierto');
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

async function pulsar(data) {
  try {
    const r = await (await fetch('/callback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data }) })).json();
    if (r.toast) aviso(r.toast);
    setTimeout(pollChat, 300);
  } catch { aviso('连不上 BOT'); }
}
async function pollChat() {
  try {
    const r = await (await fetch('/chat?since=' + chatSeq)).json();
    if (r.messages && r.messages.length) {
      const caja = document.getElementById('charla');
      const pegado = caja.scrollHeight - caja.scrollTop - caja.clientHeight < 60;
      let nuevos = false;
      for (const m of r.messages) {
        chatSeq = Math.max(chatSeq, m.seq);
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
          previa.replaceChild(pintarBurbuja(m), vieja);
          continue;
        }
        const fila = document.createElement('div');
        fila.className = 'msg' + (m.from === 'bot' ? '' : ' mia');
        fila.appendChild(pintarBurbuja(m));
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
  } catch { /* bot apagado: el punto rojo ya lo dice */ }
}
pollChat();
setInterval(pollChat, 2500);
async function run(cmd) {
  try {
    const r = await fetch('/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd }) });
    aviso(r.ok ? '已收到' : '发送失败');
    setTimeout(pollChat, 350);
  } catch { aviso('连不上 BOT'); }
}
function aviso(txt) {
  const el = document.getElementById('aviso');
  el.textContent = txt;
  el.classList.add('visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visible'), 2400);
}
async function refrescar() {
  const punto = document.getElementById('punto');
  const txt = document.getElementById('txtEstado');
  try {
    const s = await (await fetch('/status')).json();
    punto.classList.remove('rojo');
    const partes = ['在线 ' + s.uptime];
    partes.push('促销 ' + (s.promoCsv || '无'));
    partes.push(s.autoRanToday ? '晨务 ✓' : '晨务 —');
    const off = [];
    if (!s.webOrder) off.push('网页');
    if (!s.desktop) off.push('桌面');
    if (!s.llm) off.push('AI');
    if (off.length) partes.push('⚠ ' + off.join('/') + '关');
    txt.textContent = partes.join('　·　');
    pintarTarjetas(s);
  } catch {
    punto.classList.add('rojo');
    txt.textContent = '离线 — 黑窗口开着吗？';
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
  const act = (s.activity || []).slice(0, 4).map((a) => {
    const t = new Date(a.at);
    const hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    return '<span class="hora">' + hh + '</span>' + escapar(a.text);
  });
  document.getElementById('tActividad').innerHTML = act.length ? act.join('<br>') : '还没有动静';
}
function escapar(x) { const d = document.createElement('div'); d.textContent = x; return d.innerHTML; }
refrescar();
setInterval(refrescar, 15000);
</script>
</body>
</html>`;
}
