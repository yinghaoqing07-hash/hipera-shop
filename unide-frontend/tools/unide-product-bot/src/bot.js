import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, readArg } from './config.js';
import { createLogger } from './logger.js';
import { formatTemplateHelp, parseProductMessage } from './templateParser.js';
import { enrichSupplierLookup, loadStoreIndex, loadSupplierIndex, lookupStore, suggestedPrice, supplierCost } from './supplierLookup.js';
import { applyOrderDesktop, applyPriceDesktop, clearDesktop, readPriceDesktop, searchDesktop } from './desktopSearch.js';
import { inspectOrderPage, inspectFormPage, applyOrderWeb, searchArticleOptions } from './webOrder.js';
import { formatProductResponse } from './formatResponse.js';
import { TelegramClient } from './telegram.js';
import { applyUpdatePackage } from './updater.js';
import {
  OrderReminderScheduler,
  enrichOrderItems,
  formatOrderDraft,
  formatOrderResponse,
  isOrderCommand,
  isOrderDraftCommand,
  isPendingNameItem,
  makeOrderButtons,
  makeOrderDraftButtons,
  parseOrderDraftMessage,
  parseOrderMode,
  resolveNameItem
} from './orderAssistant.js';

const UPDATE_PACKAGE_NAME = 'unide-product-bot-store-pc.zip';
const config = loadConfig(readArg('--config'));
const logger = createLogger(config.logsDir);
const supplierIndex = loadSupplierIndex(config.supplierCsv);
const storeIndex = loadStoreIndex(config.storeCsv);
const sessions = new Map();
let nextSessionId = 1;

if (process.argv.includes('--help')) { console.log('Usage: node src/bot.js --config config.local.json'); process.exit(0); }

const token = process.env.TELEGRAM_BOT_TOKEN;
const telegram = new TelegramClient(token);
const orderReminderScheduler = new OrderReminderScheduler(config, logger);
let offset = 0;

logger.info('unide product bot started', { desktopEnabled: config.desktop.enabled, supplierRows: supplierIndex.rows.length, storeRows: storeIndex.rows.length });

while (true) {
  try {
    const updates = await telegram.getUpdates({ offset, timeout: config.telegram.pollTimeoutSeconds });
    for (const update of updates) { offset = update.update_id + 1; await handleUpdate(update); }
    await maybeSendOrderReminder();
  } catch (error) { logger.error('polling error', { error: error.message }); await sleep(3000); }
}

async function handleUpdate(update) {
  if (update.callback_query) { await handleCallback(update.callback_query); return; }
  const message = update.message;
  if (!message?.chat?.id) return;
  if (message.document) { await handleDocument(message); return; }
  if (!message.text) return;
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const text = message.text.trim();
  if (text === '/whoami') { await telegram.sendMessage(chatId, `chat id: ${chatId}\nuser id: ${userId || '-'}`); return; }
  if (!isAllowed(chatId, userId)) { logger.warn('blocked unauthorized message', { chatId, userId }); return; }
  if (text === '/start' || text === '/help') { await telegram.sendMessage(chatId, formatTemplateHelp()); return; }
  if (text === '/pedido_web_test' || text === '/pedido_test') { await handlePedidoWebTest(chatId); return; }
  if (text === '/pedido_web_form' || text === '/pedido_form') { await handlePedidoWebForm(chatId); return; }
  if (isOrderDraftCommand(text)) { await handleOrderDraft(chatId, text); return; }
  if (isOrderCommand(text)) { await telegram.sendMessage(chatId, formatOrderResponse(parseOrderMode(text), new Date(), config), makeOrderButtons()); return; }
  const parsed = parseProductMessage(text);
  if (!parsed.ok) { await telegram.sendMessage(chatId, formatTemplateHelp()); return; }
  const maxItems = config.telegram.maxItemsPerMessage ?? 5;
  const items = parsed.items.slice(0, maxItems);
  if (parsed.items.length > items.length) await telegram.sendMessage(chatId, `这次先处理前 ${items.length} 个商品，剩下的请分批发。`);
  for (let index = 0; index < items.length; index += 1) await sendProductResult(chatId, items[index], index, items.length);
}

