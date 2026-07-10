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
<div id="aviso"></div>
<script>
const libre = document.getElementById('libre');
libre.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && libre.value.trim()) { run(libre.value.trim()); libre.value = ''; }
});
async function run(cmd) {
  try {
    const r = await fetch('/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd }) });
    aviso(r.ok ? '已收到 · 结果在 TELEGRAM' : '发送失败');
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
