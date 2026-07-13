function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderPanelPage(version = '') {
  const safeVersion = escapeHtml(version);
  const versionJson = JSON.stringify(String(version || ''));
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>JARVIS 店务工作台</title>
<style>
  :root {
    color-scheme: light;
    --ink: #192126;
    --muted: #69747c;
    --line: #dce2e5;
    --canvas: #f2f4f5;
    --surface: #ffffff;
    --rail: #171b1d;
    --rail-muted: #8d989f;
    --teal: #0f766e;
    --teal-soft: #dff1ee;
    --amber: #b45309;
    --amber-soft: #fff0d7;
    --red: #b42318;
    --red-soft: #fee8e7;
    --blue: #2563a8;
    --shadow: 0 18px 45px rgba(26, 34, 39, .13);
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body {
    min-width: 320px;
    background: var(--canvas);
    color: var(--ink);
    font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif;
    font-size: 14px;
    letter-spacing: 0;
  }
  button, input { font: inherit; letter-spacing: 0; }
  button { cursor: pointer; }
  .shell {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 224px minmax(0, 1fr);
  }
  .rail {
    position: sticky;
    top: 0;
    height: 100vh;
    padding: 24px 18px 18px;
    display: flex;
    flex-direction: column;
    gap: 24px;
    background: var(--rail);
    color: #eef2f3;
  }
  .brand { display: flex; align-items: center; gap: 11px; min-width: 0; }
  .brand-mark {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border: 1px solid rgba(255,255,255,.3);
    color: #75d5c9;
    font-weight: 700;
    font-size: 17px;
  }
  .brand-name { font-size: 15px; font-weight: 700; letter-spacing: .16em; }
  .brand-sub { margin-top: 3px; color: var(--rail-muted); font-size: 11px; }
  .rail-status {
    padding: 13px 0;
    border-top: 1px solid rgba(255,255,255,.1);
    border-bottom: 1px solid rgba(255,255,255,.1);
  }
  .connection { display: flex; align-items: center; gap: 9px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #e0a31a; box-shadow: 0 0 0 3px rgba(224,163,26,.14); }
  .dot.online { background: #34b79d; box-shadow: 0 0 0 3px rgba(52,183,157,.14); }
  .dot.offline { background: #df5b52; box-shadow: 0 0 0 3px rgba(223,91,82,.14); }
  #connectionText { font-size: 12px; color: #c7d0d4; }
  .rail-meta { margin-top: 8px; color: var(--rail-muted); font-size: 11px; line-height: 1.5; }
  .rail-nav { display: grid; gap: 5px; }
  .rail-nav button {
    width: 100%;
    min-height: 38px;
    display: flex;
    align-items: center;
    gap: 11px;
    border: 0;
    border-left: 2px solid transparent;
    padding: 0 10px;
    background: transparent;
    color: #aeb8bd;
    text-align: left;
  }
  .rail-nav button:hover, .rail-nav button.active { color: #fff; background: rgba(255,255,255,.06); border-left-color: #65c5b9; }
  .nav-symbol { width: 18px; color: #65c5b9; font-weight: 700; text-align: center; }
  .rail-footer { margin-top: auto; display: grid; gap: 10px; }
  .update-button {
    min-height: 40px;
    border: 1px solid rgba(255,255,255,.2);
    background: transparent;
    color: #e9eff1;
    font-weight: 600;
  }
  .update-button:hover { border-color: #65c5b9; color: #7fe0d4; }
  .update-button:disabled { opacity: .45; cursor: wait; }
  .version { color: #66747b; font-size: 10px; overflow-wrap: anywhere; }
  .workspace { min-width: 0; padding: 0 30px 28px; }
  .topbar {
    min-height: 92px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    border-bottom: 1px solid var(--line);
  }
  .eyebrow { margin: 0 0 6px; color: var(--teal); font-size: 10px; font-weight: 700; letter-spacing: .2em; }
  h1 { margin: 0; font-size: 24px; line-height: 1.2; font-weight: 660; }
  .clock { display: flex; align-items: baseline; gap: 12px; white-space: nowrap; }
  #clockTime { font-size: 28px; font-weight: 650; font-variant-numeric: tabular-nums; }
  #clockDate { color: var(--muted); font-size: 12px; }
  .metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-bottom: 1px solid var(--line);
  }
  .metric { min-width: 0; padding: 18px 20px 17px 0; }
  .metric + .metric { padding-left: 20px; border-left: 1px solid var(--line); }
  .metric-label { color: var(--muted); font-size: 11px; }
  .metric-value { margin-top: 7px; font-size: 24px; line-height: 1; font-weight: 650; font-variant-numeric: tabular-nums; }
  .metric-note { margin-top: 7px; color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .content {
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(480px, 1.7fr) minmax(310px, .8fr);
    gap: 24px;
    padding-top: 24px;
  }
  .conversation {
    min-width: 0;
    height: calc(100vh - 222px);
    min-height: 540px;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 6px;
  }
  .section-head {
    min-height: 57px;
    padding: 0 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 1px solid var(--line);
  }
  .section-title { margin: 0; font-size: 14px; font-weight: 650; }
  .section-kicker { margin-top: 3px; color: var(--muted); font-size: 10px; }
  .sync-label { color: var(--muted); font-size: 11px; }
  .transcript { min-height: 0; overflow: auto; padding: 8px 18px; scroll-behavior: smooth; }
  .empty-chat { padding: 46px 16px; text-align: center; color: var(--muted); }
  .message {
    position: relative;
    padding: 14px 10px 14px 15px;
    border-bottom: 1px solid #edf0f1;
  }
  .message:last-child { border-bottom: 0; }
  .message::before { content: ""; position: absolute; left: 0; top: 17px; bottom: 17px; width: 3px; background: #66b9af; }
  .message.user::before, .message.panel::before { background: #e3a33a; }
  .message.user, .message.panel { background: #fbfcfc; }
  .message-meta { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 7px; }
  .message-author { color: var(--teal); font-size: 11px; font-weight: 700; letter-spacing: .08em; }
  .message.user .message-author, .message.panel .message-author { color: var(--amber); }
  .message-time { color: #929da3; font-size: 10px; font-variant-numeric: tabular-nums; }
  .message-body { color: #283238; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
  .message-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 11px; }
  .message-actions button, .attachment {
    min-height: 32px;
    border: 1px solid #cfd8dc;
    border-radius: 5px;
    padding: 0 11px;
    background: #fff;
    color: #35434a;
  }
  .message-actions button:hover, .attachment:hover { border-color: var(--teal); color: var(--teal); }
  .message-actions button:disabled { opacity: .45; cursor: wait; }
  .attachment { margin-top: 10px; display: inline-flex; align-items: center; gap: 8px; }
  .thumb { display: block; margin-top: 10px; width: min(300px, 100%); border: 1px solid var(--line); cursor: zoom-in; }
  .composer {
    min-height: 66px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 11px 13px;
    border-top: 1px solid var(--line);
    background: #fafbfb;
  }
  .composer input {
    width: 100%;
    height: 42px;
    border: 1px solid #cfd7db;
    border-radius: 5px;
    padding: 0 13px;
    background: #fff;
    color: var(--ink);
    outline: none;
  }
  .composer input:focus { border-color: var(--teal); box-shadow: 0 0 0 2px rgba(15,118,110,.1); }
  .send {
    width: 42px;
    height: 42px;
    border: 0;
    border-radius: 5px;
    background: var(--teal);
    color: #fff;
    font-size: 18px;
  }
  .send:hover { background: #0b625c; }
  .operations { min-width: 0; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; }
  .ops-section { padding: 17px 18px; border-bottom: 1px solid var(--line); }
  .ops-section:last-child { border-bottom: 0; }
  .ops-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 13px; }
  .ops-title h2 { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .08em; }
  .ops-title span { color: var(--muted); font-size: 10px; }
  .action-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .action-grid button {
    min-height: 43px;
    border: 1px solid #d5dcdf;
    border-radius: 5px;
    padding: 6px 9px;
    background: #fff;
    color: #29343a;
    text-align: left;
    font-size: 12px;
    font-weight: 600;
  }
  .action-grid button:hover { border-color: var(--teal); background: var(--teal-soft); color: #0b625c; }
  .task-list, .activity-list, .system-list { display: grid; gap: 0; }
  .task-row {
    display: grid;
    grid-template-columns: 58px minmax(0, 1fr) 30px;
    gap: 8px;
    align-items: center;
    min-height: 42px;
    border-bottom: 1px solid #edf0f1;
  }
  .task-row:last-child { border-bottom: 0; }
  .task-time { color: var(--teal); font-size: 11px; font-variant-numeric: tabular-nums; }
  .task-name { min-width: 0; font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
  .icon-button { width: 30px; height: 30px; border: 0; background: transparent; color: #89949a; font-size: 18px; }
  .icon-button:hover { color: var(--red); background: var(--red-soft); }
  .activity-row { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 8px; padding: 6px 0; font-size: 11px; line-height: 1.4; }
  .activity-time { color: #919ca2; font-variant-numeric: tabular-nums; }
  .system-row { min-height: 31px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .system-name { color: var(--muted); font-size: 11px; }
  .system-state { display: inline-flex; align-items: center; gap: 6px; color: #344148; font-size: 11px; font-weight: 600; }
  .state-dot { width: 6px; height: 6px; border-radius: 50%; background: #a6afb4; }
  .state-dot.ok { background: #20a287; }
  .state-dot.warn { background: #d58a16; }
  .empty { padding: 8px 0; color: var(--muted); font-size: 11px; line-height: 1.5; }
  .modal {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: none;
    place-items: center;
    padding: 24px;
    background: rgba(18, 23, 26, .58);
  }
  .modal.open { display: grid; }
  .modal-window {
    width: min(980px, 100%);
    max-height: calc(100vh - 48px);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    overflow: hidden;
    background: #fff;
    border-radius: 6px;
    box-shadow: var(--shadow);
  }
  .modal-head { min-height: 54px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 0 16px; border-bottom: 1px solid var(--line); }
  .modal-title { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 650; }
  .modal-close { width: 34px; height: 34px; border: 0; background: transparent; color: #657178; font-size: 22px; }
  .modal-close:hover { color: var(--ink); background: #eef1f2; }
  .modal-content { min-height: 0; overflow: auto; padding: 18px; }
  .modal-content img { display: block; max-width: 100%; margin: 0 auto; }
  .modal-content pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: "Cascadia Mono", Consolas, monospace; font-size: 12px; line-height: 1.55; }
  .file-table { width: max-content; min-width: 100%; border-collapse: collapse; font-size: 11px; }
  .file-table th, .file-table td { max-width: 340px; padding: 7px 9px; border: 1px solid #dfe4e7; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  .file-table th { position: sticky; top: -18px; background: #edf3f2; color: #26343a; }
  .toast {
    position: fixed;
    left: 50%;
    bottom: 24px;
    z-index: 30;
    transform: translate(-50%, 12px);
    padding: 10px 14px;
    border-radius: 5px;
    background: #1c2428;
    color: #fff;
    box-shadow: var(--shadow);
    opacity: 0;
    pointer-events: none;
    transition: opacity .18s, transform .18s;
  }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }
  @media (max-width: 1080px) {
    .shell { grid-template-columns: 76px minmax(0, 1fr); }
    .rail { padding: 20px 12px; align-items: center; }
    .brand-copy, .rail-status, .nav-label, .version { display: none; }
    .rail-nav button { width: 44px; justify-content: center; padding: 0; border-left: 0; border-bottom: 2px solid transparent; }
    .rail-nav button:hover, .rail-nav button.active { border-left-color: transparent; border-bottom-color: #65c5b9; }
    .nav-symbol { width: auto; }
    .update-button { width: 44px; padding: 0; font-size: 0; }
    .update-button::after { content: "↻"; font-size: 20px; }
    .workspace { padding-left: 22px; padding-right: 22px; }
    .content { grid-template-columns: minmax(430px, 1.45fr) minmax(280px, .8fr); gap: 16px; }
  }
  @media (max-width: 820px) {
    .shell { display: block; }
    .rail { position: static; width: 100%; height: 58px; padding: 0 14px; flex-direction: row; justify-content: space-between; }
    .brand-mark { width: 30px; height: 30px; }
    .brand-copy { display: block; }
    .brand-sub, .rail-status { display: none; }
    .rail-nav { display: flex; margin-left: auto; }
    .rail-nav button { min-height: 38px; }
    .rail-footer { margin: 0; }
    .workspace { padding: 0 14px 18px; }
    .topbar { min-height: 78px; }
    h1 { font-size: 20px; }
    #clockTime { font-size: 22px; }
    #clockDate { display: none; }
    .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .metric:nth-child(3) { border-left: 0; }
    .metric:nth-child(n+3) { border-top: 1px solid var(--line); }
    .content { grid-template-columns: 1fr; }
    .conversation { height: 620px; min-height: 0; }
    .operations { order: -1; }
  }
  @media (max-width: 520px) {
    .brand-name { font-size: 12px; }
    .rail-nav button:nth-child(n+3) { display: none; }
    .topbar { gap: 10px; }
    .eyebrow { display: none; }
    .metric { padding: 14px 10px 13px 0; }
    .metric + .metric { padding-left: 10px; }
    .metric-value { font-size: 20px; }
    .content { padding-top: 14px; gap: 14px; }
    .conversation { height: 560px; }
    .transcript { padding-left: 10px; padding-right: 10px; }
    .section-head { padding: 0 13px; }
    .modal { padding: 10px; }
    .modal-window { max-height: calc(100vh - 20px); }
  }
</style>
</head>
<body>
<div class="shell">
  <aside class="rail">
    <div class="brand">
      <div class="brand-mark">J</div>
      <div class="brand-copy">
        <div class="brand-name">JARVIS</div>
        <div class="brand-sub">UNIDE 店务系统</div>
      </div>
    </div>
    <div class="rail-status">
      <div class="connection"><span class="dot" id="connectionDot"></span><span id="connectionText">正在连接</span></div>
      <div class="rail-meta" id="railMeta">等待 Bot 状态</div>
    </div>
    <nav class="rail-nav" aria-label="页面导航">
      <button class="active" onclick="jumpTo('overview')" title="概览"><span class="nav-symbol">⌂</span><span class="nav-label">概览</span></button>
      <button onclick="jumpTo('conversation')" title="对话"><span class="nav-symbol">◫</span><span class="nav-label">对话</span></button>
      <button onclick="jumpTo('taskSection')" title="任务"><span class="nav-symbol">✓</span><span class="nav-label">任务</span></button>
      <button onclick="jumpTo('systemSection')" title="系统"><span class="nav-symbol">●</span><span class="nav-label">系统</span></button>
    </nav>
    <div class="rail-footer">
      <button class="update-button" id="updateButton" onclick="runAdmin('update')" title="更新 BOT">更新 BOT</button>
      <div class="version">${safeVersion}</div>
    </div>
  </aside>

  <div class="workspace" id="overview">
    <header class="topbar">
      <div>
        <p class="eyebrow">UNIDE OPERATIONS</p>
        <h1>店务工作台</h1>
      </div>
      <div class="clock"><span id="clockTime">--:--</span><span id="clockDate">—</span></div>
    </header>

    <section class="metrics" aria-label="今日概览">
      <div class="metric"><div class="metric-label">预计到货</div><div class="metric-value" id="metricArrival">—</div><div class="metric-note" id="metricArrivalNote">等待读取</div></div>
      <div class="metric"><div class="metric-label">有效促销商品</div><div class="metric-value" id="metricPromo">—</div><div class="metric-note" id="metricPromoNote">等待读取</div></div>
      <div class="metric"><div class="metric-label">待执行任务</div><div class="metric-value" id="metricTasks">—</div><div class="metric-note" id="metricTaskNote">没有任务</div></div>
      <div class="metric"><div class="metric-label">已记录改价</div><div class="metric-value" id="metricPrices">—</div><div class="metric-note" id="metricPriceNote">持久账本</div></div>
    </section>

    <div class="content">
      <section class="conversation" id="conversation">
        <div class="section-head">
          <div><h2 class="section-title">JARVIS 对话</h2><div class="section-kicker">Telegram 与店内面板同步</div></div>
          <span class="sync-label" id="syncLabel">同步中</span>
        </div>
        <div class="transcript" id="chat"><div class="empty-chat" id="emptyChat">最近的对话会显示在这里</div></div>
        <form class="composer" id="composer">
          <input id="commandInput" autocomplete="off" placeholder="输入任务、问题或命令">
          <button class="send" type="submit" title="发送">›</button>
        </form>
      </section>

      <aside class="operations">
        <section class="ops-section">
          <div class="ops-title"><h2>快捷操作</h2><span>常用</span></div>
          <div class="action-grid">
            <button onclick="runCommand('/carne')">肉类盘点</button>
            <button onclick="runCommand('/pedido')">叫货提醒</button>
            <button onclick="runCommand('/llegada')">打印到货清单</button>
            <button onclick="runCommand('/pedidos 3')">最近三张订单</button>
            <button onclick="runCommand('/promociones')">刷新促销</button>
            <button onclick="runCommand('/ahorro_pedido')">PDA 省钱分析</button>
          </div>
        </section>
        <section class="ops-section" id="taskSection">
          <div class="ops-title"><h2>定时任务</h2><span id="taskCount">0 项</span></div>
          <div class="task-list" id="taskList"><div class="empty">还没有待执行任务</div></div>
        </section>
        <section class="ops-section">
          <div class="ops-title"><h2>最近动态</h2><span>本次运行</span></div>
          <div class="activity-list" id="activityList"><div class="empty">还没有操作记录</div></div>
        </section>
        <section class="ops-section" id="systemSection">
          <div class="ops-title"><h2>系统状态</h2><span id="uptime">—</span></div>
          <div class="system-list">
            <div class="system-row"><span class="system-name">订单网页</span><span class="system-state"><i class="state-dot" id="stateWeb"></i><span id="stateWebText">—</span></span></div>
            <div class="system-row"><span class="system-name">桌面自动化</span><span class="system-state"><i class="state-dot" id="stateDesktop"></i><span id="stateDesktopText">—</span></span></div>
            <div class="system-row"><span class="system-name">AI 回复</span><span class="system-state"><i class="state-dot" id="stateLlm"></i><span id="stateLlmText">—</span></span></div>
            <div class="system-row"><span class="system-name">长期记忆</span><span class="system-state"><i class="state-dot ok"></i><span id="stateMemory">—</span></span></div>
          </div>
        </section>
      </aside>
    </div>
  </div>
</div>

<div class="modal" id="readerModal" role="dialog" aria-modal="true" aria-labelledby="readerTitle">
  <div class="modal-window">
    <div class="modal-head"><div class="modal-title" id="readerTitle">内容</div><button class="modal-close" onclick="closeReader()" title="关闭">×</button></div>
    <div class="modal-content" id="readerContent"></div>
  </div>
</div>
<div class="toast" id="toast"></div>

<script>
const VERSION_PAGINA = ${versionJson};
const chatElement = document.getElementById('chat');
const messageRows = new Map();
let chatSeq = 0;
let bootSeen = null;
let updating = false;
let updateStartedAt = 0; // clic en 更新 BOT (para el timeout)
let offlineSince = 0;    // desde cuando no responde /status
let toastTimer = null;

// El panel es sobrio: los emojis de los mensajes (pensados para Telegram)
// se filtran solo en la VISUALIZACION; en Telegram y el registro siguen.
function sinEmoji(value) {
  return String(value == null ? '' : value)
    .replace(/[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{2300}-\\u{23FF}\\u{FE0F}\\u{200D}]/gu, '')
    .replace(/  +/g, ' ').replace(/^ +/gm, '').trim();
}

// El CSV de promociones (pensado para Excel) es ilegible en crudo: se
// agrupa por promocion con precio oferta, precio normal y condiciones.
// Cuando ambos precios coinciden (NOVEDAD/STOCK semanal) se marca como
// precio de la semana. Otros CSV caen a la tabla generica.
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
  const cab = tabla[0].map(function (x) { return x.trim().toLowerCase(); });
  const col = function (n) { return cab.indexOf(n); };
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
  const aNum = function (x) { return parseFloat(String(x || '').replace(/[^0-9,.]/g, '').replace(',', '.')); };
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

function escapeText(value) {
  const div = document.createElement('div');
  div.textContent = String(value == null ? '' : value);
  return div.innerHTML;
}

function showToast(text) {
  const el = document.getElementById('toast');
  el.textContent = String(text || '完成');
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
}

function jumpTo(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('clockTime').textContent = hh + ':' + mm;
  const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
  document.getElementById('clockDate').textContent = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0') + '/' + String(now.getDate()).padStart(2, '0') + ' ' + weekdays[now.getDay()];
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

function formatTaskTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return String(date.getDate()).padStart(2, '0') + '/' + String(date.getMonth() + 1).padStart(2, '0') + ' ' + formatTime(value);
}

async function runCommand(command) {
  try {
    const response = await fetch('/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: command }) });
    showToast(response.ok ? '任务已交给 Bot' : '发送失败');
    setTimeout(pollChat, 300);
  } catch {
    showToast('Bot 当前没有连接');
  }
}

document.getElementById('composer').addEventListener('submit', function (event) {
  event.preventDefault();
  const input = document.getElementById('commandInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  runCommand(text);
});

function authorFor(message) {
  if (message.from === 'bot') return 'JARVIS';
  if (message.from === 'panel') return '店内面板';
  return '你';
}

function renderButtons(message, container) {
  if (!Array.isArray(message.buttons) || !message.buttons.length) return;
  const actions = document.createElement('div');
  actions.className = 'message-actions';
  message.buttons.flat().forEach(function (button) {
    if (!button || !button.t || !button.d) return;
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = sinEmoji(button.t) || button.t;
    el.addEventListener('click', async function () {
      el.disabled = true;
      try {
        const response = await fetch('/callback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: button.d }) });
        const data = await response.json();
        showToast(data.toast || (response.ok ? '已执行' : '执行失败'));
        setTimeout(pollChat, 250);
      } catch {
        showToast('Bot 当前没有连接');
      } finally {
        setTimeout(function () { el.disabled = false; }, 600);
      }
    });
    actions.appendChild(el);
  });
  if (actions.children.length) container.appendChild(actions);
}

function renderAttachment(message, container) {
  if (message.photo) {
    const img = document.createElement('img');
    img.className = 'thumb';
    img.src = '/file/' + message.id + '?s=' + message.seq;
    img.alt = '操作截图';
    img.addEventListener('click', function () { openImage(message.id, message.seq, message.text || '操作截图'); });
    container.appendChild(img);
  }
  if (message.doc) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'attachment';
    button.textContent = '打开文件';
    button.addEventListener('click', function () { openDocument(message.id, message.seq, message.text || '文件'); });
    container.appendChild(button);
  }
}

function renderMessage(message) {
  let row = messageRows.get(message.id);
  if (!row) {
    row = document.createElement('article');
    messageRows.set(message.id, row);
    chatElement.appendChild(row);
  }
  row.className = 'message ' + (message.from === 'bot' ? 'assistant' : message.from === 'panel' ? 'panel' : 'user');
  row.replaceChildren();
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const author = document.createElement('span');
  author.className = 'message-author';
  author.textContent = authorFor(message);
  const time = document.createElement('time');
  time.className = 'message-time';
  time.textContent = formatTime(message.at);
  meta.append(author, time);
  const body = document.createElement('div');
  body.className = 'message-body';
  body.textContent = sinEmoji(message.text || '');
  row.append(meta, body);
  renderAttachment(message, row);
  renderButtons(message, row);
}

async function pollChat() {
  try {
    const response = await fetch('/chat?since=' + chatSeq, { cache: 'no-store' });
    const data = await response.json();
    const wasNearBottom = chatElement.scrollHeight - chatElement.scrollTop - chatElement.clientHeight < 90;
    if (Array.isArray(data.messages)) data.messages.forEach(renderMessage);
    chatSeq = Math.max(chatSeq, Number(data.seq) || 0);
    const empty = document.getElementById('emptyChat');
    if (empty && messageRows.size) empty.remove();
    if (wasNearBottom && data.messages && data.messages.length) chatElement.scrollTop = chatElement.scrollHeight;
    document.getElementById('syncLabel').textContent = '已同步';
  } catch {
    document.getElementById('syncLabel').textContent = '同步暂停';
  }
}

function openReader(title) {
  document.getElementById('readerTitle').textContent = sinEmoji(title || '内容') || '内容';
  document.getElementById('readerContent').replaceChildren();
  document.getElementById('readerModal').classList.add('open');
}

function closeReader() {
  document.getElementById('readerModal').classList.remove('open');
  document.getElementById('readerContent').replaceChildren();
}

function openImage(id, seq, title) {
  openReader(title || '操作截图');
  const img = document.createElement('img');
  img.src = '/file/' + id + '?s=' + seq;
  img.alt = title || '操作截图';
  document.getElementById('readerContent').appendChild(img);
}

function parseDelimited(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ';') { row.push(field); field = ''; }
    else if (char === '\\n') { row.push(field.replace(/\\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(function (item) { return item.some(function (cell) { return cell.trim(); }); });
}

function renderTable(rows, target) {
  const table = document.createElement('table');
  table.className = 'file-table';
  rows.slice(0, 400).forEach(function (row, index) {
    const tr = document.createElement('tr');
    row.forEach(function (cell) {
      const el = document.createElement(index === 0 ? 'th' : 'td');
      el.textContent = cell;
      tr.appendChild(el);
    });
    table.appendChild(tr);
  });
  target.appendChild(table);
}

async function openDocument(id, seq, title) {
  openReader(title || '文件');
  const target = document.getElementById('readerContent');
  target.textContent = '正在读取…';
  try {
    const response = await fetch('/file/' + id + '?s=' + seq, { cache: 'no-store' });
    const text = await response.text();
    target.replaceChildren();
    const amable = csvLegible(text);
    const first = text.split(/\\r?\\n/, 1)[0] || '';
    if (amable) {
      const pre = document.createElement('pre');
      pre.textContent = amable;
      target.appendChild(pre);
    } else if ((first.match(/;/g) || []).length >= 2) renderTable(parseDelimited(text), target);
    else {
      const pre = document.createElement('pre');
      pre.textContent = text;
      target.appendChild(pre);
    }
  } catch {
    target.textContent = '文件读取失败';
  }
}

document.getElementById('readerModal').addEventListener('click', function (event) {
  if (event.target === event.currentTarget) closeReader();
});
document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeReader(); });

async function cancelTask(id) {
  try {
    const response = await fetch('/task/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id }) });
    const data = await response.json();
    showToast(data.toast || (response.ok ? '任务已取消' : '取消失败'));
    if (response.ok) refreshStatus();
  } catch {
    showToast('Bot 当前没有连接');
  }
}

function setSystem(id, enabled, yesText, noText) {
  const dot = document.getElementById(id);
  const text = document.getElementById(id + 'Text');
  dot.className = 'state-dot ' + (enabled ? 'ok' : 'warn');
  text.textContent = enabled ? yesText : noText;
}

function paintStatus(status) {
  document.getElementById('metricArrival').textContent = status.arrivingToday == null ? '—' : status.arrivingToday;
  document.getElementById('metricArrivalNote').textContent = status.arrivingToday ? '今天需要核对' : '今天暂无记录';
  document.getElementById('metricPromo').textContent = status.promoStats ? status.promoStats.items : '—';
  document.getElementById('metricPromoNote').textContent = status.promoStats
    ? status.promoStats.promos + ' 个活动 · 今明到期 ' + status.promoStats.endingSoon
    : '还没有促销数据';
  const tasks = Array.isArray(status.scheduledTasks) ? status.scheduledTasks : [];
  document.getElementById('metricTasks').textContent = tasks.length;
  document.getElementById('metricTaskNote').textContent = tasks.length ? '下一项 ' + formatTaskTime(tasks[0].runAt) : '没有待执行任务';
  document.getElementById('metricPrices').textContent = status.successfulPriceChanges == null ? '—' : status.successfulPriceChanges;
  document.getElementById('metricPriceNote').textContent = '共 ' + (status.operations == null ? 0 : status.operations) + ' 条操作记录';
  document.getElementById('taskCount').textContent = tasks.length + ' 项';
  const taskList = document.getElementById('taskList');
  taskList.replaceChildren();
  if (!tasks.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '还没有待执行任务';
    taskList.appendChild(empty);
  } else tasks.slice(0, 8).forEach(function (task) {
    const row = document.createElement('div');
    row.className = 'task-row';
    const time = document.createElement('span');
    time.className = 'task-time';
    time.textContent = formatTaskTime(task.runAt);
    const name = document.createElement('span');
    name.className = 'task-name';
    name.textContent = task.label || task.command || '定时任务';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'icon-button';
    cancel.title = '取消任务';
    cancel.textContent = '×';
    cancel.addEventListener('click', function () { cancelTask(task.id); });
    row.append(time, name, cancel);
    taskList.appendChild(row);
  });
  const activity = Array.isArray(status.activity) ? status.activity.slice(0, 5) : [];
  const activityList = document.getElementById('activityList');
  activityList.replaceChildren();
  if (!activity.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '还没有操作记录';
    activityList.appendChild(empty);
  } else activity.forEach(function (item) {
    const row = document.createElement('div');
    row.className = 'activity-row';
    const time = document.createElement('span');
    time.className = 'activity-time';
    time.textContent = formatTime(item.at);
    const text = document.createElement('span');
    text.textContent = item.text || '';
    row.append(time, text);
    activityList.appendChild(row);
  });
  setSystem('stateWeb', Boolean(status.webOrder), '已连接', '未启用');
  setSystem('stateDesktop', Boolean(status.desktop), '已启用', '未启用');
  setSystem('stateLlm', Boolean(status.llm), '可用', '未配置');
  document.getElementById('stateMemory').textContent = (status.memories == null ? 0 : status.memories) + ' 条';
  document.getElementById('uptime').textContent = '运行 ' + (status.uptime || '—');
  document.getElementById('railMeta').textContent = '运行 ' + (status.uptime || '—') + ' · ' + (status.promoCsv ? '促销 ' + status.promoCsv : '促销未刷新');
}

async function refreshStatus() {
  const dot = document.getElementById('connectionDot');
  const text = document.getElementById('connectionText');
  try {
    const response = await fetch('/status', { cache: 'no-store' });
    const status = await response.json();
    if (status.version && VERSION_PAGINA && status.version !== VERSION_PAGINA) {
      sessionStorage.setItem('jarvisUpdated', status.version);
      location.reload();
      return;
    }
    if (updating && bootSeen && status.boot && status.boot !== bootSeen) {
      updating = false;
      resetUpdateButton();
      showToast('更新结束，版本没有变化');
    } else if (updating && status.updateLine && status.updateLine.indexOf('ERROR') === 0) {
      // El updater dejo escrito el motivo del fallo: enseñarlo y no
      // dejar el boton en 更新中 para siempre.
      updating = false;
      resetUpdateButton();
      showToast('更新失败 — ' + status.updateLine.slice(0, 90));
    } else if (updating && updateStartedAt && Date.now() - updateStartedAt > 300000) {
      updating = false;
      resetUpdateButton();
      showToast('更新超时 — 看 logs/update-estado.txt 或跑 start-bot.cmd');
    }
    bootSeen = status.boot || bootSeen;
    offlineSince = 0;
    dot.className = 'dot online';
    text.textContent = 'Bot 在线';
    paintStatus(status);
    if (updating && status.updateLine) document.getElementById('railMeta').textContent = status.updateLine;
  } catch {
    dot.className = 'dot offline';
    if (!offlineSince) offlineSince = Date.now();
    text.textContent = updating ? '正在更新' : 'Bot 离线';
    // La instalacion tarda segundos; minutos sin volver = algo se torcio.
    document.getElementById('railMeta').textContent = updating
      ? (Date.now() - offlineSince > 180000 ? '更新后 Bot 一直没回来 — 双击 panel.cmd 或 start-bot.cmd' : '等待 Bot 重新启动')
      : '检查黑色运行窗口';
  }
  // Mientras se actualiza, poll extra rapido para pillar el desenlace.
  if (updating) setTimeout(refreshStatus, 3000);
}

function resetUpdateButton() {
  const button = document.getElementById('updateButton');
  if (button) { button.disabled = false; button.textContent = '更新 BOT'; }
}

async function runAdmin(action) {
  if (action !== 'update') return;
  const button = document.getElementById('updateButton');
  button.disabled = true;
  button.textContent = '更新中';
  updating = true;
  updateStartedAt = Date.now();
  offlineSince = 0;
  try {
    const response = await fetch('/admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accion: action }) });
    const data = await response.json();
    showToast(data.toast || (response.ok ? '更新已启动' : '更新失败'));
  } catch {
    showToast('更新器没有启动');
    updating = false;
    button.disabled = false;
    button.textContent = '更新 BOT';
  }
}

window.addEventListener('beforeunload', function () {
  try { navigator.sendBeacon('/admin', new Blob([JSON.stringify({ accion: 'adios' })], { type: 'application/json' })); } catch { /* noop */ }
});

updateClock();
setInterval(updateClock, 1000);
pollChat();
setInterval(pollChat, 2500);
refreshStatus();
setInterval(refreshStatus, 10000);
try {
  const updated = sessionStorage.getItem('jarvisUpdated');
  if (updated) { sessionStorage.removeItem('jarvisUpdated'); setTimeout(function () { showToast('更新完成：' + updated); }, 500); }
} catch { /* noop */ }
</script>
</body>
</html>`;
}