async function handleDocument(message) {
  const chatId = message.chat.id;
  const userId = message.from?.id;
  if (!isAllowed(chatId, userId)) { logger.warn('blocked unauthorized document', { chatId, userId }); return; }
  const document = message.document;
  const fileName = document.file_name || '';
  if (fileName !== UPDATE_PACKAGE_NAME) { await telegram.sendMessage(chatId, `收到文件：${fileName}\n不是更新包。更新包文件名必须是 ${UPDATE_PACKAGE_NAME}`); return; }
  const updatesDir = path.join(config.__toolRoot, 'updates');
  fs.mkdirSync(updatesDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const zipPath = path.join(updatesDir, `${stamp}-${UPDATE_PACKAGE_NAME}`);
  await telegram.sendMessage(chatId, '收到新版更新包，开始下载并更新。');
  try {
    const file = await telegram.getFile(document.file_id);
    await telegram.downloadFile(file.file_path, zipPath);
    const result = await applyUpdatePackage(zipPath, config, logger);
    if (result.status === 'ok') await telegram.sendMessage(chatId, '更新完成。已保留 .env 和 config.local.json。请关掉黑窗口，重新双击 start-bot.cmd，让新版生效。');
    else await telegram.sendMessage(chatId, `更新失败：\n${result.error}`);
  } catch (error) { logger.error('telegram update failed', { error: error.message }); await telegram.sendMessage(chatId, `更新失败：\n${error.message}`); }
}

async function handleCallback(callback) {
  const chatId = callback.message?.chat?.id;
  const userId = callback.from?.id;
  const data = callback.data || '';
  if (!chatId) return;
  if (!isAllowed(chatId, userId)) { await telegram.answerCallbackQuery(callback.id, '没有权限'); logger.warn('blocked unauthorized callback', { chatId, userId, data }); return; }
  if (data.startsWith('repeat:')) { const id = data.slice(7); const session = sessions.get(id); await telegram.answerCallbackQuery(callback.id, '重新查询'); await sendProductResult(chatId, session?.item || makeRepeatItem(id), 0, 1); return; }
  if (data.startsWith('order:')) { await telegram.answerCallbackQuery(callback.id, '叫货助手'); await telegram.sendMessage(chatId, formatOrderResponse(data.slice(6), new Date(), config), makeOrderButtons()); return; }
  if (data.startsWith('np:')) { await handleNamePick(chatId, callback.id, data.slice(3)); return; }
  if (data.startsWith('orderApply:')) { await handleOrderApply(chatId, callback.id, data.slice(11)); return; }
  if (data === 'clear') { await handleClear(chatId, callback.id); return; }
  if (data.startsWith('process:')) { await handleProcess(chatId, callback.id, data.slice(8)); return; }
  if (data.startsWith('apply:')) { await handleApply(chatId, callback.id, data.slice(6)); return; }
  if (data.startsWith('cancel:')) { sessions.delete(data.slice(7)); await telegram.answerCallbackQuery(callback.id, '已取消'); await telegram.sendMessage(chatId, '已取消，不会执行任何桌面操作。'); return; }
  if (data.startsWith('todo:')) { const label = futureActionLabel(data.slice(5)); await telegram.answerCallbackQuery(callback.id, `${label}还没实现`); await telegram.sendMessage(chatId, `${label}：按钮入口已预留，但现在还不会执行任何桌面操作。`); return; }
  await telegram.answerCallbackQuery(callback.id, '这个按钮已经失效');
}

async function handleOrderDraft(chatId, text) {
  const parsed = parseOrderDraftMessage(text);
  if (!parsed.ok) {
    await telegram.sendMessage(chatId, `${parsed.error}\n\n${formatOrderResponse('help', new Date(), config)}`);
    return;
  }
  // Enriquecer con la tabla local: nombre (para mostrar y como búsqueda de
  // respaldo), Código Unide de ancla, y EAN para códigos cortos (búsqueda
  // exacta). Todo se muestra en la confirmación (no es una caja negra).
  const { draft } = enrichOrderItems(parsed.draft, storeIndex, supplierIndex);
  const id = saveSession({ orderDraft: draft });

  // Si hay líneas por NOMBRE (no sabes el código), primero se resuelven una a
  // una: el bot busca el nombre en la web y te manda TODAS las opciones para
  // que elijas tú (no adivina). Cuando están todas elegidas, sale la
  // confirmación final con el botón de填入.
  if (draft.items.some(isPendingNameItem)) {
    await telegram.sendMessage(chatId, `${formatOrderDraft(draft)}\n\n有按名字的行，先帮你在网页搜、你来选。`);
    await resolveNextNameLine(chatId, id);
    return;
  }
  await telegram.sendMessage(chatId, formatOrderDraft(draft), makeOrderDraftButtons(id));
}

// Resuelve la SIGUIENTE línea por nombre pendiente: busca en la web y manda
// las opciones para elegir. Si ya no queda ninguna, muestra la confirmación
// final con el botón de llenado.
async function resolveNextNameLine(chatId, id) {
  const session = sessions.get(id);
  if (!session?.orderDraft) return;
  const idx = session.orderDraft.items.findIndex(isPendingNameItem);
  if (idx === -1) {
    await telegram.sendMessage(chatId, `都选好了：\n${formatOrderDraft(session.orderDraft)}`, makeOrderDraftButtons(id));
    return;
  }
  const item = session.orderDraft.items[idx];
  if (!config.webOrder?.enabled) {
    await telegram.sendMessage(chatId, `第 ${idx + 1} 行是商品名「${item.name}」，但网页自动化没启用，没法按名字搜。请改用 código 重发整单。`);
    return;
  }
  await telegram.sendMessage(chatId, `正在网页搜第 ${idx + 1} 行「${item.name}」…`);
  const res = await searchArticleOptions(config, item.name, logger);
  if (!res.ok) {
    await telegram.sendMessage(chatId, `搜「${item.name}」失败（${res.stage || '?'}）：\n${res.error}`);
    return;
  }
  if (!res.options.length) {
    const msg = `网页没搜到「${item.name}」。换个关键词，重发整单 /pedido_nuevo。`;
    if (res.screenshot) { try { await telegram.sendPhoto(chatId, res.screenshot, msg); } catch { await telegram.sendMessage(chatId, msg); } }
    else await telegram.sendMessage(chatId, msg);
    return;
  }
  session.nameOptions = session.nameOptions || {};
  session.nameOptions[idx] = res.options;
  sessions.set(id, session);
  // La captura va aparte (el pie de foto se corta a ~1000 chars); la lista y
  // los botones van en un mensaje normal (hasta 4096).
  if (res.screenshot) {
    try { await telegram.sendPhoto(chatId, res.screenshot, `第 ${idx + 1} 行「${item.name}」的网页搜索结果`); } catch { /* noop */ }
  }
  const list = res.options.map((o, i) => `[${i + 1}] ${o.name || o.text}`).join('\n');
  const body = `第 ${idx + 1} 行「${item.name}」找到 ${res.options.length} 个（数量 ${item.quantity}），点一个：\n${list}`;
  await telegram.sendMessage(chatId, body, makeNamePickButtons(id, idx, res.options.length));
}

async function handleNamePick(chatId, callbackId, payload) {
  const [id, idxStr, optStr] = payload.split(':');
  const session = sessions.get(id);
  if (!session?.orderDraft) { await telegram.answerCallbackQuery(callbackId, '记录已过期'); return; }
  const idx = Number(idxStr);
  const opt = Number(optStr);
  const chosen = session.nameOptions?.[idx]?.[opt];
  if (!chosen) { await telegram.answerCallbackQuery(callbackId, '选项已失效'); return; }
  await telegram.answerCallbackQuery(callbackId, `已选 [${opt + 1}]`);
  session.orderDraft.items[idx] = resolveNameItem(session.orderDraft.items[idx], chosen);
  if (session.nameOptions) delete session.nameOptions[idx];
  sessions.set(id, session);
  const idNote = chosen.ean ? `EAN ${chosen.ean}` : (chosen.code ? `código ${chosen.code}` : '按名字填入');
  await telegram.sendMessage(chatId, `第 ${idx + 1} 行 → ${chosen.name || chosen.text}（${idNote}）`);
  await resolveNextNameLine(chatId, id);
}

async function handleOrderApply(chatId, callbackId, id) {
  const session = sessions.get(id);
  if (!session?.orderDraft) {
    await telegram.answerCallbackQuery(callbackId, '记录已过期');
    await telegram.sendMessage(chatId, '这条订单记录已过期，请重新发送 /pedido_nuevo。');
    return;
  }
  await telegram.answerCallbackQuery(callbackId, '开始填入');

  // Pedidos es una página web: si webOrder está activo, conducimos el
  // navegador (DOM) en vez de la app de escritorio por coordenadas.
  if (config.webOrder?.enabled) {
    const result = await applyOrderWeb(session.orderDraft, config, logger);
    const text = result.ok
      ? (result.message || '订单填入：已执行。请检查 Pedidos 页面；程序没有点 Guardar，也没有点 Enviar Pedido。')
      : `订单填入失败（${result.stage || '?'}）：\n${result.error}`;
    // La captura del navegador (si existe) es la mejor confirmación; el
    // volcado de DOM solo se manda cuando una línea falla en edición.
    if (result.screenshot) {
      try { await telegram.sendPhoto(chatId, result.screenshot, text); }
      catch { await telegram.sendMessage(chatId, text); }
    } else {
      await telegram.sendMessage(chatId, text);
    }
    if (result.domDump) {
      try { await telegram.sendDocument(chatId, result.domDump, '编辑中页面结构（发给 Claude）'); } catch { /* noop */ }
    }
    return;
  }

  const result = await applyOrderDesktop(session.orderDraft, config, logger);
  const text = result.status === 'ok'
    ? '订单填入：已执行。请看截图确认订单名、商品和数量；程序没有点 Guardar，也没有点 Enviar Pedido。'
    : `订单填入失败：\n${result.error || result.reason || '未知错误'}`;
  await sendWithOptionalScreenshot(chatId, result, text);
}

// /pedido_web_test — diagnóstico de la automatización web: conecta al
// Edge, localiza la pestaña de Pedidos, resume lo que ve y envía el HTML
// de la página como documento (para afinar los selectores del grid).
async function handlePedidoWebTest(chatId) {
  await telegram.sendMessage(chatId, '正在连接 Edge 并读取 Pedidos 页面…（如果失败，请先双击 launch-edge-debug.cmd）');
  const result = await inspectOrderPage(config, logger);
  if (!result.ok) {
    await telegram.sendMessage(chatId, `读取失败（${result.stage}）：\n${result.error}`);
    return;
  }
  const i = result.info;
  const summary = [
    '网页读取成功：',
    `标题：${i.title}`,
    `网址：${i.url}`,
    `找到 "Nuevo" 按钮：${i.nuevoFound ? '是' : '否'}${i.nuevoText ? `（"${i.nuevoText}" <${i.nuevoTag}>）` : ''}`,
    `找到 "Nombre" 标签：${i.nombreLabelFound ? '是' : '否'}`,
    `输入框 ${i.inputCount} · 按钮 ${i.buttonCount} · 表格/网格 ${i.gridCount}`,
    '',
    '下面把整页 HTML 作为文件发出，请把这个文件转发给 Claude。'
  ].join('\n');
  await telegram.sendMessage(chatId, summary);
  try {
    await telegram.sendDocument(chatId, result.dumpFile, 'Pedidos 页面结构（发给 Claude）');
  } catch (error) {
    await telegram.sendMessage(chatId, `HTML 文件发送失败：${error.message}\n文件在店里电脑：${result.dumpFile}`);
  }
}

// /pedido_web_form — pulsa "Nuevo" para abrir el formulario del pedido y
// vuelca ESE HTML (donde estan el campo Nombre y el grid de articulos).
// Deja un borrador sin guardar; no pulsa Guardar ni Enviar.
async function handlePedidoWebForm(chatId) {
  await telegram.sendMessage(chatId, '正在点开 "Nuevo" 并读取订单编辑表单…（会留一个未保存的空订单草稿，不会保存也不会发送）');
  const result = await inspectFormPage(config, logger);
  if (!result.ok) {
    await telegram.sendMessage(chatId, `读取失败（${result.stage}）：\n${result.error}`);
    return;
  }
  const i = result.info;
  const summary = [
    '订单表单读取成功：',
    `网址：${i.url}`,
    `可见文本输入框：${i.textInputs} 个`,
    `表格/网格：${i.gridCount} 个`,
    `按钮动作：${(i.actionNames || []).join(', ')}`,
    '',
    '下面把表单 HTML 作为文件发出，请转发给 Claude。'
  ].join('\n');
  await telegram.sendMessage(chatId, summary);
  try {
    await telegram.sendDocument(chatId, result.dumpFile, '订单表单结构（发给 Claude）');
  } catch (error) {
    await telegram.sendMessage(chatId, `HTML 文件发送失败：${error.message}\n文件在店里电脑：${result.dumpFile}`);
  }
}

async function maybeSendOrderReminder() {
  const due = orderReminderScheduler.due(new Date());
  if (!due) return;
  let sent = 0;
  for (const chatId of due.chatIds) {
    try {
      await telegram.sendMessage(chatId, due.text, makeOrderButtons());
      sent += 1;
    } catch (error) {
      logger.error('ordering reminder failed', { chatId, error: error.message });
    }
  }
  if (sent > 0) orderReminderScheduler.markSent(due.key);
}

async function handleClear(chatId, callbackId) {
  await telegram.answerCallbackQuery(callbackId, '正在清零');
  const result = await clearDesktop(config, logger);
  const text = result.status === 'ok' ? '清零：已执行。' : `清零：失败。\n${result.error || result.reason || '未知错误'}`;
  await sendWithOptionalScreenshot(chatId, result, text);
}

async function handleProcess(chatId, callbackId, id) {
  const session = sessions.get(id);
  if (!session) { await telegram.answerCallbackQuery(callbackId, '记录已过期'); await telegram.sendMessage(chatId, '这条查询记录已过期，请再查一次。'); return; }
  await telegram.answerCallbackQuery(callbackId, '读取价格信息');
  const read = await readPriceDesktop(config, logger);
  if (read.status !== 'ok') { await telegram.sendMessage(chatId, `读取价格信息失败：\n${read.error || read.reason || '未知错误'}`); return; }
  const planResult = buildPricePlan(session, read);
  if (!planResult.ok) { await telegram.sendMessage(chatId, planResult.error); return; }
  session.plan = planResult.plan;
  session.priceRead = read;
  sessions.set(id, session);
  await telegram.sendMessage(chatId, formatPlan(planResult.plan), {
    reply_markup: { inline_keyboard: [[
      { text: '确认写入', callback_data: `apply:${id}` },
      { text: '取消', callback_data: `cancel:${id}` }
    ]] }
  });
}

async function handleApply(chatId, callbackId, id) {
  const session = sessions.get(id);
  if (!session?.plan) { await telegram.answerCallbackQuery(callbackId, '没有可执行计划'); await telegram.sendMessage(chatId, '没有可执行计划，请先点“确认处理”。'); return; }
  await telegram.answerCallbackQuery(callbackId, '正在写入');
  const result = await applyPriceDesktop(session.plan, config, logger);
  const text = result.status === 'ok'
    ? '写入：已执行。请看截图确认 PC Medio、PC Último、P.defecto、P.TPV、Bloq.Venta 和保存状态。'
    : `写入失败：\n${result.error || result.reason || '未知错误'}`;
  await sendWithOptionalScreenshot(chatId, result, text);
}

async function sendProductResult(chatId, item, index, total) {
  const desktop = await searchDesktop(item, config, logger);
  const store = lookupStore(storeIndex, item);
  const supplier = enrichSupplierLookup(supplierIndex, item, store);
  const response = formatProductResponse({ item, supplier, store, desktop, index, total });
  const id = saveSession({ item, supplier, store, desktop });
  const buttons = makeResultButtons(id);
  await sendWithOptionalScreenshot(chatId, desktop, response, { reply_markup: buttons });
}

async function sendWithOptionalScreenshot(chatId, result, text, options = {}) {
  if (result?.status === 'ok' && result.screenshot) {
    const screenshotPath = path.resolve(result.screenshot);
    if (fs.existsSync(screenshotPath)) {
      try {
        await telegram.sendPhoto(chatId, screenshotPath, text, options);
        return;
      } catch (error) {
        logger.error('telegram screenshot send failed', { screenshot: screenshotPath, error: error.message });
        await telegram.sendMessage(chatId, `${text}\n\n截图发送失败：${error.message}\n截图文件：${screenshotPath}`, options);
        return;
      }
    }
    await telegram.sendMessage(chatId, `${text}\n\n截图文件没有生成或路径不可读：${screenshotPath}`, options);
    return;
  }
  await telegram.sendMessage(chatId, text, options);
}

function buildPricePlan(session, read) {
  const values = read.values || {};
  const pcMedio = parseNumber(values.pcMedio);
  const pcUltimo = parseNumber(values.pcUltimo);
  const costInfo = getCostInfo(session, pcMedio, pcUltimo);
  const cost = costInfo.value;
  const bloqVentaChecked = Boolean(values.bloqVentaChecked);
  const item = session.item;
  const supplierPvp = suggestedPrice(session.supplier?.product);
  const ivaInfo = getIvaInfo(session);
  const iva = ivaInfo.value;
  let pDefecto;
  let mode;
  let target;
  let targetWithoutIva = NaN;
  if (item.margen?.mode === 'manual') {
    const margin = item.margen.value;
    if (margin <= 0 || margin >= 95) return { ok: false, error: `margen 不合理：${margin}` };
    pDefecto = margin;
    mode = 'margen';
    target = `P.defecto ${formatNumber(margin)}%`;
  } else {
    if (!Number.isFinite(cost) || cost <= 0) return { ok: false, error: '没有可用成本。供应商表没有 PVD。' };
    const targetPtpv = item.precio?.mode === 'manual' ? item.precio.value : supplierPvp;
    if (!Number.isFinite(targetPtpv) || targetPtpv <= 0) return { ok: false, error: '没有可用价格。请写 precio: 2,69 或 margen: 30。' };
    if (!Number.isFinite(iva) || iva < 0) return { ok: false, error: '没有可用 IVA，不能计算 P.defecto%。' };
    targetWithoutIva = targetPtpv / (1 + iva / 100);
    pDefecto = ((targetWithoutIva - cost) / targetPtpv) * 100;
    if (!isReasonableMargin(pDefecto)) {
      return {
        ok: false,
        error: [
          `计算出来的 P.defecto 不合理：${formatNumber(pDefecto)}%。`,
          `目标 P.TPV: ${formatMoney(targetPtpv)}，成本: ${formatNumber(cost)}（${costInfo.source}）。`,
          '这通常是价格或供应商 PVD 不对。不会写入。'
        ].join('\n')
      };
    }
    mode = 'ptpv';
    target = `${formatMoney(targetPtpv)} P.TPV`;
  }
  return { ok: true, plan: {
    mode,
    target,
    pcMedio: formatNumber(costInfo.pcMedio ?? pcMedio),
    pcUltimo: formatNumber(costInfo.pcUltimo ?? pcUltimo),
    cost: formatNumber(cost),
    costSource: costInfo.source,
    iva: formatNumber(iva),
    ivaSource: ivaInfo.source,
    targetWithoutIva: formatNumber(targetWithoutIva),
    pDefecto: formatNumber(pDefecto),
    price: formatNumber(item.precio?.value || supplierPvp || 0),
    marginPct: formatNumber(item.margen?.value || 0),
    bloqVentaChecked,
    warnings: costInfo.warnings || []
  } };
}

function formatPlan(plan) {
  return [
    '准备处理商品：',
    `计算方式：${plan.mode === 'margen' ? '直接填写 P.defecto 百分比' : '按 UnideGes 公式计算 P.defecto%'}`,
    `目标：${plan.target}`,
    `PC Medio: ${plan.pcMedio}`,
    `PC Último: ${plan.pcUltimo}`,
    `IVA: ${plan.iva}%（${plan.ivaSource}）`,
    plan.targetWithoutIva ? `P.TPV sin IVA: ${plan.targetWithoutIva}` : null,
    `采用成本: ${plan.cost || '-'}（${plan.costSource}）`,
    `将填 P.defecto: ${plan.pDefecto}%`,
    `Bloq.Venta: ${plan.bloqVentaChecked ? '已勾选，将取消勾选' : '未勾选，不动'}`,
    ...(plan.warnings || []).map((warning) => `提醒：${warning}`),
    '',
    '确认后才会写入桌面程序。'
  ].filter(Boolean).join('\n');
}

function saveSession(session) {
  const id = (nextSessionId++).toString(36);
  sessions.set(id, { ...session, createdAt: Date.now() });
  for (const [key, value] of sessions) if (Date.now() - value.createdAt > 30 * 60 * 1000) sessions.delete(key);
  return id;
}

function makeRepeatItem(query) { return { raw: query, codigo: query, ean: '', nombre: '', precio: { mode: 'auto', raw: 'auto' }, margen: { mode: 'missing', raw: '' }, desbloquear: true, etiqueta: false, nota: 'button repeat' }; }
function makeResultButtons(id) { return { inline_keyboard: [[{ text: '再查一次', callback_data: `repeat:${id}` }], [{ text: '确认处理', callback_data: `process:${id}` }, { text: '标签', callback_data: `todo:label:${id}` }]] }; }
// Botones para elegir una opción de la búsqueda por nombre: [1][2]… (5 por
// fila) + Cancelar. callback_data = np:<sesión>:<línea>:<opción>.
function makeNamePickButtons(id, idx, n) {
  const rows = [];
  let row = [];
  for (let i = 0; i < n; i += 1) {
    row.push({ text: `${i + 1}`, callback_data: `np:${id}:${idx}:${i}` });
    if (row.length === 5) { rows.push(row); row = []; }
  }
  if (row.length) rows.push(row);
  rows.push([{ text: '取消', callback_data: `cancel:${id}` }]);
  return { reply_markup: { inline_keyboard: rows } };
}
function futureActionLabel(action) { if (action.startsWith('label')) return '生成 etiqueta'; return '这个功能'; }
function getCostInfo(session, pcMedio, pcUltimo) {
  const warnings = [];
  const supplier = supplierCost(session.supplier?.product);
  if (isReasonableCost(supplier)) {
    if (Number.isFinite(pcUltimo) && pcUltimo > 0 && Math.abs(pcUltimo - supplier) > 0.001) warnings.push(`桌面 PC Último 已忽略，统一采用供应商 PVD。`);
    if (Number.isFinite(pcMedio) && pcMedio > 0 && Math.abs(pcMedio - supplier) > 0.001) warnings.push(`桌面 PC Medio 已忽略，统一采用供应商 PVD。`);
    return { value: supplier, source: '供应商表 PVD', pcMedio: supplier, pcUltimo: supplier, warnings };
  }
  const storeUltimo = parseNumber(session.store?.product?.coste_ultimo);
  if (isReasonableCost(storeUltimo)) return { value: storeUltimo, source: '店内缓存 coste_ultimo', pcMedio: storeUltimo, pcUltimo: storeUltimo, warnings };
  const storeMedio = parseNumber(session.store?.product?.coste_medio);
  if (isReasonableCost(storeMedio)) return { value: storeMedio, source: '店内缓存 coste_medio', pcMedio: storeMedio, pcUltimo: storeMedio, warnings };
  return { value: NaN, source: '未找到', warnings };
}
function getIvaInfo(session) {
  const storeIva = parseNumber(session.store?.product?.iva);
  if (Number.isFinite(storeIva) && storeIva >= 0) return { value: storeIva, source: '店内缓存' };
  const configured = parseNumber(config.processing?.defaultIva ?? 10);
  if (Number.isFinite(configured) && configured >= 0) return { value: configured, source: '默认配置' };
  return { value: 10, source: '默认10' };
}
function parseNumber(value) { const n = Number.parseFloat(String(value ?? '').replace(',', '.').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : NaN; }
function isReasonableCost(value) { return Number.isFinite(value) && value > 0 && value < 1000; }
function isReasonableMargin(value) { return Number.isFinite(value) && value >= -5 && value < 95; }
function formatNumber(value) { const n = Number(value); if (!Number.isFinite(n)) return ''; return n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '').replace('.', ','); }
function formatMoney(value) { return `${Number(value).toFixed(2).replace('.', ',')}`; }
function isAllowed(chatId, userId) { const allowed = config.telegram.allowedChatIds || []; if (!allowed.length) return true; const allowedStrings = new Set(allowed.map(String)); return allowedStrings.has(String(chatId)) || allowedStrings.has(String(userId)); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
