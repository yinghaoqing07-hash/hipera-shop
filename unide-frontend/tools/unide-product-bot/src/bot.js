import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, readArg } from './config.js';
import { createLogger } from './logger.js';
import { formatTemplateHelp, parseProductMessage } from './templateParser.js';
import { enrichSupplierLookup, loadStoreIndex, loadSupplierIndex, lookupStore, suggestedPrice, supplierCost } from './supplierLookup.js';
import { applyPriceDesktop, clearDesktop, readPriceDesktop, searchDesktop } from './desktopSearch.js';
import { formatProductResponse } from './formatResponse.js';
import { TelegramClient } from './telegram.js';
import { applyUpdatePackage } from './updater.js';

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
let offset = 0;

logger.info('unide product bot started', { desktopEnabled: config.desktop.enabled, supplierRows: supplierIndex.rows.length, storeRows: storeIndex.rows.length });

while (true) {
  try {
    const updates = await telegram.getUpdates({ offset, timeout: config.telegram.pollTimeoutSeconds });
    for (const update of updates) { offset = update.update_id + 1; await handleUpdate(update); }
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
  if (data === 'clear') { await handleClear(chatId, callback.id); return; }
  if (data.startsWith('process:')) { await handleProcess(chatId, callback.id, data.slice(8)); return; }
  if (data.startsWith('apply:')) { await handleApply(chatId, callback.id, data.slice(6)); return; }
  if (data.startsWith('cancel:')) { sessions.delete(data.slice(7)); await telegram.answerCallbackQuery(callback.id, '已取消'); await telegram.sendMessage(chatId, '已取消，不会执行任何桌面操作。'); return; }
  if (data.startsWith('todo:')) { const label = futureActionLabel(data.slice(5)); await telegram.answerCallbackQuery(callback.id, `${label}还没实现`); await telegram.sendMessage(chatId, `${label}：按钮入口已预留，但现在还不会执行任何桌面操作。`); return; }
  await telegram.answerCallbackQuery(callback.id, '这个按钮已经失效');
}

async function handleClear(chatId, callbackId) {
  await telegram.answerCallbackQuery(callbackId, '正在清零');
  const result = await clearDesktop(config, logger);
  const text = result.status === 'ok' ? '清零：已执行。' : `清零：失败。\n${result.error || result.reason || '未知错误'}`;
  if (result.status === 'ok' && result.screenshot && fs.existsSync(result.screenshot)) await telegram.sendPhoto(chatId, result.screenshot, text);
  else await telegram.sendMessage(chatId, text);
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
    ? '写入：已执行。请看截图确认 P.defecto、P.TPV、Bloq.Venta 和保存状态。'
    : `写入失败：\n${result.error || result.reason || '未知错误'}`;
  if (result.status === 'ok' && result.screenshot && fs.existsSync(result.screenshot)) await telegram.sendPhoto(chatId, result.screenshot, text);
  else await telegram.sendMessage(chatId, text);
}

async function sendProductResult(chatId, item, index, total) {
  const desktop = await searchDesktop(item, config, logger);
  const store = lookupStore(storeIndex, item);
  const supplier = enrichSupplierLookup(supplierIndex, item, store);
  const response = formatProductResponse({ item, supplier, store, desktop, index, total });
  const id = saveSession({ item, supplier, store, desktop });
  const buttons = makeResultButtons(id);
  if (desktop.status === 'ok' && desktop.screenshot && fs.existsSync(desktop.screenshot)) await telegram.sendPhoto(chatId, desktop.screenshot, response, { reply_markup: buttons });
  else await telegram.sendMessage(chatId, response, { reply_markup: buttons });
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
  let pDefecto;
  let mode;
  let target;
  if (item.margen?.mode === 'manual') {
    const margin = item.margen.value;
    if (margin <= 0 || margin >= 95) return { ok: false, error: `margen 不合理：${margin}` };
    pDefecto = margin;
    mode = 'margen';
    target = `P.defecto ${formatNumber(margin)}%`;
  } else {
    if (!Number.isFinite(cost) || cost <= 0) return { ok: false, error: '没有可用成本。桌面 PC Medio/PC Último 为空，供应商表也没有 PVD。' };
    const targetPtpv = item.precio?.mode === 'manual' ? item.precio.value : supplierPvp;
    if (!Number.isFinite(targetPtpv) || targetPtpv <= 0) return { ok: false, error: '没有可用价格。请写 precio: 2,69 或 margen: 30。' };
    pDefecto = ((targetPtpv - cost) / cost) * 100;
    mode = 'ptpv';
    target = `${formatMoney(targetPtpv)} P.TPV`;
  }
  return { ok: true, plan: {
    mode,
    target,
    pcMedio: formatNumber(pcMedio),
    pcUltimo: formatNumber(pcUltimo),
    cost: formatNumber(cost),
    costSource: costInfo.source,
    pDefecto: formatNumber(pDefecto),
    price: formatNumber(item.precio?.value || supplierPvp || 0),
    marginPct: formatNumber(item.margen?.value || 0),
    bloqVentaChecked
  } };
}

function formatPlan(plan) {
  return [
    '准备处理商品：',
    `计算方式：${plan.mode === 'margen' ? '直接填写 P.defecto 百分比' : '按 P.TPV 比成本高多少来算 P.defecto%'}`,
    `目标：${plan.target}`,
    `PC Medio: ${plan.pcMedio}`,
    `PC Último: ${plan.pcUltimo}`,
    `采用成本: ${plan.cost || '-'}（${plan.costSource}）`,
    `将填 P.defecto: ${plan.pDefecto}%`,
    `Bloq.Venta: ${plan.bloqVentaChecked ? '已勾选，将取消勾选' : '未勾选，不动'}`,
    '',
    '确认后才会写入桌面程序。'
  ].join('\n');
}

function saveSession(session) {
  const id = (nextSessionId++).toString(36);
  sessions.set(id, { ...session, createdAt: Date.now() });
  for (const [key, value] of sessions) if (Date.now() - value.createdAt > 30 * 60 * 1000) sessions.delete(key);
  return id;
}

function makeRepeatItem(query) { return { raw: query, codigo: query, ean: '', nombre: '', precio: { mode: 'auto', raw: 'auto' }, margen: { mode: 'missing', raw: '' }, desbloquear: true, etiqueta: false, nota: 'button repeat' }; }
function makeResultButtons(id) { return { inline_keyboard: [[{ text: '再查一次', callback_data: `repeat:${id}` }], [{ text: '确认处理', callback_data: `process:${id}` }, { text: '标签', callback_data: `todo:label:${id}` }]] }; }
function futureActionLabel(action) { if (action.startsWith('label')) return '生成 etiqueta'; return '这个功能'; }
function getCostInfo(session, pcMedio, pcUltimo) {
  if (Number.isFinite(pcUltimo) && pcUltimo > 0) return { value: pcUltimo, source: 'PC Último 桌面' };
  if (Number.isFinite(pcMedio) && pcMedio > 0) return { value: pcMedio, source: 'PC Medio 桌面' };
  const supplier = supplierCost(session.supplier?.product);
  if (Number.isFinite(supplier) && supplier > 0) return { value: supplier, source: '供应商表 PVD' };
  const storeUltimo = parseNumber(session.store?.product?.coste_ultimo);
  if (Number.isFinite(storeUltimo) && storeUltimo > 0) return { value: storeUltimo, source: '店内缓存 coste_ultimo' };
  const storeMedio = parseNumber(session.store?.product?.coste_medio);
  if (Number.isFinite(storeMedio) && storeMedio > 0) return { value: storeMedio, source: '店内缓存 coste_medio' };
  return { value: NaN, source: '未找到' };
}
function parseNumber(value) { const n = Number.parseFloat(String(value ?? '').replace(',', '.').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : NaN; }
function formatNumber(value) { const n = Number(value); if (!Number.isFinite(n)) return ''; return n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '').replace('.', ','); }
function formatMoney(value) { return `${Number(value).toFixed(2).replace('.', ',')}`; }
function isAllowed(chatId, userId) { const allowed = config.telegram.allowedChatIds || []; if (!allowed.length) return true; const allowedStrings = new Set(allowed.map(String)); return allowedStrings.has(String(chatId)) || allowedStrings.has(String(userId)); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
