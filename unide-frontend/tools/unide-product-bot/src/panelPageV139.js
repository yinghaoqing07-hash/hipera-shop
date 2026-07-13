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
<title>JARVIS 店务控制台</title>
<style>
  :root {
    color-scheme: dark;
    --canvas: #090d0f;
    --rail: #0d1215;
    --surface: #11181c;
    --surface-2: #151e23;
    --surface-3: #1a252a;
    --line: #27343a;
    --line-strong: #39484e;
    --text: #e8edef;
    --muted: #87969d;
    --teal: #4fc8bb;
    --teal-dark: #123b39;
    --amber: #e3aa52;
    --amber-dark: #3b2d18;
    --red: #ea7169;
    --blue: #78aee8;
    --shadow: 0 18px 48px rgba(0, 0, 0, .34);
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body {
    min-width: 320px;
    background: var(--canvas);
    color: var(--text);
    font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif;
    font-size: 14px;
    letter-spacing: 0;
  }
  button, input { font: inherit; letter-spacing: 0; }
  button { cursor: pointer; }
  .shell { min-height: 100vh; display: grid; grid-template-columns: 220px minmax(0, 1fr); }
  .rail {
    position: sticky;
    top: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    padding: 24px 17px 18px;
    background: var(--rail);
    border-right: 1px solid #1c282d;
  }
  .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .brand-mark {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border: 1px solid #3c6965;
    color: var(--teal);
    font-size: 16px;
    font-weight: 800;
  }
  .brand-name { font-size: 14px; font-weight: 750; letter-spacing: .15em; }
  .brand-sub { margin-top: 3px; color: var(--muted); font-size: 10px; }
  .connection-block { margin: 24px 0 20px; padding: 12px 2px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .connection { display: flex; align-items: center; gap: 9px; color: #bdc8cc; font-size: 12px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--amber); box-shadow: 0 0 0 3px rgba(227,170,82,.12); }
  .dot.online { background: var(--teal); box-shadow: 0 0 0 3px rgba(79,200,187,.12); }
  .dot.offline { background: var(--red); box-shadow: 0 0 0 3px rgba(234,113,105,.12); }
  .rail-meta { margin-top: 8px; color: #697a81; font-size: 10px; line-height: 1.5; overflow-wrap: anywhere; }
  .rail-nav { display: grid; gap: 5px; }
  .nav-button {
    width: 100%;
    min-height: 43px;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    gap: 9px;
    border: 0;
    border-left: 2px solid transparent;
    padding: 0 10px;
    background: transparent;
    color: #8d9aa0;
    text-align: left;
  }
  .nav-button:hover { background: #141c20; color: #dfe7e9; }
  .nav-button.active { background: #172226; border-left-color: var(--teal); color: #fff; }
  .nav-label { font-size: 12px; font-weight: 650; }
  .rail-footer { margin-top: auto; display: grid; gap: 10px; }
  .update-button {
    min-height: 40px;
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    background: #121a1e;
    color: #d9e2e5;
    font-size: 11px;
    font-weight: 700;
  }
  .update-button:hover { border-color: var(--teal); color: var(--teal); }
  .update-button:disabled { opacity: .45; cursor: wait; }
  .version { color: #5f6d73; font-size: 10px; overflow-wrap: anywhere; }
  .workspace { min-width: 0; padding: 0 30px 32px; }
  .topbar {
    min-height: 82px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    border-bottom: 1px solid var(--line);
  }
  .topbar-copy { min-width: 0; }
  h1 { margin: 0; font-size: 21px; line-height: 1.2; font-weight: 680; }
  .clock { display: flex; align-items: baseline; gap: 12px; white-space: nowrap; }
  #clockTime { font-size: 26px; font-weight: 670; font-variant-numeric: tabular-nums; }
  #clockDate { color: var(--muted); font-size: 11px; }
  .command-bar {
    min-height: 68px;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) 42px;
    align-items: center;
    gap: 12px;
    border-bottom: 1px solid var(--line);
  }
  .command-prefix { color: var(--teal); font-family: "Cascadia Mono", Consolas, monospace; font-size: 12px; font-weight: 700; }
  .command-bar input {
    width: 100%;
    height: 40px;
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    padding: 0 12px;
    background: #0d1316;
    color: var(--text);
    outline: none;
  }
  .command-bar input:focus { border-color: var(--teal); box-shadow: 0 0 0 2px rgba(79,200,187,.09); }
  .send-button { width: 40px; height: 40px; border: 1px solid #397e77; border-radius: 4px; background: #17423e; color: #d9fffa; font-size: 18px; }
  .send-button:hover { background: #1d514b; }
  .view { display: none; min-width: 0; padding-top: 24px; }
  .view.active { display: block; }
  .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--line); background: var(--surface); }
  .metric { min-width: 0; padding: 17px 19px; }
  .metric + .metric { border-left: 1px solid var(--line); }
  .metric-label { color: var(--muted); font-size: 10px; }
  .metric-value { margin-top: 7px; font-size: 23px; line-height: 1; font-weight: 680; font-variant-numeric: tabular-nums; }
  .metric-note { margin-top: 7px; color: #718188; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .overview-grid { display: grid; grid-template-columns: minmax(420px, 1.25fr) minmax(300px, .75fr); gap: 18px; margin-top: 18px; }
  .panel { min-width: 0; border: 1px solid var(--line); border-radius: 5px; background: var(--surface); }
  .panel-head { min-height: 54px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 0 17px; border-bottom: 1px solid var(--line); }
  .panel-title { margin: 0; font-size: 12px; font-weight: 750; letter-spacing: .08em; }
  .panel-meta { color: var(--muted); font-size: 10px; }
  .quick-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .quick-action {
    min-height: 84px;
    display: grid;
    align-content: center;
    gap: 7px;
    border: 0;
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    padding: 13px 15px;
    background: transparent;
    color: var(--text);
    text-align: left;
  }
  .quick-action:nth-child(3n) { border-right: 0; }
  .quick-action:nth-last-child(-n+3) { border-bottom: 0; }
  .quick-action:hover { background: var(--surface-2); }
  .quick-name { font-size: 12px; font-weight: 650; }
  .quick-note { color: var(--muted); font-size: 10px; }
  .compact-list { padding: 6px 17px 12px; }
  .task-row, .activity-row { min-height: 43px; display: grid; align-items: center; gap: 10px; border-bottom: 1px solid #202c31; }
  .task-row { grid-template-columns: 82px minmax(0, 1fr) 30px; }
  .activity-row { grid-template-columns: 46px minmax(0, 1fr); }
  .task-row:last-child, .activity-row:last-child { border-bottom: 0; }
  .task-time { color: var(--teal); font-size: 10px; font-variant-numeric: tabular-nums; }
  .task-name { min-width: 0; font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }
  .activity-time { color: #66777e; font-size: 10px; font-variant-numeric: tabular-nums; }
  .activity-text { min-width: 0; color: #b8c3c7; font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }
  .icon-button { width: 28px; height: 28px; border: 0; border-radius: 3px; background: transparent; color: #68777d; font-size: 17px; }
  .icon-button:hover { background: #3b211f; color: var(--red); }
  .empty { padding: 18px 0; color: var(--muted); font-size: 11px; line-height: 1.5; }
  .view-head { min-height: 54px; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
  .view-heading { margin: 0; font-size: 16px; font-weight: 680; }
  .view-copy { margin-top: 5px; color: var(--muted); font-size: 11px; }
  .execution-layout { display: grid; grid-template-columns: minmax(480px, 1.45fr) minmax(260px, .55fr); gap: 18px; }
  .operation-stage { min-height: 570px; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
  .stage-head { min-height: 60px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 0 18px; border-bottom: 1px solid var(--line); }
  .stage-kicker { color: var(--teal); font-size: 9px; font-weight: 800; letter-spacing: .14em; }
  .stage-title { margin-top: 4px; max-width: 650px; font-size: 14px; font-weight: 680; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stage-state { display: inline-flex; align-items: center; gap: 7px; color: #95a5ab; font-size: 10px; white-space: nowrap; }
  .stage-state i { width: 7px; height: 7px; border-radius: 50%; background: var(--teal); }
  .stage-body { min-height: 0; overflow: auto; padding: 17px 18px 20px; }
  .operation-text { max-width: 850px; color: #b9c5c9; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
  .operation-note { margin: 15px 0 9px; color: #6f8087; font-size: 9px; font-weight: 800; letter-spacing: .13em; }
  .operation-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .operation-button {
    min-width: 0;
    min-height: 54px;
    border: 1px solid #33444b;
    border-radius: 4px;
    padding: 9px 10px;
    background: #131c20;
    color: #dfe7e9;
    text-align: left;
    line-height: 1.35;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .operation-button:hover { border-color: var(--teal); background: #172a2a; color: #eafffc; }
  .operation-button:disabled { opacity: .46; cursor: wait; }
  .stage-controls { min-height: 62px; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; padding: 11px 18px; border-top: 1px solid var(--line); background: #0f1619; }
  .control-button { min-height: 36px; border: 1px solid var(--line-strong); border-radius: 4px; padding: 0 14px; background: #182126; color: #c9d3d6; font-size: 11px; font-weight: 650; }
  .control-button.primary { border-color: #3b7b75; background: #17423e; color: #e2fffb; }
  .control-button.danger { border-color: #5d3734; color: #eea19b; }
  .control-button:hover { border-color: var(--teal); }
  .operation-empty { min-height: 420px; display: grid; place-items: center; padding: 24px; color: #718188; text-align: center; }
  .operation-empty strong { display: block; color: #aebbc0; font-size: 14px; margin-bottom: 7px; }
  .operation-list { padding: 5px 12px 12px; }
  .operation-list-button { width: 100%; min-height: 55px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; border: 0; border-bottom: 1px solid #202d32; padding: 9px 5px; background: transparent; color: #b8c4c8; text-align: left; }
  .operation-list-button:hover, .operation-list-button.active { color: #fff; }
  .operation-list-button.active { border-left: 2px solid var(--teal); padding-left: 9px; background: #141f23; }
  .operation-list-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
  .operation-list-time { color: #65767d; font-size: 10px; font-variant-numeric: tabular-nums; }
  .conversation-panel { height: calc(100vh - 225px); min-height: 560px; display: grid; grid-template-rows: auto minmax(0, 1fr); }
  .transcript { min-height: 0; overflow: auto; padding: 6px 18px 18px; scroll-behavior: smooth; }
  .message { position: relative; padding: 11px 10px 11px 15px; }
  .message.user, .message.from-panel { text-align: right; padding: 11px 15px 11px 10px; }
  .message::before { content: ""; position: absolute; left: 0; top: 17px; bottom: 17px; width: 2px; background: var(--teal); }
  .message.user::before, .message.from-panel::before { background: var(--amber); left: auto; right: 0; }
  .message-meta { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 7px; }
  .message.user .message-meta, .message.from-panel .message-meta { flex-direction: row-reverse; }
  .message-author { color: var(--teal); font-size: 10px; font-weight: 800; letter-spacing: .08em; }
  .message.user .message-author, .message.from-panel .message-author { color: var(--amber); }
  .message-time { color: #65757c; font-size: 9px; font-variant-numeric: tabular-nums; }
  .message-body { color: #c3cdd0; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
  .open-operation { margin-top: 10px; min-height: 32px; border: 1px solid #366a66; border-radius: 4px; padding: 0 11px; background: #142c2a; color: #a9e6df; font-size: 10px; font-weight: 700; }
  .attachment { margin-top: 10px; min-height: 32px; border: 1px solid var(--line-strong); border-radius: 4px; padding: 0 11px; background: #151e22; color: #c0cbce; }
  .thumb { display: block; margin-top: 10px; width: min(360px, 100%); border: 1px solid var(--line); cursor: zoom-in; }
  .task-table { width: 100%; border-collapse: collapse; }
  .task-table th, .task-table td { padding: 13px 14px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: middle; }
  .task-table th { color: var(--muted); font-size: 9px; font-weight: 800; letter-spacing: .12em; }
  .task-table td { color: #c2cdd0; font-size: 11px; }
  .system-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
  .system-list { padding: 8px 17px 15px; }
  .system-row { min-height: 43px; display: flex; align-items: center; justify-content: space-between; gap: 14px; border-bottom: 1px solid #202c31; }
  .system-row:last-child { border-bottom: 0; }
  .system-name { color: #8d9ca2; font-size: 11px; }
  .system-state { display: inline-flex; align-items: center; gap: 7px; color: #d1dadd; font-size: 11px; font-weight: 650; }
  .state-dot { width: 6px; height: 6px; border-radius: 50%; background: #68767c; }
  .state-dot.ok { background: var(--teal); }
  .state-dot.warn { background: var(--amber); }
  .modal { position: fixed; inset: 0; z-index: 30; display: none; place-items: center; padding: 22px; background: rgba(3, 5, 6, .8); }
  .modal.open { display: grid; }
  .modal-window { width: min(980px, 100%); max-height: calc(100vh - 44px); display: grid; grid-template-rows: auto minmax(0, 1fr); overflow: hidden; border: 1px solid var(--line-strong); border-radius: 5px; background: #11181c; box-shadow: var(--shadow); }
  .modal-head { min-height: 54px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 0 16px; border-bottom: 1px solid var(--line); }
  .modal-title { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 680; }
  .modal-close { width: 34px; height: 34px; border: 0; background: transparent; color: #74848b; font-size: 22px; }
  .modal-content { min-height: 0; overflow: auto; padding: 18px; }
  .modal-content img { display: block; max-width: 100%; margin: 0 auto; }
  .modal-content pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: "Cascadia Mono", Consolas, monospace; font-size: 12px; line-height: 1.55; }
  .file-table { width: max-content; min-width: 100%; border-collapse: collapse; font-size: 11px; }
  .file-table th, .file-table td { max-width: 340px; padding: 7px 9px; border: 1px solid var(--line); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  .file-table th { position: sticky; top: -18px; background: #1a272c; }
  .toast { position: fixed; left: 50%; bottom: 24px; z-index: 40; transform: translate(-50%, 12px); padding: 10px 14px; border: 1px solid var(--line-strong); border-radius: 4px; background: #192227; color: #fff; box-shadow: var(--shadow); opacity: 0; pointer-events: none; transition: opacity .18s, transform .18s; }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }
  @media (max-width: 1080px) {
    .shell { grid-template-columns: 76px minmax(0, 1fr); }
    .rail { padding: 20px 11px; align-items: center; }
    .brand-copy, .connection-block, .nav-label, .version { display: none; }
    .nav-button { width: 46px; grid-template-columns: 1fr; justify-items: center; padding: 0; border-left: 0; border-bottom: 2px solid transparent; }
    .nav-button.active { border-left-color: transparent; border-bottom-color: var(--teal); }
    .update-button { width: 46px; font-size: 0; }
    .update-button::after { content: "UP"; font-size: 10px; }
    .workspace { padding-left: 22px; padding-right: 22px; }
    .overview-grid, .execution-layout { grid-template-columns: minmax(0, 1fr); }
    .operation-stage { min-height: 530px; }
  }
  @media (max-width: 760px) {
    .shell { display: block; }
    .rail { position: fixed; inset: auto 0 0; z-index: 20; width: 100%; height: 64px; padding: 0 8px; display: block; border-top: 1px solid var(--line); border-right: 0; }
    .brand, .connection-block, .rail-footer { display: none; }
    .rail-nav { height: 100%; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0; }
    .nav-button { width: 100%; height: 64px; min-height: 0; display: grid; grid-template-columns: 1fr; justify-items: center; align-content: center; gap: 4px; border-bottom: 0; border-top: 2px solid transparent; }
    .nav-button.active { border-bottom-color: transparent; border-top-color: var(--teal); }
    .nav-label { display: block; font-size: 9px; }
    .workspace { padding: 0 13px 84px; }
    .topbar { min-height: 69px; }
    h1 { font-size: 18px; }
    #clockTime { font-size: 20px; }
    #clockDate { display: none; }
    .command-bar { grid-template-columns: minmax(0, 1fr) 40px; gap: 8px; }
    .command-prefix { display: none; }
    .view { padding-top: 15px; }
    .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .metric:nth-child(3) { border-left: 0; }
    .metric:nth-child(n+3) { border-top: 1px solid var(--line); }
    .metric { padding: 14px 13px; }
    .metric-value { font-size: 20px; }
    .overview-grid { margin-top: 13px; gap: 13px; }
    .quick-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .quick-action:nth-child(3n) { border-right: 1px solid var(--line); }
    .quick-action:nth-child(2n) { border-right: 0; }
    .quick-action:nth-last-child(-n+3) { border-bottom: 1px solid var(--line); }
    .quick-action:nth-last-child(-n+2) { border-bottom: 0; }
    .execution-layout { gap: 13px; }
    .operation-stage { min-height: calc(100vh - 235px); }
    .operation-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .conversation-panel { height: calc(100vh - 220px); min-height: 500px; }
    .system-grid { grid-template-columns: 1fr; gap: 13px; }
    .toast { bottom: 78px; max-width: calc(100vw - 24px); }
    .task-table th:nth-child(3), .task-table td:nth-child(3) { display: none; }
  }
  @media (max-width: 390px) {
    .workspace { padding-left: 10px; padding-right: 10px; }
    .operation-grid { grid-template-columns: 1fr; }
    .stage-controls { justify-content: stretch; }
    .control-button { flex: 1 1 42%; }
  }
</style>
</head>
<body>
<div class="shell">
  <aside class="rail">
    <div class="brand"><div class="brand-mark">J</div><div class="brand-copy"><div class="brand-name">JARVIS</div><div class="brand-sub">UNIDE OPERATIONS</div></div></div>
    <div class="connection-block"><div class="connection"><span class="dot" id="connectionDot"></span><span id="connectionText">正在连接</span></div><div class="rail-meta" id="railMeta">等待 Bot 状态</div></div>
    <nav class="rail-nav" aria-label="主导航">
      <button class="nav-button active" data-view="overview"><span class="nav-label">总览</span></button>
      <button class="nav-button" data-view="execution"><span class="nav-label">执行台</span></button>
      <button class="nav-button" data-view="conversation"><span class="nav-label">对话</span></button>
      <button class="nav-button" data-view="tasks"><span class="nav-label">任务</span></button>
      <button class="nav-button" data-view="system"><span class="nav-label">系统</span></button>
    </nav>
    <div class="rail-footer"><button class="update-button" id="updateButton" onclick="runAdmin('update')">更新 BOT</button><div class="version">BUILD ${safeVersion}</div></div>
  </aside>

  <main class="workspace">
    <header class="topbar"><div class="topbar-copy"><h1 id="viewTitle">店务总览</h1></div><div class="clock"><span id="clockTime">--:--</span><span id="clockDate">—</span></div></header>
    <form class="command-bar" id="composer"><span class="command-prefix">JARVIS &gt;</span><input id="commandInput" autocomplete="off" placeholder="输入问题、任务或命令"><button class="send-button" type="submit" title="发送">›</button></form>

    <section class="view active" id="view-overview">
      <div class="metrics">
        <div class="metric"><div class="metric-label">预计到货</div><div class="metric-value" id="metricArrival">—</div><div class="metric-note" id="metricArrivalNote">等待读取</div></div>
        <div class="metric"><div class="metric-label">有效促销商品</div><div class="metric-value" id="metricPromo">—</div><div class="metric-note" id="metricPromoNote">等待读取</div></div>
        <div class="metric"><div class="metric-label">待执行任务</div><div class="metric-value" id="metricTasks">—</div><div class="metric-note" id="metricTaskNote">没有任务</div></div>
        <div class="metric"><div class="metric-label">已记录改价</div><div class="metric-value" id="metricPrices">—</div><div class="metric-note" id="metricPriceNote">持久账本</div></div>
      </div>
      <div class="overview-grid">
        <section class="panel"><div class="panel-head"><h2 class="panel-title">常用行动</h2><span class="panel-meta">直接执行</span></div><div class="quick-grid">
          <button class="quick-action" onclick="runCommand('/carne','execution')"><span class="quick-name">肉类点货</span><span class="quick-note">进入专用执行台</span></button>
          <button class="quick-action" onclick="runCommand('/pedido')"><span class="quick-name">叫货检查</span><span class="quick-note">当天工作提醒</span></button>
          <button class="quick-action" onclick="runCommand('/llegada')"><span class="quick-name">到货清单</span><span class="quick-note">生成打印文件</span></button>
          <button class="quick-action" onclick="runCommand('/pedidos 3')"><span class="quick-name">最近三张订单</span><span class="quick-note">快速核对异常</span></button>
          <button class="quick-action" onclick="runCommand('/promociones')"><span class="quick-name">刷新促销</span><span class="quick-note">读取有效活动</span></button>
          <button class="quick-action" onclick="runCommand('/ahorro_pedido')"><span class="quick-name">PDA 省钱分析</span><span class="quick-note">检查订单差异</span></button>
        </div></section>
        <section class="panel"><div class="panel-head"><h2 class="panel-title">下一步</h2><span class="panel-meta" id="overviewTaskCount">0 项</span></div><div class="compact-list" id="overviewTaskList"><div class="empty">还没有待执行任务</div></div></section>
        <section class="panel"><div class="panel-head"><h2 class="panel-title">最近动态</h2><span class="panel-meta">本次运行</span></div><div class="compact-list" id="overviewActivityList"><div class="empty">还没有操作记录</div></div></section>
        <section class="panel"><div class="panel-head"><h2 class="panel-title">运行状态</h2><span class="panel-meta" id="overviewUptime">—</span></div><div class="system-list" id="overviewSystemList"></div></section>
      </div>
    </section>

    <section class="view" id="view-execution">
      <div class="view-head"><div><h2 class="view-heading">交互执行台</h2><div class="view-copy">当前 Telegram 操作会话</div></div><span class="panel-meta" id="operationCount">0 个会话</span></div>
      <div class="execution-layout">
        <section class="panel operation-stage" id="operationStage"><div class="operation-empty"><div><strong>没有待处理操作</strong>从总览启动肉类点货或其他交互任务</div></div></section>
        <aside class="panel"><div class="panel-head"><h2 class="panel-title">操作会话</h2><span class="panel-meta">最近</span></div><div class="operation-list" id="operationList"><div class="empty">新的交互任务会显示在这里</div></div></aside>
      </div>
    </section>

    <section class="view" id="view-conversation">
      <div class="view-head"><div><h2 class="view-heading">JARVIS 对话</h2><div class="view-copy">问题、判断和执行结果</div></div><span class="panel-meta" id="syncLabel">同步中</span></div>
      <section class="panel conversation-panel"><div class="panel-head"><h2 class="panel-title">会话记录</h2><span class="panel-meta">Telegram / Panel</span></div><div class="transcript" id="chat"><div class="empty" id="emptyChat">最近的对话会显示在这里</div></div></section>
    </section>

    <section class="view" id="view-tasks">
      <div class="view-head"><div><h2 class="view-heading">定时任务</h2><div class="view-copy">等待自动执行的店务工作</div></div><span class="panel-meta" id="taskCount">0 项</span></div>
      <section class="panel"><table class="task-table"><thead><tr><th>执行时间</th><th>任务</th><th>命令</th><th></th></tr></thead><tbody id="taskTableBody"><tr><td colspan="4"><div class="empty">还没有待执行任务</div></td></tr></tbody></table></section>
    </section>

    <section class="view" id="view-system">
      <div class="view-head"><div><h2 class="view-heading">系统状态</h2><div class="view-copy">Bot、自动化与数据能力</div></div><span class="panel-meta" id="uptime">—</span></div>
      <div class="system-grid">
        <section class="panel"><div class="panel-head"><h2 class="panel-title">服务</h2><span class="panel-meta">实时</span></div><div class="system-list">
          <div class="system-row"><span class="system-name">订单网页</span><span class="system-state"><i class="state-dot" id="stateWeb"></i><span id="stateWebText">—</span></span></div>
          <div class="system-row"><span class="system-name">桌面自动化</span><span class="system-state"><i class="state-dot" id="stateDesktop"></i><span id="stateDesktopText">—</span></span></div>
          <div class="system-row"><span class="system-name">AI 回复</span><span class="system-state"><i class="state-dot" id="stateLlm"></i><span id="stateLlmText">—</span></span></div>
          <div class="system-row"><span class="system-name">长期记忆</span><span class="system-state"><i class="state-dot ok"></i><span id="stateMemory">—</span></span></div>
        </div></section>
        <section class="panel"><div class="panel-head"><h2 class="panel-title">操作记录</h2><span class="panel-meta">最近</span></div><div class="compact-list" id="systemActivityList"><div class="empty">还没有操作记录</div></div></section>
      </div>
    </section>
  </main>
</div>

<div class="modal" id="readerModal" role="dialog" aria-modal="true" aria-labelledby="readerTitle"><div class="modal-window"><div class="modal-head"><div class="modal-title" id="readerTitle">内容</div><button class="modal-close" onclick="closeReader()" title="关闭">×</button></div><div class="modal-content" id="readerContent"></div></div></div>
<div class="toast" id="toast"></div>

<script>
const VERSION_PAGINA = ${versionJson};
const chatElement = document.getElementById('chat');
const messageRows = new Map();
const operationMessages = new Map();
const viewMeta = {
  overview: ['OPERATIONS OVERVIEW', '店务总览'],
  execution: ['INTERACTIVE WORKSPACE', '执行台'],
  conversation: ['JARVIS INTELLIGENCE', 'JARVIS 对话'],
  tasks: ['AUTOMATION QUEUE', '定时任务'],
  system: ['SYSTEM CONTROL', '系统状态']
};
// El panel es sobrio: los emojis de los mensajes (pensados para Telegram)
// se filtran solo en la VISUALIZACION; en Telegram y el registro siguen.
function sinEmoji(value) {
  return String(value == null ? '' : value)
    .replace(/[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{2300}-\\u{23FF}\\u{FE0F}\\u{200D}]/gu, '')
    .replace(/  +/g, ' ').replace(/^ +/gm, '').trim();
}

// El CSV de promociones (pensado para Excel) es ilegible en crudo: se
// agrupa por promocion con precio oferta, precio normal y condiciones;
// precios iguales (NOVEDAD/STOCK semanal) se marcan como precio de la
// semana. Otros CSV caen a la tabla generica.
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

let currentView = 'overview';
let activeOperationId = null;
let chatSeq = 0;
let chatInitialized = false;
let bootSeen = null;
let updating = false;
let updateStartedAt = 0; // clic en 更新 BOT (para el timeout)
let offlineSince = 0;    // desde cuando no responde /status
let toastTimer = null;

function showView(name) {
  if (!viewMeta[name]) name = 'overview';
  currentView = name;
  document.querySelectorAll('.view').forEach(function (view) { view.classList.toggle('active', view.id === 'view-' + name); });
  document.querySelectorAll('.nav-button').forEach(function (button) { button.classList.toggle('active', button.dataset.view === name); });
  document.getElementById('viewTitle').textContent = viewMeta[name][1];
  window.scrollTo({ top: 0, behavior: 'smooth' });
  // La transcripción solo se puede colocar cuando la vista es visible: al
  // entrar en 对话 se salta directo a lo más reciente (el final).
  if (name === 'conversation') chatElement.scrollTop = chatElement.scrollHeight;
}

document.querySelectorAll('.nav-button').forEach(function (button) { button.addEventListener('click', function () { showView(button.dataset.view); }); });

function showToast(text) {
  const el = document.getElementById('toast');
  el.textContent = String(text || '完成');
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
}

function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
  document.getElementById('clockTime').textContent = hh + ':' + mm;
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

function validButtons(message) {
  if (!message || !Array.isArray(message.buttons)) return [];
  return message.buttons.flat().filter(function (button) { return button && button.t && button.d; });
}

function operationTitle(message) {
  const first = String(message && message.text || '').split(/\\r?\\n/).find(function (line) { return line.trim(); }) || '交互操作';
  return first.trim().slice(0, 70);
}

function isControlButton(button) {
  return /生成|确认|保存|提交|打印|完成|清零|取消|返回|关闭|上一页|下一页|volver|guardar|cancelar|imprimir/i.test(String(button.t || ''));
}

function controlClass(button) {
  const text = String(button.t || '');
  if (/生成|确认|保存|提交|打印|完成|guardar|imprimir/i.test(text)) return 'control-button primary';
  if (/清零|取消|关闭|cancelar/i.test(text)) return 'control-button danger';
  return 'control-button';
}

async function invokeCallback(button, element) {
  if (element) element.disabled = true;
  try {
    const response = await fetch('/callback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: button.d }) });
    const data = await response.json();
    showToast(data.toast || (response.ok ? '已执行' : '执行失败'));
    setTimeout(pollChat, 240);
  } catch {
    showToast('Bot 当前没有连接');
  } finally {
    if (element) setTimeout(function () { element.disabled = false; }, 650);
  }
}

function makeOperationButton(button, control) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = control ? controlClass(button) : 'operation-button';
  el.textContent = sinEmoji(button.t) || button.t;
  el.addEventListener('click', function () { invokeCallback(button, el); });
  return el;
}

function renderOperationList() {
  const list = document.getElementById('operationList');
  const messages = Array.from(operationMessages.values()).sort(function (a, b) { return Number(b.seq || 0) - Number(a.seq || 0); }).slice(0, 12);
  document.getElementById('operationCount').textContent = messages.length + ' 个会话';
  list.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '新的交互任务会显示在这里';
    list.appendChild(empty);
    return;
  }
  messages.forEach(function (message) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'operation-list-button' + (message.id === activeOperationId ? ' active' : '');
    const title = document.createElement('span');
    title.className = 'operation-list-title';
    title.textContent = operationTitle(message);
    const time = document.createElement('span');
    time.className = 'operation-list-time';
    time.textContent = formatTime(message.at);
    button.append(title, time);
    button.addEventListener('click', function () { activeOperationId = message.id; renderActiveOperation(); showView('execution'); });
    list.appendChild(button);
  });
}

function renderActiveOperation() {
  const stage = document.getElementById('operationStage');
  const message = operationMessages.get(activeOperationId);
  if (!message) {
    stage.innerHTML = '<div class="operation-empty"><div><strong>没有待处理操作</strong>从总览启动肉类点货或其他交互任务</div></div>';
    renderOperationList();
    return;
  }
  stage.replaceChildren();
  const head = document.createElement('div');
  head.className = 'stage-head';
  const copy = document.createElement('div');
  const kicker = document.createElement('div');
  kicker.className = 'stage-kicker';
  kicker.textContent = 'ACTIVE OPERATION';
  const title = document.createElement('div');
  title.className = 'stage-title';
  title.textContent = operationTitle(message);
  copy.append(kicker, title);
  const state = document.createElement('span');
  state.className = 'stage-state';
  state.innerHTML = '<i></i>' + formatTime(message.at) + ' · 等待操作';
  head.append(copy, state);
  const body = document.createElement('div');
  body.className = 'stage-body';
  const text = document.createElement('div');
  text.className = 'operation-text';
  text.textContent = message.text || '';
  body.appendChild(text);
  renderAttachment(message, body);
  const buttons = validButtons(message);
  const actions = buttons.filter(function (button) { return !isControlButton(button); });
  const controls = buttons.filter(isControlButton);
  if (actions.length) {
    const note = document.createElement('div');
    note.className = 'operation-note';
    note.textContent = '可选项目 / ' + actions.length;
    const grid = document.createElement('div');
    grid.className = 'operation-grid';
    actions.forEach(function (button) { grid.appendChild(makeOperationButton(button, false)); });
    body.append(note, grid);
  }
  const footer = document.createElement('div');
  footer.className = 'stage-controls';
  if (controls.length) controls.forEach(function (button) { footer.appendChild(makeOperationButton(button, true)); });
  else {
    const label = document.createElement('span');
    label.className = 'panel-meta';
    label.textContent = '没有额外控制';
    footer.appendChild(label);
  }
  stage.append(head, body, footer);
  renderOperationList();
}

function registerOperation(message, autoOpen) {
  operationMessages.set(message.id, message);
  activeOperationId = message.id;
  renderActiveOperation();
  if (autoOpen) showView('execution');
}

async function runCommand(command, destination) {
  if (destination === 'execution') {
    showView('execution');
    const stage = document.getElementById('operationStage');
    stage.innerHTML = '<div class="operation-empty"><div><strong>正在启动操作</strong>' + String(command || '') + '</div></div>';
  }
  try {
    const response = await fetch('/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: command }) });
    showToast(response.ok ? '任务已交给 Bot' : '发送失败');
    setTimeout(pollChat, 280);
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
  row.className = 'message ' + (message.from === 'bot' ? 'assistant' : message.from === 'panel' ? 'from-panel' : 'user');
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
  if (validButtons(message).length) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'open-operation';
    open.textContent = '在执行台打开 · ' + validButtons(message).length + ' 个操作';
    open.addEventListener('click', function () { activeOperationId = message.id; renderActiveOperation(); showView('execution'); });
    row.appendChild(open);
  }
}

async function pollChat() {
  try {
    const response = await fetch('/chat?since=' + chatSeq, { cache: 'no-store' });
    const data = await response.json();
    const messages = Array.isArray(data.messages) ? data.messages : [];
    const wasNearBottom = chatElement.scrollHeight - chatElement.scrollTop - chatElement.clientHeight < 90;
    messages.forEach(function (message) {
      renderMessage(message);
      if (validButtons(message).length) registerOperation(message, chatInitialized && message.from === 'bot');
    });
    chatSeq = Math.max(chatSeq, Number(data.seq) || 0);
    const empty = document.getElementById('emptyChat');
    if (empty && messageRows.size) empty.remove();
    if ((wasNearBottom || !chatInitialized) && messages.length) chatElement.scrollTop = chatElement.scrollHeight;
    document.getElementById('syncLabel').textContent = '已同步';
    chatInitialized = true;
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

document.getElementById('readerModal').addEventListener('click', function (event) { if (event.target === event.currentTarget) closeReader(); });
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

function makeTaskRow(task, compact) {
  if (compact) {
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
    return row;
  }
  const tr = document.createElement('tr');
  const time = document.createElement('td');
  time.textContent = formatTaskTime(task.runAt);
  const name = document.createElement('td');
  name.textContent = task.label || task.command || '定时任务';
  const command = document.createElement('td');
  command.textContent = task.command || '—';
  const action = document.createElement('td');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'icon-button';
  cancel.title = '取消任务';
  cancel.textContent = '×';
  cancel.addEventListener('click', function () { cancelTask(task.id); });
  action.appendChild(cancel);
  tr.append(time, name, command, action);
  return tr;
}

function renderTasks(tasks) {
  document.getElementById('taskCount').textContent = tasks.length + ' 项';
  document.getElementById('overviewTaskCount').textContent = tasks.length + ' 项';
  const preview = document.getElementById('overviewTaskList');
  preview.replaceChildren();
  if (!tasks.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '还没有待执行任务';
    preview.appendChild(empty);
  } else tasks.slice(0, 4).forEach(function (task) { preview.appendChild(makeTaskRow(task, true)); });
  const body = document.getElementById('taskTableBody');
  body.replaceChildren();
  if (!tasks.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.innerHTML = '<div class="empty">还没有待执行任务</div>';
    tr.appendChild(td);
    body.appendChild(tr);
  } else tasks.forEach(function (task) { body.appendChild(makeTaskRow(task, false)); });
}

function makeActivityRow(item) {
  const row = document.createElement('div');
  row.className = 'activity-row';
  const time = document.createElement('span');
  time.className = 'activity-time';
  time.textContent = formatTime(item.at);
  const text = document.createElement('span');
  text.className = 'activity-text';
  text.textContent = item.text || '';
  row.append(time, text);
  return row;
}

function renderActivities(items) {
  ['overviewActivityList', 'systemActivityList'].forEach(function (id) {
    const target = document.getElementById(id);
    target.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '还没有操作记录';
      target.appendChild(empty);
    } else items.slice(0, id === 'overviewActivityList' ? 5 : 12).forEach(function (item) { target.appendChild(makeActivityRow(item)); });
  });
}

function setSystem(id, enabled, yesText, noText) {
  const dot = document.getElementById(id);
  const text = document.getElementById(id + 'Text');
  dot.className = 'state-dot ' + (enabled ? 'ok' : 'warn');
  text.textContent = enabled ? yesText : noText;
}

function renderOverviewSystems(status) {
  const target = document.getElementById('overviewSystemList');
  const rows = [
    ['订单网页', Boolean(status.webOrder) ? '已连接' : '未启用', Boolean(status.webOrder)],
    ['桌面自动化', Boolean(status.desktop) ? '已启用' : '未启用', Boolean(status.desktop)],
    ['AI 回复', Boolean(status.llm) ? '可用' : '未配置', Boolean(status.llm)],
    ['长期记忆', String(status.memories == null ? 0 : status.memories) + ' 条', true]
  ];
  target.replaceChildren();
  rows.forEach(function (item) {
    const row = document.createElement('div');
    row.className = 'system-row';
    const name = document.createElement('span');
    name.className = 'system-name';
    name.textContent = item[0];
    const state = document.createElement('span');
    state.className = 'system-state';
    const dot = document.createElement('i');
    dot.className = 'state-dot ' + (item[2] ? 'ok' : 'warn');
    const text = document.createElement('span');
    text.textContent = item[1];
    state.append(dot, text);
    row.append(name, state);
    target.appendChild(row);
  });
}

function paintStatus(status) {
  document.getElementById('metricArrival').textContent = status.arrivingToday == null ? '—' : status.arrivingToday;
  document.getElementById('metricArrivalNote').textContent = status.arrivingToday ? '今天需要核对' : '今天暂无记录';
  document.getElementById('metricPromo').textContent = status.promoStats ? status.promoStats.items : '—';
  document.getElementById('metricPromoNote').textContent = status.promoStats ? status.promoStats.promos + ' 个活动 · 今明到期 ' + status.promoStats.endingSoon : '还没有促销数据';
  const tasks = Array.isArray(status.scheduledTasks) ? status.scheduledTasks : [];
  document.getElementById('metricTasks').textContent = tasks.length;
  document.getElementById('metricTaskNote').textContent = tasks.length ? '下一项 ' + formatTaskTime(tasks[0].runAt) : '没有待执行任务';
  document.getElementById('metricPrices').textContent = status.successfulPriceChanges == null ? '—' : status.successfulPriceChanges;
  document.getElementById('metricPriceNote').textContent = '共 ' + (status.operations == null ? 0 : status.operations) + ' 条操作记录';
  renderTasks(tasks);
  const activities = Array.isArray(status.activity) ? status.activity : [];
  renderActivities(activities);
  setSystem('stateWeb', Boolean(status.webOrder), '已连接', '未启用');
  setSystem('stateDesktop', Boolean(status.desktop), '已启用', '未启用');
  setSystem('stateLlm', Boolean(status.llm), '可用', '未配置');
  document.getElementById('stateMemory').textContent = (status.memories == null ? 0 : status.memories) + ' 条';
  document.getElementById('uptime').textContent = '运行 ' + (status.uptime || '—');
  document.getElementById('overviewUptime').textContent = '运行 ' + (status.uptime || '—');
  document.getElementById('railMeta').textContent = '运行 ' + (status.uptime || '—') + ' · ' + (status.promoCsv ? '促销 ' + status.promoCsv : '促销未刷新');
  renderOverviewSystems(status);
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
