import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, readArg } from './config.js';
import { createLogger } from './logger.js';
import { formatTemplateHelp, parsePrice, parseProductMessage } from './templateParser.js';
import { parseFruitBatchLines, parseFruitCommandArg, partitionFruitBatch, resolveFruitCode, saveFruitEntry } from './fruitCodes.js';
import { buildDraftFromTally, buildTallyKeyboard, cycleCount, loadTemplate } from './orderTemplates.js';
import { fetchActivePromotions, formatPromotionsSummary } from './webPromotions.js';
import { enrichSupplierLookup, loadStoreIndex, loadSupplierIndex, lookupStore, suggestedPrice, supplierCost } from './supplierLookup.js';
import { applyOrderDesktop, applyPriceDesktop, clearDesktop, dumpUiaDesktop, readPriceDesktop, searchDesktop } from './desktopSearch.js';
import { inspectOrderPage, inspectFormPage, applyOrderWeb, searchArticleOptions, fetchArrivingOrders } from './webOrder.js';
import { ArrivalChecklistScheduler, addDays, formatChecklist, ordersArrivingOn, parseDateArg, printText, recordFilledOrder, todayString } from './arrivalChecklist.js';
import { formatProductResponse } from './formatResponse.js';
import { TelegramClient } from './telegram.js';
import { applyUpdatePackage } from './updater.js';
import {
  OrderReminderScheduler,
  enrichOrderItems,
  formatFruitPriceFlow,
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
const arrivalScheduler = new ArrivalChecklistScheduler(config, logger);
let offset = 0;

logger.info('unide product bot started', { desktopEnabled: config.desktop.enabled, supplierRows: supplierIndex.rows.length, storeRows: storeIndex.rows.length });

// OJO: el bucle de polling se ARRANCA AL FINAL del fichero (mainLoop()).
// Antes era un `while (true)` aquí en medio: como no termina nunca, los
// const/let declarados más abajo (LABEL_STEPS, fruitBatchRunning, …)
// quedaban sin inicializar para siempre y los handlers reventaban con
// "Cannot access ... before initialization".
async function mainLoop() {
  while (true) {
    try {
      const updates = await telegram.getUpdates({ offset, timeout: config.telegram.pollTimeoutSeconds });
      for (const update of updates) {
        offset = update.update_id + 1;
        // Aislar cada update: si uno falla (botón caducado, error puntual de
        // una acción), se registra y se sigue con el resto, sin abortar el
        // lote ni castigar el bucle con la espera de "polling error".
        try { await handleUpdate(update); }
        catch (error) { logger.error('update error', { updateId: update.update_id, error: error.message }); }
      }
      await maybeSendOrderReminder();
      await maybePrintArrivalChecklist();
    } catch (error) { logger.error('polling error', { error: error.message }); await sleep(3000); }
  }
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
  if (text === '/llegada' || text === '/llegada_hoy' || /^\/llegada\s+/.test(text)) { await handleArrivalChecklist(chatId, text); return; }
  if (/^\/precios_fruta\b/i.test(text) || (/^\/(precio_fruta|fruta_precio|precio_verdura)\b/i.test(text) && text.includes('\n'))) { await handleFruitPriceBatch(chatId, text); return; }
  if (/^\/(precio_fruta|fruta_precio|precio_verdura)\b/i.test(text)) { await handleFruitPrice(chatId, text); return; }
  if (/^\/fruta_add\b/i.test(text)) { await handleFruitAdd(chatId, text); return; }
  if (/^\/uia_dump\b/i.test(text)) { await handleUiaDump(chatId); return; }
  if (/^\/(carne|pedido_carne)\b/i.test(text)) { await startTally(chatId, 'carne'); return; }
  if (/^\/(promociones|promo)(?:@\w+)?(?:\s|$)/i.test(text)) { await handlePromotions(chatId, text); return; }
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
  if (data.startsWith('fpone:')) { await handleFruitPriceOne(chatId, callback.id, data.slice(6)); return; }
  if (data.startsWith('fpb:')) { await runFruitPriceBatch(chatId, callback.id, data.slice(4)); return; }
  if (data.startsWith('fpstop:')) { await handleFruitBatchStop(chatId, callback.id, data.slice(7)); return; }
  if (data.startsWith('fp:')) { await handleFruitPick(chatId, callback.id, data.slice(3)); return; }
  if (data.startsWith('tc:')) { await handleTallyTap(chatId, callback.id, data.slice(3)); return; }
  if (data.startsWith('tcgo:')) { await handleTallyGo(chatId, callback.id, data.slice(5)); return; }
  if (data.startsWith('tcclr:')) { await handleTallyClear(chatId, callback.id, data.slice(6)); return; }
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
  // Una línea en blanco entre opciones para que se lean sueltas.
  const list = res.options.map((o, i) => `[${i + 1}] ${o.name || o.text}`).join('\n\n');
  const body = `第 ${idx + 1} 行「${item.name}」找到 ${res.options.length} 个（数量 ${item.quantity}），点一个：\n\n${list}`;
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

// /precio_fruta [nombre] [precio] — cambio de precio de fruta/verdura.
// Sin argumentos: recuerda el flujo manual. Con nombre: resuelve el código
// (diccionario aprendido → tablas locales → botones para elegir). Con
// nombre + precio: además lanza el flujo de escritorio existente (buscar en
// Artículos → captura → 确认处理 → 确认写入), que ya pide confirmación en
// cada paso arriesgado. La impresión de la etiqueta queda manual.
async function handleFruitPrice(chatId, text) {
  const arg = String(text || '').replace(/^\/\S+\s*/, '').trim();
  if (!arg) {
    await telegram.sendMessage(chatId, `${formatFruitPriceFlow()}\n\n偷懒用法：/precio_fruta melocotón 2,99 → 我帮你查 código 并在桌面 Artículos 里填好价格（写入前都要你确认）。\n\n一堆一起改用 /precios_fruta，一行一个「名字/código 价格」，确认一次全自动改完。`);
    return;
  }
  const { name, priceRaw } = parseFruitCommandArg(arg);
  const resolved = resolveFruitCode(config, storeIndex, supplierIndex, name);
  if (resolved.status === 'found') {
    await startFruitPriceChange(chatId, name, resolved, priceRaw);
    return;
  }
  if (resolved.status === 'candidates') {
    const id = saveSession({ fruitPick: { name, priceRaw, candidates: resolved.candidates } });
    const list = resolved.candidates.map((c, i) => `[${i + 1}] ${c.articulo}（${c.codigo}）`).join('\n');
    const rows = [];
    let row = [];
    for (let i = 0; i < resolved.candidates.length; i += 1) {
      row.push({ text: `${i + 1}`, callback_data: `fp:${id}:${i}` });
      if (row.length === 5) { rows.push(row); row = []; }
    }
    if (row.length) rows.push(row);
    rows.push([{ text: '取消', callback_data: `cancel:${id}` }]);
    await telegram.sendMessage(chatId, `「${name}」在你的水果表里有 ${resolved.candidates.length} 个，点对的那个（我会记住，下次不再问）：\n\n${list}`, { reply_markup: { inline_keyboard: rows } });
    return;
  }
  await telegram.sendMessage(chatId, `你的水果表里没有「${name}」。如果你在 Diseño Pantalla 的 Acción 页看到了它的 código，可以登记一次：\n/fruta_add ${name} 12345\n以后就能直接 /precio_fruta ${name} 2,99 了。也可以直接用 código：/precio_fruta 616403 1,95`);
}

async function handleFruitPick(chatId, callbackId, payload) {
  const [id, idxStr] = payload.split(':');
  const session = sessions.get(id);
  const pick = session?.fruitPick;
  const chosen = pick?.candidates?.[Number(idxStr)];
  if (!chosen) { await telegram.answerCallbackQuery(callbackId, '选项已失效'); return; }
  await telegram.answerCallbackQuery(callbackId, `已选 ${chosen.codigo}`);
  saveFruitEntry(config, pick.name, chosen.codigo, chosen.articulo, logger);
  await telegram.sendMessage(chatId, `记住了：「${pick.name}」= ${chosen.articulo}（código ${chosen.codigo}）。`);
  await startFruitPriceChange(chatId, pick.name, { codigo: chosen.codigo, articulo: chosen.articulo }, pick.priceRaw);
}

// Construye el "item" de cambio de precio de fruta (mismo shape que usa el
// flujo de escritorio). labelReminder solo se usa en el individual (el lote
// recuerda las etiquetas UNA vez al final).
function makeFruitItem(name, codigo, articulo, priceRaw, labelReminder) {
  return {
    raw: `fruta ${name} ${priceRaw}`,
    codigo: String(codigo),
    ean: '',
    nombre: articulo || name,
    precio: parsePrice(priceRaw),
    margen: { mode: 'missing', raw: '' },
    desbloquear: false,
    etiqueta: true,
    nota: `precio fruta ${name}`,
    labelReminder: Boolean(labelReminder)
  };
}

// Ejecuta el cambio de precio de UN artículo en el escritorio de principio a
// fin: buscar → leer precios → calcular P.defecto → escribir. Devuelve
// { ok:true, plan, screenshot } o { ok:false, stage, error, screenshot }.
// Mismas validaciones que el flujo por pasos (buildPricePlan); si algo no
// cuadra, NO escribe. No imprime etiquetas. Lo comparten el individual y el
// lote, para que se comporten igual.
async function processFruitPriceOnce(item) {
  const store = lookupStore(storeIndex, item);
  const supplier = enrichSupplierLookup(supplierIndex, item, store);
  const found = await searchDesktop(item, config, logger, { byCode: true });
  if (found.status !== 'ok') return { ok: false, stage: 'search', error: found.error || found.reason || '未知' };
  const read = await readPriceDesktop(config, logger);
  if (read.status !== 'ok') return { ok: false, stage: 'read', error: read.error || read.reason || '未知' };
  // Verificación de que el artículo CORRECTO está en pantalla. La mejor
  // señal es leer el propio campo Código (copyField "codigoPantalla" en
  // priceReadSteps): si coincide, seguimos aunque PC Medio/PC Último estén
  // vacíos (en fruta suelen estarlo y el coste sale del PVD del proveedor);
  // si no coincide o lee vacío, NO se escribe. Sin codigoPantalla calibrado
  // se mantiene la guarda antigua de "todo vacío" para no escribir sobre un
  // formulario en blanco.
  const values = read.values || {};
  const warns = (read.warnings || []).join('；');
  if ('codigoPantalla' in values) {
    const screenCode = String(values.codigoPantalla ?? '').replace(/\D/g, '');
    if (!screenCode) {
      return { ok: false, stage: 'read', error: `Código 框读到空——商品没载入（código+F3 没生效？）${warns ? `。警告：${warns}` : ''}`, screenshot: read.screenshot };
    }
    if (screenCode !== String(item.codigo)) {
      return { ok: false, stage: 'read', error: `屏幕上载入的是 código ${screenCode}，不是 ${item.codigo}——为安全没有写入。`, screenshot: read.screenshot };
    }
  } else {
    const readValues = Object.entries(values).filter(([k]) => !/^bloq/i.test(k));
    if (readValues.length && readValues.every(([, v]) => !String(v ?? '').trim())) {
      return { ok: false, stage: 'read', error: `所有字段都读到空——商品可能没载入。建议在 priceReadSteps 加一行读 Código 框的 copyField（name: "codigoPantalla"），我就能精确判断${warns ? `。警告：${warns}` : ''}`, screenshot: read.screenshot };
    }
  }
  const planResult = buildPricePlan({ item, supplier, store }, read);
  if (!planResult.ok) return { ok: false, stage: 'plan', error: planResult.error };
  const applied = await applyPriceDesktop(planResult.plan, config, logger);
  if (applied.status !== 'ok') return { ok: false, stage: 'apply', error: applied.error || applied.reason || '未知', screenshot: applied.screenshot };
  return { ok: true, plan: planResult.plan, screenshot: applied.screenshot };
}

function fruitStageLabel(stage) {
  return { search: '搜索', read: '读取价格', plan: '计算/校验', apply: '写入' }[stage] || stage || '未知';
}

const LABEL_STEPS = [
  '接下来打印新价签（手动）：',
  '1. 关闭商品窗口 → 会弹出 Etiquetas 页面',
  '2. 点 Etiq. Especiales',
  '3. 勾选 Imprimir；Tipo Etiqueta 全改成 Tipo Display 8 A4 vertical',
  '4. 点 Imprimir'
];

async function startFruitPriceChange(chatId, name, resolved, priceRaw) {
  if (!priceRaw) {
    await telegram.sendMessage(chatId, `「${name}」的 código 是 ${resolved.codigo}${resolved.articulo ? `（${resolved.articulo}）` : ''}。\n要我帮你改价的话发：/precio_fruta ${name} 2,99`);
    return;
  }
  if (!config.desktop?.enabled) {
    await telegram.sendMessage(chatId, `código ${resolved.codigo}，新价格 ${priceRaw} €。桌面自动化没启用（desktop.enabled=false），请手动去 Artículos 改。`);
    return;
  }
  await telegram.sendMessage(chatId, `「${name}」→ código ${resolved.codigo}，目标 ${priceRaw} €。正在桌面 Artículos 里搜索…`);
  const item = makeFruitItem(name, resolved.codigo, resolved.articulo, priceRaw, true);
  // Una sola confirmación: se busca para que veas la CAPTURA y confirmes que
  // es el artículo correcto; al pulsar "确认改价" se hace leer→calcular→escribir
  // de una vez (al confirmar se vuelve a buscar, por si el escritorio se movió).
  const found = await searchDesktop(item, config, logger, { byCode: true });
  const id = saveSession({ fruitOne: { item, priceRaw } });
  const text = `「${item.nombre}」→ código ${item.codigo}，目标 ${priceRaw} €。\n核对下截图是不是这个商品，对的话点「确认改价」，我会读价→算 P.defecto→写入一次做完（算出来不合理会中止不写）。`;
  await sendWithOptionalScreenshot(chatId, found, text, {
    reply_markup: { inline_keyboard: [[
      { text: '确认改价', callback_data: `fpone:${id}` },
      { text: '取消', callback_data: `cancel:${id}` }
    ]] }
  });
}

async function handleFruitPriceOne(chatId, callbackId, id) {
  const session = sessions.get(id);
  const one = session?.fruitOne;
  if (!one?.item) { await telegram.answerCallbackQuery(callbackId, '记录已过期'); await telegram.sendMessage(chatId, '这条改价记录已过期，请再发一次 /precio_fruta。'); return; }
  if (one.running) { await telegram.answerCallbackQuery(callbackId, '正在改，别重复点'); return; }
  one.running = true;
  sessions.set(id, session);
  await telegram.answerCallbackQuery(callbackId, '正在改价');
  const label = one.item.nombre;
  const result = await processFruitPriceOnce(one.item);
  sessions.delete(id);
  if (!result.ok) {
    const text = `❌ ${label} 没改（${fruitStageLabel(result.stage)}）：${result.error}\n没有写入。`;
    await sendWithOptionalScreenshot(chatId, { status: result.screenshot ? 'ok' : 'error', screenshot: result.screenshot }, text);
    return;
  }
  await sendWithOptionalScreenshot(chatId, { status: 'ok', screenshot: result.screenshot },
    `✅ 已改：${label} → ${one.priceRaw} €（P.defecto ${result.plan.pDefecto}%）。看截图确认 P.defecto / Bloq.Venta / 保存状态。`);
  await telegram.sendMessage(chatId, LABEL_STEPS.join('\n'));
}

// /precios_fruta — cambio de precio de fruta/verdura EN LOTE. Una línea por
// artículo ("nombre 2,99" o "código 2,99"); se resuelven todos los códigos,
// se enseña UN plan y con UNA confirmación el bot va cambiando los precios
// en el UnideGes de escritorio uno tras otro (buscar → leer → calcular
// P.defecto → escribir), con las mismas validaciones por artículo que el
// flujo individual (coste/IVA/margen razonable; si algo no cuadra, ese
// artículo se salta y se informa, no se escribe). Las etiquetas se imprimen
// a mano al final, como pidió el usuario.
let fruitBatchRunning = false;

async function handleFruitPriceBatch(chatId, text) {
  const body = String(text || '').replace(/^\/\S+[ \t]*/, '');
  const entries = parseFruitBatchLines(body);
  if (!entries.length) {
    await telegram.sendMessage(chatId, [
      '批量改价用法：一行一个，名字或 código + 新价格。例如：',
      '/precios_fruta',
      'manzana golden 2,99',
      'plátano canarias 1,79',
      '73215 1,49',
      '',
      '确认一次后我会在桌面 UnideGes 里逐个自动改，etiquetas 最后手动打印。'
    ].join('\n'));
    return;
  }
  const { ready, issues } = partitionFruitBatch(config, storeIndex, supplierIndex, entries);

  const lines = [];
  if (ready.length) {
    lines.push(`批量改价计划（${ready.length} 个）：`);
    ready.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.articulo || it.name} → ${it.priceRaw} €（código ${it.codigo}）`);
    });
  }
  if (issues.length) {
    lines.push('', `⚠️ 这 ${issues.length} 行先跳过：`);
    for (const issue of issues) {
      if (issue.reason === 'no_price') lines.push(`- 「${issue.raw}」没写价格`);
      else if (issue.reason === 'ambiguous') lines.push(`- 「${issue.name}」有 ${issue.count} 个候选：单独发 /precio_fruta ${issue.name} 价格 挑一次，我会记住`);
      else lines.push(`- 「${issue.name}」没找到 código：可用 /fruta_add ${issue.name} 12345 登记`);
    }
  }
  if (!ready.length) {
    await telegram.sendMessage(chatId, lines.join('\n'));
    return;
  }
  if (!config.desktop?.enabled) {
    lines.push('', '桌面自动化没启用（desktop.enabled=false），启用后再发一次。');
    await telegram.sendMessage(chatId, lines.join('\n'));
    return;
  }
  const id = saveSession({ fruitBatch: { items: ready, stopped: false } });
  lines.push('', '确认后开始逐个写入，中途随时可以按「停止」。写完 etiquetas 手动打印。');
  await telegram.sendMessage(chatId, lines.join('\n'), {
    reply_markup: { inline_keyboard: [[
      { text: `开始改价 ${ready.length} 个`, callback_data: `fpb:${id}` },
      { text: '取消', callback_data: `cancel:${id}` }
    ]] }
  });
}

// /uia_dump — vuelca el árbol de controles de la ventana de UnideGes
// (AutomationId, nombre, tipo, valor) y lo manda como documento. Es el
// paso de reconocimiento para cablear los pasos uiaFocus/uiaRead/uiaSet
// por identidad de control, sin coordenadas ni contar tabulaciones.
async function handleUiaDump(chatId) {
  if (!config.desktop?.enabled) { await telegram.sendMessage(chatId, '桌面自动化没启用（desktop.enabled=false）。'); return; }
  await telegram.sendMessage(chatId, '正在扫描 UnideGes 窗口的控件树…');
  const result = await dumpUiaDesktop(config, logger);
  if (result.status !== 'ok') { await telegram.sendMessage(chatId, `扫描失败：${result.error || result.reason || '未知'}`); return; }
  const file = result.values?.uiaDumpFile;
  if (file && fs.existsSync(file)) {
    try {
      await telegram.sendDocument(chatId, file, '控件清单（转发给 Claude 就行）');
      return;
    } catch (error) {
      await telegram.sendMessage(chatId, `清单生成了但发送失败：${error.message}\n文件在：${file}`);
      return;
    }
  }
  await telegram.sendMessage(chatId, `扫描完了但没找到输出文件${file ? `：${file}` : ''}。`);
}

async function handleFruitBatchStop(chatId, callbackId, id) {
  const session = sessions.get(id);
  if (!session?.fruitBatch) { await telegram.answerCallbackQuery(callbackId, '这个批量任务已结束'); return; }
  session.fruitBatch.stopped = true;
  sessions.set(id, session);
  await telegram.answerCallbackQuery(callbackId, '收到，做完手头这个就停');
}

async function runFruitPriceBatch(chatId, callbackId, id) {
  const session = sessions.get(id);
  const batch = session?.fruitBatch;
  if (!batch?.items?.length) { await telegram.answerCallbackQuery(callbackId, '计划已过期'); await telegram.sendMessage(chatId, '这个批量计划已过期，请重新发 /precios_fruta。'); return; }
  if (fruitBatchRunning) { await telegram.answerCallbackQuery(callbackId, '已有批量任务在跑'); return; }
  if (batch.started) { await telegram.answerCallbackQuery(callbackId, '这个计划已经跑过了'); return; }
  batch.started = true;
  sessions.set(id, session);
  fruitBatchRunning = true;
  await telegram.answerCallbackQuery(callbackId, '开始');
  const total = batch.items.length;
  await telegram.sendMessage(chatId, `开始批量改价，共 ${total} 个。每改完一个我发一条进度。`, {
    reply_markup: { inline_keyboard: [[{ text: '⏹ 停止', callback_data: `fpstop:${id}` }]] }
  });

  const okItems = [];
  const failItems = [];
  let stopped = false;
  try {
    for (let i = 0; i < batch.items.length; i += 1) {
      if (sessions.get(id)?.fruitBatch?.stopped) { stopped = true; break; }
      const it = batch.items[i];
      const label = it.articulo || it.name;
      const progress = `${i + 1}/${total}`;
      try {
        const item = makeFruitItem(it.name, it.codigo, it.articulo, it.priceRaw, false);
        const result = await processFruitPriceOnce(item);
        if (!result.ok) {
          failItems.push({ it, error: `${fruitStageLabel(result.stage)}失败：${result.error}` });
          await telegram.sendMessage(chatId, `${progress} ❌ ${label}：${fruitStageLabel(result.stage)}失败`);
          continue;
        }
        okItems.push(it);
        await telegram.sendMessage(chatId, `${progress} ✅ ${label} → ${it.priceRaw} €（P.defecto ${result.plan.pDefecto}%）`);
      } catch (error) {
        logger.error('fruit batch item failed', { codigo: it.codigo, error: error.message });
        failItems.push({ it, error: error.message });
        await telegram.sendMessage(chatId, `${progress} ❌ ${label}：${error.message}`);
      }
    }
  } finally {
    fruitBatchRunning = false;
    sessions.delete(id);
  }

  const summary = [
    `批量改价结束${stopped ? '（手动停止）' : ''}：成功 ${okItems.length} / 失败 ${failItems.length}${stopped ? ` / 没跑 ${total - okItems.length - failItems.length}` : ''}`
  ];
  if (failItems.length) {
    summary.push('', '失败的：');
    for (const f of failItems) summary.push(`- ${f.it.articulo || f.it.name}（${f.it.codigo}）：${f.error}`);
    summary.push('', '失败的可以单独再跑：/precio_fruta 名字 价格');
  }
  if (okItems.length) {
    summary.push('', ...LABEL_STEPS);
  }
  await telegram.sendMessage(chatId, summary.join('\n'));
}

// /carne — recuento con el móvil que sustituye a la hoja de papel: la
// lista fija de carne sale como botones, cada toque suma 1 (0→…→5→0) y
// "生成订单" convierte el recuento en el borrador de pedido de siempre
// (misma confirmación y mismo 确认填入; aquí no se rellena nada aún).
async function startTally(chatId, name) {
  const template = loadTemplate(config, name);
  if (!template) { await telegram.sendMessage(chatId, `没有「${name}」的模板。`); return; }
  const id = saveSession({ tally: { name, template, counts: {} } });
  const sent = await telegram.sendMessage(
    chatId,
    `${template.label} 点货单（代替纸质表）：\n点商品名 = 数量 +1，点到 5 再点回 0。\n全部点完按「✔ 生成订单」。`,
    { reply_markup: buildTallyKeyboard(id, template, {}) }
  );
  const session = sessions.get(id);
  if (session && sent?.message_id) { session.tally.messageId = sent.message_id; sessions.set(id, session); }
}

async function handleTallyTap(chatId, callbackId, payload) {
  const [id, idxStr] = payload.split(':');
  const session = sessions.get(id);
  const tally = session?.tally;
  const idx = Number(idxStr);
  const item = tally?.template?.items?.[idx];
  if (!item) { await telegram.answerCallbackQuery(callbackId, '记录已过期，请重新发 /carne'); return; }
  tally.counts[idx] = cycleCount(tally.counts[idx]);
  sessions.set(id, session);
  await telegram.answerCallbackQuery(callbackId, `${item.nombre}: ${tally.counts[idx]}`);
  if (tally.messageId) {
    await telegram.editMessageReplyMarkup(chatId, tally.messageId, buildTallyKeyboard(id, tally.template, tally.counts));
  }
}

async function handleTallyClear(chatId, callbackId, id) {
  const session = sessions.get(id);
  const tally = session?.tally;
  if (!tally) { await telegram.answerCallbackQuery(callbackId, '记录已过期'); return; }
  tally.counts = {};
  sessions.set(id, session);
  await telegram.answerCallbackQuery(callbackId, '已清零');
  if (tally.messageId) {
    await telegram.editMessageReplyMarkup(chatId, tally.messageId, buildTallyKeyboard(id, tally.template, {}));
  }
}

async function handleTallyGo(chatId, callbackId, id) {
  const session = sessions.get(id);
  const tally = session?.tally;
  if (!tally) { await telegram.answerCallbackQuery(callbackId, '记录已过期，请重新发 /carne'); return; }
  const draft = buildDraftFromTally(tally.template, tally.counts, new Date(), config.ordering?.timezone || 'Europe/Madrid');
  if (!draft.items.length) { await telegram.answerCallbackQuery(callbackId, '还没点任何商品'); return; }
  await telegram.answerCallbackQuery(callbackId, `${draft.items.length} 行`);
  // Mismo camino que /pedido_nuevo: enriquecer + confirmación + 确认填入.
  const { draft: enriched } = enrichOrderItems(draft, storeIndex, supplierIndex);
  const draftId = saveSession({ orderDraft: enriched });
  await telegram.sendMessage(chatId, formatOrderDraft(enriched), makeOrderDraftButtons(draftId));
}

// /promociones [fecha] — lee Promociones, filtra las no caducadas y abre
// cada una para sacar sus artículos. Solo lectura: no guarda ni modifica.
// Manda un resumen + CSV completo (y la captura/estructura si algo falla).
async function handlePromotions(chatId, text = '') {
  const today = todayString(config);
  const arg = String(text || '').replace(/^\/(promociones|promo)(?:@\w+)?\s*/i, '').trim();
  const requested = parseDateArg(arg, today);
  if (arg && !requested) {
    await telegram.sendMessage(chatId, `没看懂日期「${arg}」。可以写 /promociones（今天）或 /promociones 2026-07-06。`);
    return;
  }
  const dateStr = requested || today;
  await telegram.sendMessage(chatId, `正在读取 Promociones，筛选 ${dateStr} 未过期项目，并逐个打开抓商品明细…（Edge 要开着）`);
  const result = await fetchActivePromotions(config, dateStr, logger);
  if (!result.ok) {
    await sendWithOptionalScreenshot(chatId, result, `Promociones 抓取失败（${result.stage || '?'}）：\n${result.error || '未知错误'}`);
    if (result.dumpFile) { try { await telegram.sendDocument(chatId, result.dumpFile, 'Promociones 页面结构（发给 Claude）'); } catch { /* noop */ } }
    return;
  }
  await sendWithOptionalScreenshot(chatId, result, formatPromotionsSummary(result, config));
  if (result.outputFile) {
    try { await telegram.sendDocument(chatId, result.outputFile, '完整未过期 Promociones 商品明细 CSV'); }
    catch (error) { await telegram.sendMessage(chatId, `CSV 发送失败：${error.message}\n文件在电脑：${result.outputFile}`); }
  }
  // Si hay promociones cuyo detalle salió vacío, mandar un volcado de una
  // de ellas para distinguir "sin productos de verdad" de "no se detectó el
  // grid", y afinar si hace falta.
  if (result.failedDetails?.length && result.detailDumpFiles?.length) {
    await telegram.sendMessage(chatId, `有 ${result.failedDetails.length} 个促销详情没抓到商品。附上一个的页面结构，发给 Claude 判断是本来就没商品还是要调选择器：`);
    for (const dump of result.detailDumpFiles) {
      try { await telegram.sendDocument(chatId, dump, '促销详情页结构（发给 Claude）'); } catch { /* noop */ }
    }
  }
  // Si la lista externa parece incompleta (solo se leyeron promos sin
  // caducar), mandar el volcado de la lista para arreglar su paginación.
  if (result.listMaybeTruncated && result.listDumpFile) {
    await telegram.sendMessage(chatId, `外层只读到 ${result.totalRows} 个促销、且都未过期，可能没翻到有过期项的后续分页。附上列表页结构，发给 Claude 修外层翻页：`);
    try { await telegram.sendDocument(chatId, result.listDumpFile, 'Promociones 列表页结构（发给 Claude）'); } catch { /* noop */ }
  }
}

// /fruta_add <nombre> <codigo> — registrar a mano un nombre → código.
async function handleFruitAdd(chatId, text) {
  const arg = String(text || '').replace(/^\/\S+\s*/, '').trim();
  const match = arg.match(/^(.*\S)\s+(\d{4,})$/);
  if (!match) {
    await telegram.sendMessage(chatId, '格式：/fruta_add 名字 código\n例如：/fruta_add melocotón rojo 123456');
    return;
  }
  const ok = saveFruitEntry(config, match[1], match[2], match[1], logger);
  await telegram.sendMessage(chatId, ok
    ? `记住了：「${match[1]}」= código ${match[2]}。以后可以直接 /precio_fruta ${match[1]} 2,99`
    : '没存上（写文件失败），再试一次。');
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
    // Registrar el pedido rellenado para la lista de comprobación del día
    // de llegada (solo si todas las líneas entraron bien).
    if (result.ok) recordFilledOrder(config, session.orderDraft, logger);
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

// Junta los pedidos que llegan en dateStr. Primero la WEB de Pedidos (así
// entran también los pedidos hechos a mano o importados desde la PDA); si
// la web falla o está desactivada, el historial local (solo pedidos que
// rellenó el bot) como respaldo.
async function collectArrivalOrders(dateStr) {
  const offset = Number.isFinite(Number(config.arrival?.offsetDays)) ? Number(config.arrival.offsetDays) : 2;
  if (config.webOrder?.enabled) {
    const creationDate = addDays(dateStr, -offset);
    const res = await fetchArrivingOrders(config, creationDate, logger);
    if (res.ok) return { source: 'web', orders: res.orders };
    logger.warn('web arrival fetch failed, using local history', { error: res.error });
    return { source: 'local', orders: ordersArrivingOn(config, dateStr), webError: res.error };
  }
  return { source: 'local', orders: ordersArrivingOn(config, dateStr) };
}

function arrivalSourceNote(collected) {
  if (collected.source === 'web') return '（从 Pedidos 网页抓取，含 PDA/手工单）';
  const err = collected.webError ? `网页抓取失败：${collected.webError}，` : '';
  return `（${err}用了本地记录，只含 bot 填过的单）`;
}

// Impresión automática de la lista de comprobación el día de llegada.
async function maybePrintArrivalChecklist() {
  const due = arrivalScheduler.due(new Date());
  if (!due) return;
  const collected = await collectArrivalOrders(due.dateStr);
  if (!collected.orders.length) {
    // Hoy no llega nada: se marca para no volver a mirar en cada poll.
    arrivalScheduler.markSent(due.key);
    return;
  }
  const delivered = await sendAndPrintChecklist(arrivalChatIds(), collected, due.dateStr);
  if (delivered) arrivalScheduler.markSent(due.key);
}

// /llegada [fecha] — saca la lista a demanda (imprime + Telegram). Sin
// fecha usa hoy; con fecha ("/llegada 1/7") esa fecha se toma como día de
// LLEGADA (útil para probar con pedidos pasados).
async function handleArrivalChecklist(chatId, text = '') {
  const today = todayString(config);
  const arg = String(text || '').replace(/^\/llegada(?:_hoy)?\s*/i, '').trim();
  const requested = parseDateArg(arg, today);
  if (arg && !requested) {
    await telegram.sendMessage(chatId, `没看懂日期「${arg}」。可以写 /llegada（今天）、/llegada 1/7 或 /llegada 2026-07-01。`);
    return;
  }
  const dateStr = requested || today;
  const label = dateStr === today ? '今天' : dateStr;
  await telegram.sendMessage(chatId, `正在查${label}预计到货的订单…`);
  const collected = await collectArrivalOrders(dateStr);
  if (!collected.orders.length) {
    await telegram.sendMessage(chatId, `${label}（${dateStr}）没有预计到货的订单${arrivalSourceNote(collected)}。到货日按下单日 +${config.arrival?.offsetDays ?? 2} 天算。`);
    return;
  }
  await sendAndPrintChecklist([chatId], collected, dateStr);
}

// Imprime la lista y manda por Telegram solo una CONFIRMACIÓN corta (la
// lista entera en el chat era demasiado larga). El texto completo solo se
// manda como respaldo si la impresión no salió (no-Windows, error o
// autoPrint desactivado). Devuelve true si algo llegó (para markSent).
async function sendAndPrintChecklist(chatIds, collected, dateStr) {
  const orders = collected.orders;
  const checklist = formatChecklist(orders, dateStr);
  const names = orders.map((o) => `${o.orderName}（${o.items?.length ?? 0} 行）`).join('、');
  const summary = `到货核对清单：${names}，共 ${orders.length} 单${arrivalSourceNote(collected)}。`;
  let delivered = false;

  let text;
  if (config.arrival?.autoPrint !== false) {
    const printed = await printText(config, checklist, logger);
    if (printed.ok && !printed.queuedOffline) {
      delivered = true;
      text = `${summary}\n🖨 已打印，去打印机拿纸核对就行。`;
    } else if (printed.ok && printed.queuedOffline) {
      delivered = true;
      text = `${summary}\n⚠️ 打印机好像没开机。清单已排进打印队列，开一下打印机就会自动打出来。`;
    } else {
      const reason = printed.skipped ? '这台机器不能打印（非 Windows）' : `打印失败：${printed.error}`;
      text = `${summary}\n${reason}，先发文字版：\n\n${checklist}`;
    }
  } else {
    text = `${summary}\n（自动打印已关闭）\n\n${checklist}`;
  }

  for (const id of chatIds) {
    try {
      await telegram.sendMessage(id, text);
      delivered = true;
    } catch (error) {
      logger.error('arrival checklist send failed', { chatId: id, error: error.message });
    }
  }
  return delivered;
}

function arrivalChatIds() {
  const configured = config.arrival?.chatIds || [];
  const fallback = config.ordering?.reminderChatIds || [];
  const last = config.telegram?.allowedChatIds || [];
  const ids = configured.length ? configured : (fallback.length ? fallback : last);
  return ids.map(String).filter(Boolean);
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
  // Cambio de precio de fruta: recordar los pasos MANUALES de la etiqueta
  // (imprimir es acción de alto riesgo; no se automatiza).
  if (result.status === 'ok' && session.item?.labelReminder) {
    await telegram.sendMessage(chatId, [
      '接下来打印新价签（手动）：',
      '1. 关闭商品窗口 → 会弹出 Etiquetas 页面',
      '2. 点 Etiq. Especiales',
      '3. 勾选 Imprimir；Tipo Etiqueta 全改成 Tipo Display 8 A4 vertical',
      '4. 点 Imprimir'
    ].join('\n'));
  }
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

// Arranque: TODAS las declaraciones de arriba ya están inicializadas.
await mainLoop();
