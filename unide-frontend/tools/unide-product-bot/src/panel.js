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
<title>贾维斯 · 店铺面板</title>
<style>
  :root { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
  body { margin: 0; background: #f4f5f7; color: #1a1d21; }
  header { background: #1f6f43; color: #fff; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
  header h1 { margin: 0; font-size: 20px; }
  #estado { font-size: 14px; display: flex; gap: 14px; flex-wrap: wrap; }
  #estado span { background: rgba(255,255,255,.15); border-radius: 999px; padding: 3px 10px; }
  main { max-width: 860px; margin: 18px auto; padding: 0 16px 40px; }
  h2 { font-size: 15px; color: #555; margin: 22px 4px 8px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
  button { font-size: 16px; padding: 14px 12px; border: 1px solid #d5d9de; border-radius: 10px; background: #fff; cursor: pointer; text-align: left; }
  button:hover { border-color: #1f6f43; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  button:active { transform: scale(.99); }
  .fila { display: flex; gap: 8px; }
  .fila input { flex: 1; font-size: 16px; padding: 12px; border: 1px solid #d5d9de; border-radius: 10px; }
  .fila button { flex: 0 0 auto; }
  #aviso { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: #1a1d21; color: #fff; padding: 10px 18px; border-radius: 10px; opacity: 0; transition: opacity .3s; pointer-events: none; font-size: 15px; }
  #aviso.visible { opacity: .95; }
  small.pista { color: #777; display: block; margin: 4px 4px 0; }
</style>
</head>
<body>
<header>
  <h1>🤖 贾维斯 · 店铺面板</h1>
  <div id="estado">加载中…</div>
</header>
<main>
  <h2>🖨 对货清单</h2>
  <div class="grid">
    <button onclick="run('/llegada')">打印今天到货的清单</button>
  </div>
  <div class="fila" style="margin-top:8px">
    <input id="llegadaArg" placeholder="单号或名字，比如：152 153 或 carne 0807">
    <button onclick="runConArg('/llegada','llegadaArg')">按单号打印</button>
  </div>

  <h2>💶 促销 / 省钱</h2>
  <div class="grid">
    <button onclick="run('/promociones')">刷新促销数据</button>
    <button onclick="run('/ahorro_pedido')">最新 PDA 单省钱分析</button>
    <button onclick="run('/ahorro')">总体省钱策略</button>
  </div>
  <div class="fila" style="margin-top:8px">
    <input id="ahorroArg" placeholder="单号，比如：153">
    <button onclick="runConArg('/ahorro_pedido','ahorroArg')">指定单号分析</button>
  </div>

  <h2>📦 叫货</h2>
  <div class="grid">
    <button onclick="run('/pedido')">今天的叫货提醒</button>
    <button onclick="run('/carne')">开始肉类盘点</button>
  </div>

  <h2>💬 跟它说句话（AI）</h2>
  <div class="fila">
    <input id="libre" placeholder="比如：帮我把香蕉的 bloc venta 关了">
    <button onclick="runLibre()">发送</button>
  </div>
  <small class="pista">所有操作的结果都发到 Telegram，去手机上看。改价、停卖这类会动数据的操作照样要在 Telegram 里点确认。</small>
</main>
<div id="aviso"></div>
<script>
async function run(cmd) {
  try {
    const r = await fetch('/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd }) });
    aviso(r.ok ? '已发送 ✅ 结果去 Telegram 看' : '发送失败');
  } catch { aviso('发送失败：bot 可能没在运行'); }
}
function runConArg(cmd, inputId) {
  const v = document.getElementById(inputId).value.trim();
  if (!v) { aviso('先在框里填内容'); return; }
  run(cmd + ' ' + v);
  document.getElementById(inputId).value = '';
}
function runLibre() {
  const v = document.getElementById('libre').value.trim();
  if (!v) { aviso('先写点什么'); return; }
  run(v);
  document.getElementById('libre').value = '';
}
function aviso(txt) {
  const el = document.getElementById('aviso');
  el.textContent = txt;
  el.classList.add('visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visible'), 2600);
}
async function refrescar() {
  try {
    const s = await (await fetch('/status')).json();
    const partes = [];
    partes.push('🟢 bot 在线 ' + s.uptime);
    partes.push('促销数据：' + (s.promoCsv || '还没有'));
    partes.push('今日自动任务：' + (s.autoRanToday ? '已跑 ✅' : '还没跑'));
    if (!s.webOrder) partes.push('⚠️ 网页自动化关着');
    if (!s.desktop) partes.push('⚠️ 桌面自动化关着');
    if (!s.llm) partes.push('⚠️ AI 没配');
    document.getElementById('estado').innerHTML = partes.map((p) => '<span>' + p + '</span>').join('');
  } catch {
    document.getElementById('estado').innerHTML = '<span>🔴 连不上 bot（黑窗口开着吗？）</span>';
  }
}
refrescar();
setInterval(refrescar, 15000);
</script>
</body>
</html>`;
}
