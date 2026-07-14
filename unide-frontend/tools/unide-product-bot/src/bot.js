import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { loadConfig, readArg } from './config.js';
import { createLogger } from './logger.js';
import { formatTemplateHelp, parsePrice, parseProductMessage } from './templateParser.js';
import { parseFruitBatchLines, parseFruitCommandArg, partitionFruitBatch, resolveFruitCode, saveFruitEntry } from './fruitCodes.js';
import { buildDraftFromTally, buildTallyKeyboard, cycleCount, loadTemplate } from './orderTemplates.js';
import { fetchActivePromotions, formatPromotionsSummary } from './webPromotions.js';
import { buildOrderAdvice, buildRelevanceSets, buildSavingsAdvice, findLatestPromotionsCsv, formatAdvice, formatAdviceDetail, formatOrderAdvice, formatOrderAdviceDetail, parsePromotionsCsv } from './promoAdvisor.js';
import { llmComposeReply, llmConfigured, llmExtractMemories, llmFriendlyError, llmKeyboardIntro, llmPickSimilarPromos, llmRouteIntent } from './llm.js';
import { MemoryStore, formatMemoryList, parseMemoryCommand, shouldConsiderForMemory } from './memoryStore.js';
import { OperationLedger, formatOperationHistory, parseOperationHistoryRequest } from './operationLedger.js';
import { ScheduledTaskStore, formatScheduledTask, formatTaskList, parseLlmScheduleArgument, parseScheduleCommand } from './scheduledTasks.js';
import { AutoAdvisorScheduler } from './autoAdvisor.js';
import { startPanel } from './panel.js';
import { enrichSupplierLookup, loadStoreIndex, loadSupplierIndex, lookupStore, suggestedPrice, supplierCost } from './supplierLookup.js';
import { applyBloqDesktop, applyOrderDesktop, applyPriceDesktop, clearDesktop, discardDesktop, dumpUiaDesktop, readPriceDesktop, searchDesktop } from './desktopSearch.js';
import { inspectOrderPage, inspectFormPage, applyOrderWeb, saveOrderWeb, sendOrderWeb, searchArticleOptions, fetchArrivingOrders, fetchOrderLinesByName, fetchOrdersBySelectors, fetchLatestOrders, listOrders } from './webOrder.js';
import { formatRecentOrdersSummary, parseRecentOrdersRequest } from './recentOrders.js';
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
const START_TIME = Date.now(); // identifica ESTE arranque (ver status.boot)
const config = loadConfig(readArg('--config'));
const logger = createLogger(config.logsDir);
const memoryStore = new MemoryStore(config.memory, logger);
const operationLedger = new OperationLedger(config.operationLedger, logger);
const scheduledTasks = new ScheduledTaskStore(config.scheduledTasks, logger);
let memoryLearnQueue = Promise.resolve();
const replyContextByChat = new Map();
const supplierIndex = loadSupplierIndex(config.supplierCsv);
const storeIndex = loadStoreIndex(config.storeCsv);
const sessions = new Map();
let nextSessionId = 1;
let scheduledTaskRunnerActive = false;

if (process.argv.includes('--help')) { console.log('Usage: node src/bot.js --config config.local.json'); process.exit(0); }

const token = process.env.TELEGRAM_BOT_TOKEN;
const telegram = new TelegramClient(token);

// --- transcripción de la conversación (para el chat del panel) -----------
// El bot es el punto de paso de TODOS los mensajes: lo que llega de
// Telegram, lo tecleado en el panel y lo que él responde — botones de
// confirmación y capturas incluidos, para que TODO lo que se puede hacer
// desde el móvil se pueda hacer también desde el panel. Se guarda una
// transcripción (últimos 300) en logs/panel-chat.json.
const CHAT_LOG_FILE = () => path.resolve(config.logsDir || '.', 'panel-chat.json');
let chatLog = [];
let chatSeq = 0;
let chatEntryId = 0;
try {
  const saved = JSON.parse(fs.readFileSync(CHAT_LOG_FILE(), 'utf8'));
  if (Array.isArray(saved.messages)) {
    chatLog = saved.messages;
    chatSeq = Number(saved.seq) || chatLog.length;
    chatEntryId = Number(saved.entryId) || chatLog.length;
  }
} catch { /* primera vez */ }
try {
  if (config.operationLedger?.importRecentChat !== false) {
    operationLedger.importLegacyChat(chatLog);
  }
} catch (error) {
  logger.warn('legacy operation import failed', { error: error.message });
}
let chatSaveTimer = null;
function scheduleChatSave() {
  clearTimeout(chatSaveTimer);
  chatSaveTimer = setTimeout(() => {
    try { fs.writeFileSync(CHAT_LOG_FILE(), JSON.stringify({ seq: chatSeq, entryId: chatEntryId, messages: chatLog })); }
    catch (error) { logger.warn('chat log save failed', { error: error.message }); }
  }, 1500);
}
function recordChat(from, text, extra = {}) {
  const clean = String(text ?? '').trim();
  if (!clean && !extra.photo) return null;
  chatSeq += 1;
  chatEntryId += 1;
  const entry = { id: chatEntryId, seq: chatSeq, at: new Date().toISOString(), from, text: clean.slice(0, 4000) };
  if (extra.buttons) entry.buttons = extra.buttons;
  if (extra.photo) entry.photo = extra.photo;
  if (extra.doc) entry.doc = extra.doc;
  chatLog.push(entry);
  if (chatLog.length > 300) chatLog = chatLog.slice(-300);
  scheduleChatSave();
  return entry;
}
// Un botón pulsado o un teclado editado cambian una entrada EXISTENTE: se
// le sube el seq para que el polling incremental del panel la vuelva a traer
// (el cliente la actualiza en sitio por id).
function bumpChatEntry(entry) {
  chatSeq += 1;
  entry.seq = chatSeq;
  scheduleChatSave();
}
function buttonsFromMarkup(options) {
  const kb = options?.reply_markup?.inline_keyboard;
  if (!Array.isArray(kb)) return undefined;
  return kb.map((row) => row.map((b) => ({ t: String(b.text || ''), d: String(b.callback_data || '') })));
}
// Respuestas de answerCallbackQuery para clics hechos DESDE el panel (el id
// sintético no existe en Telegram): se capturan aquí y el endpoint /callback
// las devuelve como toast.
const panelToasts = new Map();
{
  const origAnswer = telegram.answerCallbackQuery.bind(telegram);
  telegram.answerCallbackQuery = async (id, text = '') => {
    if (String(id).startsWith('panelcb:')) { panelToasts.set(String(id), String(text || '')); return { ok: true }; }
    return origAnswer(id, text);
  };
  const origEditMarkup = telegram.editMessageReplyMarkup.bind(telegram);
  telegram.editMessageReplyMarkup = async (chatId, messageId, replyMarkup) => {
    const entry = chatLog.find((e) => e.tgMessageId === messageId);
    if (entry) { entry.buttons = buttonsFromMarkup({ reply_markup: replyMarkup }); bumpChatEntry(entry); }
    return origEditMarkup(chatId, messageId, replyMarkup);
  };
  const origSendMessage = telegram.sendMessage.bind(telegram);
  telegram.sendMessage = async (chatId, text, options = {}) => {
    const { __noLog, __apiReady, __skipAI, __replyKind, ...rest } = options || {};
    const original = String(text ?? '');
    const finalText = (__noLog || __apiReady || __skipAI)
      ? original
      : await composeOutgoingReply(chatId, original, { kind: __replyKind, maxChars: 3900 });
    const entry = __noLog ? null : recordChat('bot', finalText, { buttons: buttonsFromMarkup(rest) });
    const result = await origSendMessage(chatId, finalText, rest);
    if (entry && result?.message_id) { entry.tgMessageId = result.message_id; scheduleChatSave(); }
    // Mensajes con teclado: el panel ya enseña las instrucciones junto a los
    // botones (columna izquierda); en el chat del panel se sustituyen por una
    // frase corta escrita por la IA (entry.resumen). Telegram no cambia — en
    // el movil el teclado cuelga de este mensaje y necesita su texto.
    // Umbral bajo: el texto del recuento son ~56 caracteres CJK en 3 lineas
    // y el primer umbral (60) lo dejaba pasar sin resumen.
    if (entry && entry.buttons?.length && (finalText.length > 30 || finalText.includes('\n')) && llmConfigured(config)) {
      llmKeyboardIntro(finalText, config, logger)
        .then((frase) => { entry.resumen = frase.slice(0, 120); bumpChatEntry(entry); })
        .catch((error) => logger.warn('keyboard intro failed', { error: error.message }));
    }
    return result;
  };
  for (const method of ['sendPhoto', 'sendDocument']) {
    const original = telegram[method].bind(telegram);
    telegram[method] = async (chatId, filePath, caption = '', options = {}) => {
      const { __apiReady, __skipAI, __replyKind, ...rest } = options || {};
      const rawCaption = String(caption || '');
      const finalCaption = (!rawCaption || __apiReady || __skipAI)
        ? rawCaption
        : await composeOutgoingReply(chatId, rawCaption, { kind: __replyKind || 'caption', maxChars: 950 });
      const entry = method === 'sendPhoto'
        ? recordChat('bot', finalCaption, { photo: String(filePath), buttons: buttonsFromMarkup(rest) })
        : recordChat('bot', `📎 ${path.basename(String(filePath))}${finalCaption ? ` — ${finalCaption}` : ''}`, { doc: String(filePath), buttons: buttonsFromMarkup(rest) });
      const result = await original(chatId, filePath, finalCaption, rest);
      if (entry && result?.message_id) { entry.tgMessageId = result.message_id; scheduleChatSave(); }
      return result;
    };
  }
}
const orderReminderScheduler = new OrderReminderScheduler(config, logger);
const arrivalScheduler = new ArrivalChecklistScheduler(config, logger);
const autoAdvisor = new AutoAdvisorScheduler(config, logger);
let offset = 0;

logger.info('unide product bot started', { desktopEnabled: config.desktop.enabled, supplierRows: supplierIndex.rows.length, storeRows: storeIndex.rows.length, memories: memoryStore.count, operations: operationLedger.count });

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
      await maybeRunAutoAdvisor();
      await maybeRunScheduledTasks();
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
  notePanelActivity(text);
  recordChat(update.__panel ? 'panel' : 'user', text);
  // natural=true cuando la dueña escribe en lenguaje natural (no un
  // comando /): en ese modo las respuestas se redactan SIN plantillas.
  replyContextByChat.set(String(chatId), { text, at: Date.now(), natural: !String(text || '').trim().startsWith('/') });
  const memoryCommand = parseMemoryCommand(text);
  if (memoryCommand) {
    await handleMemoryCommand(chatId, memoryCommand);
    return;
  }
  const operationHistoryRequest = parseOperationHistoryRequest(text);
  if (operationHistoryRequest) {
    await handlePriceHistory(chatId, operationHistoryRequest);
    return;
  }
  const scheduleCommand = parseScheduleCommand(text, new Date());
  if (scheduleCommand) {
    await handleScheduledTaskCommand(chatId, scheduleCommand, text);
    return;
  }
  queueAutoMemory(chatId, text);
  const recentOrdersRequest = parseRecentOrdersRequest(text);
  if (recentOrdersRequest) {
    await handleRecentOrders(chatId, recentOrdersRequest);
    return;
  }
  if (text === '/start' || text === '/help' || /^\/(comandos|commands|menu)\b/i.test(text)) { await telegram.sendMessage(chatId, formatCommandList()); return; }
  if (/^\/plantillas?\b/i.test(text)) { await telegram.sendMessage(chatId, formatTemplateHelp()); return; }
  if (text === '/pedido_web_test' || text === '/pedido_test') { await handlePedidoWebTest(chatId); return; }
  if (text === '/llegada' || text === '/llegada_hoy' || /^\/llegada\s+/.test(text)) { await handleArrivalChecklist(chatId, text); return; }
  if (/^\/precios_fruta\b/i.test(text) || (/^\/(precio_fruta|fruta_precio|precio_verdura)\b/i.test(text) && text.includes('\n'))) { await handleFruitPriceBatch(chatId, text); return; }
  if (/^\/(precio_fruta|fruta_precio|precio_verdura)\b/i.test(text)) { await handleFruitPrice(chatId, text); return; }
  if (/^\/fruta_add\b/i.test(text)) { await handleFruitAdd(chatId, text); return; }
  if (/^\/bloq(?:_venta)?\b/i.test(text)) { await handleBloqVenta(chatId, text); return; }
  if (/^\/uia_dump\b/i.test(text)) { await handleUiaDump(chatId); return; }
  if (/^\/(carne|pedido_carne)\b/i.test(text)) { await startTally(chatId, 'carne'); return; }
  if (/^\/(promociones|promo)(?:@\w+)?(?:\s|$)/i.test(text)) { await handlePromotions(chatId, text); return; }
  if (/^\/ahorro_pedido\b/i.test(text)) { await handleAhorroPedido(chatId, text); return; }
  if (/^\/(ahorro|estrategia)\b/i.test(text)) { await handleAhorro(chatId); return; }
  if (text === '/pedido_web_form' || text === '/pedido_form') { await handlePedidoWebForm(chatId); return; }
  if (isOrderDraftCommand(text)) { await handleOrderDraft(chatId, text); return; }
  if (isOrderCommand(text)) { await telegram.sendMessage(chatId, formatOrderResponse(parseOrderMode(text), new Date(), config), makeOrderButtons()); return; }
  const parsed = parseProductMessage(text);
  if (!parsed.ok) {
    // Texto libre ("帮我打一下152的清单"): si hay LLM configurado, que él
    // decida a qué comando corresponde; si no, la ayuda de siempre.
    if (!text.startsWith('/') && llmConfigured(config)) { await handleFreeText(chatId, text); return; }
    await telegram.sendMessage(chatId, formatCommandList());
    return;
  }
  const maxItems = config.telegram.maxItemsPerMessage ?? 5;
  const items = parsed.items.slice(0, maxItems);
  if (parsed.items.length > items.length) await telegram.sendMessage(chatId, `这次先处理前 ${items.length} 个商品，剩下的请分批发。`);
  for (let index = 0; index < items.length; index += 1) await sendProductResult(chatId, items[index], index, items.length);
}

async function handleMemoryCommand(chatId, command) {
  if (!memoryStore.enabled) {
    await telegram.sendMessage(chatId, '长期记忆现在是关闭的。把 config.local.json 里的 memory.enabled 改成 true 后重启。');
    return;
  }
  if (command.action === 'remember') {
    if (!command.text) {
      await telegram.sendMessage(chatId, '要记住什么？例如：记住：每次叫肉类前先看库存和促销');
      return;
    }
    const result = memoryStore.remember({
      text: command.text,
      category: inferExplicitMemoryCategory(command.text),
      source: 'explicit',
      importance: 5
    });
    if (result.status === 'sensitive') {
      await telegram.sendMessage(chatId, '这段内容像密码、token 或密钥，我不会把它写进长期记忆。');
      return;
    }
    if (!result.entry) {
      await telegram.sendMessage(chatId, '这条内容没有保存。');
      return;
    }
    const verb = result.status === 'updated' ? '已更新' : result.status === 'duplicate' ? '已经记得' : '已记住';
    await telegram.sendMessage(chatId, `🧠 ${verb} #${result.entry.id}：${result.entry.text}`);
    return;
  }
  if (command.action === 'forget') {
    const removed = memoryStore.forgetById(command.id);
    if (!removed) {
      await telegram.sendMessage(chatId, `没有找到 #${command.id}。先发 /memories 看编号。`);
      return;
    }
    await telegram.sendMessage(chatId, `已忘记 #${removed.id}：${removed.text}`);
    return;
  }
  const entries = memoryStore.list({ query: command.query || '', limit: 20 });
  await telegram.sendMessage(chatId, formatMemoryList(entries, memoryStore.count, command.query || ''));
}

async function handlePriceHistory(chatId, requestOrText) {
  const request = typeof requestOrText === 'string' ? parseOperationHistoryRequest(requestOrText) : requestOrText;
  await telegram.sendMessage(chatId, formatOperationHistory(operationLedger.summarize(request || { scope: 'today' })));
}

async function handleScheduledTaskCommand(chatId, command, sourceText = '') {
  const timeZone = config.scheduledTasks?.timeZone || 'Europe/Madrid';
  if (!scheduledTasks.enabled) { await telegram.sendMessage(chatId, '定时任务功能现在是关闭的。'); return; }
  if (command.action === 'invalid') { await telegram.sendMessage(chatId, command.error); return; }
  if (command.action === 'list') {
    await telegram.sendMessage(chatId, formatTaskList(scheduledTasks.list({ status: 'pending', limit: 30 }), timeZone));
    return;
  }
  if (command.action === 'cancel') {
    const cancelled = scheduledTasks.cancel(command.id);
    await telegram.sendMessage(chatId, cancelled
      ? '已取消定时任务：' + formatScheduledTask(cancelled, timeZone)
      : '没有找到这个待执行任务，可能已经执行或取消了。');
    return;
  }
  if (command.action === 'create') {
    await createScheduledTask(chatId, command, sourceText);
  }
}

async function createScheduledTask(chatId, parsed, sourceText = '') {
  try {
    const task = scheduledTasks.add({
      action: parsed.taskAction, argument: parsed.argument, label: parsed.label,
      chatId, runAt: parsed.runAt, sourceText
    });
    await telegram.sendMessage(chatId, '定时任务已创建：\n' + formatScheduledTask(task, scheduledTasks.timeZone) + '\n到时间会由店里电脑自动运行；不会自动 Guardar 或 Enviar Pedido。');
  } catch (error) {
    await telegram.sendMessage(chatId, '没有创建任务：' + error.message);
  }
}

function queueAutoMemory(chatId, text) {
  if (!memoryStore.enabled || config.memory?.autoLearn === false || !llmConfigured(config) || !shouldConsiderForMemory(text)) return;
  const history = assistHistory(text);
  const existingMemory = memoryStore.buildContext(text);
  memoryLearnQueue = memoryLearnQueue
    .catch(() => {})
    .then(async () => {
      const extracted = await llmExtractMemories(text, config, logger, { history, existingMemory });
      const learned = [];
      for (const memory of extracted) {
        const result = memoryStore.remember({ ...memory, source: 'auto' });
        if (['added', 'updated'].includes(result.status) && result.entry) learned.push(result.entry);
      }
      if (learned.length && config.memory?.autoNotify !== false) {
        const lines = learned.map((entry) => `#${entry.id} ${entry.text}`);
        try { await telegram.sendMessage(chatId, `🧠 我把这些放进长期记忆了：\n${lines.join('\n')}\n不对的话发 /forget 编号。`); }
        catch (error) { logger.warn('memory notification failed', { error: error.message }); }
      }
    })
    .catch((error) => logger.warn('automatic memory learning failed', { error: error.message }));
}

function inferExplicitMemoryCategory(text) {
  const source = String(text || '');
  if (/星期|周[一二三四五六日天]|每天|每周|点前|截止|horario|cada (?:lunes|martes|miércoles|miercoles|jueves|viernes|domingo)/iu.test(source)) return 'schedule';
  if (/更正|纠正|不是.{0,40}(?:而是|应该是)|correcci[oó]n|no es.{0,50}sino/iu.test(source)) return 'correction';
  if (/流程|步骤|先.{0,40}再|必须|每次|proceso|pasos|siempre hay que/iu.test(source)) return 'procedure';
  if (/默认|喜欢|偏好|不要|别|prefiero|por defecto|nunca/iu.test(source)) return 'preference';
  return 'fact';
}

// Menú completo de comandos (/help, /comandos). Se mantiene A MANO: cuando
// se añada o cambie un comando, tocar también esta lista.
function formatCommandList() {
  return [
    '📋 我会的所有命令',
    '',
    '【对货 / 打印】',
    '/llegada — 打印今天到货的核对清单',
    '/llegada 152 153 — 按单号打印指定的单（可多张）',
    '/llegada carne 0807 — 按名字找单打印',
    '/llegada 1/7 — 按到货日期打印',
    '',
    '【促销 / 省钱】',
    '/promociones — 去网页抓最新促销（CSV）',
    '/ahorro — 所有促销的省钱策略',
    '/ahorro_pedido — 最新 PDA 单逐行对照促销，AI 挑可替换的促销品',
    '/ahorro_pedido 153 — 指定看哪张单',
    '',
    '【果蔬改价（桌面 UnideGes）】',
    '/precio_fruta platano 2,99 — 改一个价（会先让你确认）',
    '/precios_fruta 加多行「名字 价格」— 批量改',
    '/price_history — 看今天改价账本（也可加 week / all / last 30）',
    '也可以直接问「刚刚批量改了几个」「从 limón 改成 3.5 后总共几个」',
    '/fruta_add — 教我一个新的水果编号',
    '/bloq platano off — 取消/勾选 Bloq.Venta（off=恢复可卖，on=停卖；其他商品用编号）',
    '',
    '【叫货】',
    '/pedido — 今天的叫货提醒（也可 /pedido carne、/pedido fruta、/pedido pda）',
    '/pedidos 3 — 只读检查最新 3 张订单和明显异常',
    '/carne — 开始肉类盘点',
    '/pedido_nuevo — 手动建一张单的草稿',
    '/tarea 2026-07-14 10:00 /carne — 新建定时任务',
    '/tareas — 查看待执行任务；/cancelar_tarea 12 — 取消',
    '',
    '【查商品】',
    '/articulo 模板 — 查/改一个商品（发 /plantilla 看模板怎么写）',
    '直接发编号或 EAN 也可以',
    '',
    '【长期记忆】',
    '记住：内容 — 手动保存一条永久记忆',
    '/memories — 查看记忆；后面可加关键词搜索',
    '/forget 12 — 删除编号 12 的记忆',
    '带“以后、默认、每次、规则、纠正”的话会自动判断是否值得记住',
    '',
    '【其他】',
    '直接用中文说事也行，比如「帮我打一下152的清单」（需要配好 AI key）',
    '每天早上我会自动刷新促销、发现新 PDA 单就自动做省钱分析（config 里 autoAdvisor 可调）',
    '给我发 unide-product-bot-store-pc.zip — 自动更新版本',
    '双击 panel.cmd — 在店里电脑上打开控制面板（大按钮版）',
    '/whoami — 看这个对话的 chat id'
  ].join('\n');
}

// Mensajes en lenguaje natural: el LLM los traduce a un comando del bot y
// se despachan a los MISMOS handlers que el comando escrito a mano. Antes
// de ejecutar se enseña la traducción ("我理解为 /llegada 152") para que la
// usuaria aprenda el comando y pueda corregir si el modelo entendió mal.
// Las acciones que escriben (precio_fruta) conservan su confirmación propia.
// Datos del día para el asistente: promociones vigentes (código, precios,
// caducidad) y últimos pedidos rellenados. Van en texto plano dentro del
// system prompt para que accion=responder conteste con cifras REALES.
function buildAssistDatos(query = '') {
  const localNow = new Intl.DateTimeFormat('sv-SE', { timeZone: config.scheduledTasks?.timeZone || 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short', hour12: false }).format(new Date());
  const partes = ['FECHA Y HORA LOCAL: ' + localNow, 'Fecha de hoy: ' + todayString(config)];
  const memoryContext = memoryStore.buildContext(query);
  if (memoryContext) partes.push(memoryContext);
  const operationContext = operationLedger.buildContext();
  if (operationContext) partes.push(operationContext);
  try {
    const latest = findLatestPromotionsCsv(config);
    if (latest) {
      const items = parsePromotionsCsv(fs.readFileSync(latest.file, 'utf8'));
      const fecha = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? `${d.getDate()}/${d.getMonth() + 1}` : '?');
      const euro = (n) => (Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '?');
      let bloque = items
        .map((i) => `${i.code} ${i.name} | promo ${euro(i.oferta)} (normal ${euro(i.pvd)}) hasta ${fecha(i.hasta)} | ${i.promoName}`)
        .join('\n');
      if (bloque.length > 70000) bloque = `${bloque.slice(0, 70000)}\n(lista truncada)`;
      const diasCsv = Math.max(0, Math.floor((Date.now() - latest.mtime) / 86400000));
      partes.push(`PROMOCIONES VIGENTES (${items.length} artículos; CSV de hace ${diasCsv} días):\n${bloque}`);
    } else {
      partes.push('PROMOCIONES: aún no hay CSV descargado (se descarga con /promociones).');
    }
  } catch (error) { logger.warn('assist datos promos failed', { error: error.message }); }
  try {
    const file = path.resolve(config.logsDir || '.', 'orders-history.json');
    if (fs.existsSync(file)) {
      const historial = JSON.parse(fs.readFileSync(file, 'utf8'));
      const ultimos = historial.slice(-6);
      const lineas = ultimos.map((o) => `${o.orderDate} ${o.orderName} (${(o.items || []).length} líneas)`);
      for (const o of ultimos.slice(-2)) {
        lineas.push(`Detalle de ${o.orderName}:`);
        for (const it of (o.items || []).slice(0, 80)) lineas.push(`  ${it.code} ${it.nombre} x${it.quantity}`);
      }
      if (ultimos.length) partes.push(`ÚLTIMOS PEDIDOS RELLENADOS (historial de 60 días):\n${lineas.join('\n')}`);
    }
  } catch (error) { logger.warn('assist datos pedidos failed', { error: error.message }); }
  partes.push('NO tienes acceso a: stock de la tienda, ventas ni facturas. El historial de cambios de precio sí está en el registro persistente anterior.');
  return partes.join('\n\n');
}

// Últimos turnos del chat (Telegram + panel comparten transcripción) para que
// el asistente entienda referencias. Se excluye el mensaje entrante (va como
// último user), se fusionan turnos seguidos del mismo rol (la API exige
// alternancia) y se recorta cada turno para no inflar el prompt.
function assistHistory(currentText) {
  const turnos = [];
  for (const e of chatLog.slice(-14)) {
    if (!e.text) continue;
    turnos.push({ role: e.from === 'bot' ? 'assistant' : 'user', content: String(e.text).slice(0, 400) });
  }
  const actual = String(currentText || '').slice(0, 400);
  if (turnos.length && turnos[turnos.length - 1].role === 'user' && turnos[turnos.length - 1].content === actual) turnos.pop();
  const fusionados = [];
  for (const t of turnos) {
    const prev = fusionados[fusionados.length - 1];
    if (prev && prev.role === t.role) prev.content += `\n${t.content}`;
    else fusionados.push({ ...t });
  }
  // Debe empezar por user y acabar en assistant (el mensaje actual se añade
  // como user justo después).
  while (fusionados.length && fusionados[fusionados.length - 1].role === 'user') fusionados.pop();
  const corte = fusionados.slice(-10);
  while (corte.length && corte[0].role !== 'user') corte.shift();
  return corte;
}

// Errores para humanos: el texto tecnico completo va al log; al chat va
// una frase sencilla en chino (traducida por la IA). Sin IA configurada,
// o si la IA falla, se manda el texto tecnico de siempre.
function replyHistory() {
  return chatLog
    .slice(-14)
    .filter((entry) => entry.text)
    .map((entry) => ({
      role: entry.from === 'bot' ? 'assistant' : 'user',
      content: String(entry.text).slice(0, 800)
    }));
}

async function composeOutgoingReply(chatId, draft, options = {}) {
  const original = String(draft ?? '');
  if (!original.trim() || config.llm?.allRepliesViaApi === false || !llmConfigured(config)) return original;
  const active = replyContextByChat.get(String(chatId));
  const vigente = active && Date.now() - active.at < 30 * 60 * 1000;
  const userText = vigente ? active.text : '';
  const natural = vigente ? Boolean(active.natural) : false;
  try {
    return await llmComposeReply(original, config, logger, {
      userText,
      natural,
      history: replyHistory(),
      memoryContext: memoryStore.buildContext(userText || original),
      maxChars: options.maxChars
    });
  } catch (error) {
    logger.warn('api reply composition failed; using factual fallback', {
      kind: options.kind || 'message',
      error: error.message
    });
    return original;
  }
}

async function humanizarError(contexto, textoTecnico) {
  logger.warn('operation failed', { contexto, error: String(textoTecnico || '').slice(0, 500) });
  if (!llmConfigured(config)) return textoTecnico;
  try {
    const simple = await llmFriendlyError(contexto, textoTecnico, config, logger);
    return simple || textoTecnico;
  } catch (error) {
    logger.warn('friendly error failed', { error: error.message });
    return textoTecnico;
  }
}

async function handleFreeText(chatId, text) {
  let intent;
  try {
    intent = await llmRouteIntent(text, config, logger, { history: assistHistory(text), datos: buildAssistDatos(text) });
  } catch (error) {
    logger.warn('llm intent failed', { error: error.message });
    await telegram.sendMessage(chatId, formatTemplateHelp());
    return;
  }
  const arg = intent.argumento;
  const say = async (cmd) => telegram.sendMessage(chatId, `我理解为 ${cmd}，这就去办。`);
  switch (intent.accion) {
    case 'llegada':
      await say(`/llegada${arg ? ` ${arg}` : ''}`);
      await handleArrivalChecklist(chatId, `/llegada${arg ? ` ${arg}` : ''}`);
      return;
    case 'ahorro_pedido':
      await say(`/ahorro_pedido${arg ? ` ${arg}` : ''}`);
      await handleAhorroPedido(chatId, `/ahorro_pedido${arg ? ` ${arg}` : ''}`);
      return;
    case 'ahorro':
      await say('/ahorro');
      await handleAhorro(chatId);
      return;
    case 'promociones':
      await say('/promociones');
      await handlePromotions(chatId, '/promociones');
      return;
    case 'precio_fruta':
      if (!arg) { await telegram.sendMessage(chatId, '要改哪个水果、改成多少？比如：platano 2,99'); return; }
      await say(`/precio_fruta ${arg}`);
      await handleFruitPrice(chatId, `/precio_fruta ${arg}`);
      return;
    case 'precios_fruta':
      if (!arg) { await telegram.sendMessage(chatId, '要改哪些？一行一个，比如：\nplatano 2,99\ntomate 1,85'); return; }
      await say('/precios_fruta（批量）');
      await handleFruitPriceBatch(chatId, `/precios_fruta\n${arg}`);
      return;
    case 'price_history': {
      const cmd = `/price_history${arg ? ` ${arg}` : ''}`;
      await say(cmd);
      await handlePriceHistory(chatId, cmd);
      return;
    }
    case 'pedidos_recientes': {
      const request = parseRecentOrdersRequest(`/pedidos ${arg || 3}`);
      const cmd = `/pedidos ${request?.limit || 3}`;
      await say(cmd);
      await handleRecentOrders(chatId, request || { requested: 3, limit: 3, capped: false });
      return;
    }
    case 'pedido': {
      const cmd = `/pedido${arg ? ` ${arg}` : ''}`;
      await say(cmd);
      await telegram.sendMessage(chatId, formatOrderResponse(parseOrderMode(cmd), new Date(), config), makeOrderButtons());
      return;
    }
    case 'carne':
      await say('/carne');
      await startTally(chatId, 'carne');
      return;
    case 'programar': {
      const parsedTask = parseLlmScheduleArgument(arg, new Date());
      if (!parsedTask.ok) { await telegram.sendMessage(chatId, parsedTask.error + '。请告诉我准确日期、时间和要做什么。'); return; }
      await createScheduledTask(chatId, parsedTask, text);
      return;
    }
    case 'tareas': {
      const cancel = String(arg || '').match(/^cancel\s+(\d+)$/i);
      if (cancel) await handleScheduledTaskCommand(chatId, { action: 'cancel', id: Number(cancel[1]) }, text);
      else await handleScheduledTaskCommand(chatId, { action: 'list' }, text);
      return;
    }
    case 'bloq_venta':
      if (!arg) { await telegram.sendMessage(chatId, '要动哪个商品的 Bloq.Venta？发我：/bloq 名字或编号 off（恢复可卖）/ on（停卖）'); return; }
      await say(`/bloq ${arg}`);
      await handleBloqVenta(chatId, `/bloq ${arg}`);
      return;
    case 'articulo': {
      if (!arg) { await telegram.sendMessage(chatId, '要查哪个商品？发我编号或 EAN。'); return; }
      const reparsed = parseProductMessage(`/articulo ${arg}`);
      if (!reparsed.ok || !reparsed.items.length) { await telegram.sendMessage(chatId, `没看懂编号「${arg}」。`); return; }
      await say(`/articulo ${arg}`);
      await sendProductResult(chatId, reparsed.items[0], 0, 1);
      return;
    }
    case 'ayuda':
      await telegram.sendMessage(chatId, formatCommandList());
      return;
    default:
      await telegram.sendMessage(chatId, intent.respuesta || '没太明白你想做什么，可以发 /help 看看我会什么。', { __apiReady: true });
  }
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
  if (data.startsWith('bvone:')) { await handleBloqVentaOne(chatId, callback.id, data.slice(6)); return; }
  if (data.startsWith('fpb:')) { await runFruitPriceBatch(chatId, callback.id, data.slice(4)); return; }
  if (data.startsWith('fpstop:')) { await handleFruitBatchStop(chatId, callback.id, data.slice(7)); return; }
  if (data.startsWith('fp:')) { await handleFruitPick(chatId, callback.id, data.slice(3)); return; }
  if (data.startsWith('tc:')) { await handleTallyTap(chatId, callback.id, data.slice(3)); return; }
  if (data.startsWith('tcgo:')) { await handleTallyGo(chatId, callback.id, data.slice(5)); return; }
  if (data.startsWith('tcclr:')) { await handleTallyClear(chatId, callback.id, data.slice(6)); return; }
  if (data.startsWith('orderApply:')) { await handleOrderApply(chatId, callback.id, data.slice(11)); return; }
  if (data.startsWith('osave:')) { await handleOrderSave(chatId, callback.id, data.slice(6)); return; }
  if (data.startsWith('osend:')) { await handleOrderSend(chatId, callback.id, data.slice(6)); return; }
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
    await telegram.sendMessage(chatId, await humanizarError(`网页搜索「${item.name}」`, `搜「${item.name}」失败（${res.stage || '?'}）：\n${res.error}`));
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
async function processFruitPriceOnce(item, options = {}) {
  const store = lookupStore(storeIndex, item);
  const supplier = enrichSupplierLookup(supplierIndex, item, store);
  // skipSearch: el flujo individual YA buscó el artículo para la captura de
  // confirmación (con su vaciar pantalla incluido); repetir la búsqueda al
  // confirmar era lento y redundante — la lectura verifica igualmente que el
  // código en pantalla es el esperado y aborta si alguien tocó la ventana.
  if (!options.skipSearch) {
    const found = await searchDesktop(item, config, logger, { byCode: true });
    if (found.status !== 'ok') return { ok: false, stage: 'search', error: found.error || found.reason || '未知' };
  }
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
  // Registro correcto: la ficha tiene DOS registros, SDC (central, NO se
  // toca) y TIENDA (el editable). El indicador de la esquina dice cuál está
  // cargado; si el read lo trae y no dice TIENDA, no se escribe.
  if ('bancoDatos' in values) {
    const banco = String(values.bancoDatos ?? '').trim();
    if (!/tienda/i.test(banco)) {
      return { ok: false, stage: 'read', error: `屏幕上载入的是「${banco || '未知'}」记录，不是 TIENDA——没切换成功，为安全不写。`, screenshot: read.screenshot };
    }
  }
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
  if (!planResult.ok) return { ok: false, stage: 'plan', error: planResult.error, read };
  const applied = await applyPriceDesktop(planResult.plan, config, logger);
  if (applied.status !== 'ok') {
    // La escritura pudo quedarse a medias SIN guardar: descartar (vaciar +
    // "No" al aviso) para que el formulario sucio no embosque a la
    // siguiente búsqueda con el diálogo de "¿guardar cambios?".
    await discardDesktop(config, logger);
    return { ok: false, stage: 'apply', error: `${applied.error || applied.reason || '未知'}（已自动放弃未保存的改动并清屏）`, screenshot: applied.screenshot, plan: planResult.plan, read };
  }
  return { ok: true, plan: planResult.plan, read, screenshot: applied.screenshot };
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
  // El artículo ya está en pantalla desde la búsqueda de la tarjeta: se
  // salta la re-búsqueda (la lectura verifica el código igualmente).
  let result;
  try {
    result = await processFruitPriceOnce(one.item, { skipSearch: true });
  } catch (error) {
    result = { ok: false, stage: 'unexpected', error: error.message };
  }
  sessions.delete(id);
  if (!result.ok) {
    recordPriceExecution({ status: 'failed', source: 'fruit_single', groupId: `fruit-single:${id}`, item: one.item, requestedPrice: one.priceRaw, plan: result.plan, read: result.read, stage: result.stage, error: result.error });
    const text = `❌ ${label} 没改（${fruitStageLabel(result.stage)}）：${result.error}\n没有写入。`;
    await sendWithOptionalScreenshot(chatId, { status: result.screenshot ? 'ok' : 'error', screenshot: result.screenshot }, text);
    return;
  }
  recordPriceExecution({ status: 'success', source: 'fruit_single', groupId: `fruit-single:${id}`, item: one.item, requestedPrice: one.priceRaw, plan: result.plan, read: result.read });
  await sendWithOptionalScreenshot(chatId, { status: 'ok', screenshot: result.screenshot },
    `✅ 已改：${label} → ${one.priceRaw} €（P.defecto ${result.plan.pDefecto}%）。看截图确认 P.defecto / Bloq.Venta / 保存状态。`);
  await telegram.sendMessage(chatId, LABEL_STEPS.join('\n'));
}

// /bloq <nombre|codigo> on|off — marcar/desmarcar el checkbox Bloq.Venta de
// UN artículo en el UnideGes de escritorio. off = desmarcar (el artículo se
// puede vender); on = marcar (bloquear la venta). Mismo esqueleto que el
// cambio de precio de fruta: buscar → captura → confirmación → leer con
// guardas (código en pantalla + registro TIENDA) → alternar SOLO si el
// estado difiere → Ctrl+S → releer para verificar. Se acepta: código Unide
// (6-7 cifras, campo Código), EAN de barras (8+ cifras, catalejo — la
// búsqueda EAN de siempre, sin tablas de por medio), nombre de fruta del
// diccionario (se traduce a código) o CUALQUIER nombre (búsqueda por el
// campo del nombre con comodines *nombre*, a un Tab del campo Código).
async function handleBloqVenta(chatId, text) {
  const arg = String(text || '').replace(/^\/\S+\s*/, '').trim();
  const m = arg.match(/^(.*?)[\s]+(on|off|si|no)$/i);
  if (!m) {
    await telegram.sendMessage(chatId, '用法：/bloq 名字、código 或条码EAN off（取消勾选，恢复可卖）或 on（勾选，停卖）。\n比如：/bloq platano off、/bloq 620475 on、/bloq 8410100025346 off 或 /bloq nesquik on（按名字搜）');
    return;
  }
  const nameOrCode = m[1].trim();
  const marcar = /^(on|si)$/i.test(m[2]);
  if (!config.desktop?.enabled) { await telegram.sendMessage(chatId, '桌面自动化没启用（desktop.enabled=false）。'); return; }
  let codigo = '';
  let ean = '';
  let porNombre = '';
  let label = nameOrCode;
  if (/^\d{8,}$/.test(nameOrCode)) {
    // Un numero largo es un EAN de barras, no un código Unide (6-7 cifras):
    // meterlo en el campo Código no encuentra nada. Se busca DIRECTAMENTE
    // por el catalejo de Artículos (la búsqueda EAN calibrada de siempre,
    // modo "search"), sin pasar por ninguna tabla de productos. El código
    // Unide real se lee de la pantalla al confirmar.
    ean = nameOrCode;
  } else if (/^\d{3,}$/.test(nameOrCode)) {
    codigo = nameOrCode;
  } else {
    const resolved = resolveFruitCode(config, storeIndex, supplierIndex, nameOrCode);
    if (resolved?.codigo) { codigo = String(resolved.codigo); label = resolved.articulo || nameOrCode; }
    // Nombre que el diccionario no conoce: búsqueda por NOMBRE en Artículos
    // (el campo a un Tab del Código admite comodines *nombre*). El código
    // real se lee de la pantalla al confirmar, como con el EAN.
    else porNombre = nameOrCode;
  }
  const objetivo = marcar ? '勾选 Bloq.Venta（停卖）' : '取消 Bloq.Venta（恢复可卖）';
  await telegram.sendMessage(chatId, ean
    ? `EAN ${ean}，目标：${objetivo}。正在桌面 Artículos 用望远镜（EAN 搜索）查找…`
    : porNombre
      ? `「${porNombre}」，目标：${objetivo}。正在桌面 Artículos 按名字（*${porNombre}*）搜索…`
      : `「${label}」→ código ${codigo}，目标：${objetivo}。正在桌面 Artículos 里搜索…`);
  const item = ean ? { ean, nombre: label } : (porNombre ? { nombre: porNombre } : { codigo, nombre: label });
  const found = await searchDesktop(item, config, logger, porNombre ? { byName: true } : { byCode: !ean });
  const id = saveSession({ bloqOne: { codigo, ean, nombre: porNombre, label, marcar } });
  const referencia = ean ? `EAN ${ean}` : porNombre ? `按名字「${porNombre}」搜到的，可能有多个匹配时载入的是最后一条` : `「${label}」，código ${codigo}`;
  await sendWithOptionalScreenshot(chatId, found,
    `核对下截图是不是你要的商品（${referencia}）。确认后我会：读状态 → ${marcar ? '勾选' : '取消勾选'} Bloq.Venta → Ctrl+S 保存 → 再读一遍验证。已经是目标状态就什么都不动。`,
    { reply_markup: { inline_keyboard: [[
      { text: marcar ? '确认停卖' : '确认恢复可卖', callback_data: `bvone:${id}` },
      { text: '取消', callback_data: `cancel:${id}` }
    ]] } });
}

async function handleBloqVentaOne(chatId, callbackId, id) {
  const session = sessions.get(id);
  const one = session?.bloqOne;
  if (!one?.codigo && !one?.ean && !one?.nombre) { await telegram.answerCallbackQuery(callbackId, '记录已过期'); await telegram.sendMessage(chatId, '这条记录已过期，请再发一次 /bloq。'); return; }
  if (one.running) { await telegram.answerCallbackQuery(callbackId, '正在处理，别重复点'); return; }
  one.running = true;
  sessions.set(id, session);
  await telegram.answerCallbackQuery(callbackId, '正在处理');

  const finish = async (ok, msg, screenshot) => {
    sessions.delete(id);
    await sendWithOptionalScreenshot(chatId, { status: screenshot ? 'ok' : 'error', screenshot }, `${ok ? '✅' : '❌'} ${msg}`);
  };
  // El artículo ya está en pantalla desde la tarjeta de confirmación.
  const read = await readPriceDesktop(config, logger);
  if (read.status !== 'ok') { await finish(false, `读取失败：${read.error || read.reason || '未知'}`, read.screenshot); return; }
  const values = read.values || {};
  if ('bancoDatos' in values && !/tienda/i.test(String(values.bancoDatos ?? ''))) {
    await finish(false, `屏幕上载入的是「${String(values.bancoDatos ?? '').trim() || '未知'}」记录，不是 TIENDA——为安全不动。`, read.screenshot); return;
  }
  if ('codigoPantalla' in values) {
    const screenCode = String(values.codigoPantalla ?? '').replace(/\D/g, '');
    if (!screenCode) { await finish(false, 'Código 框读到空——商品没载入，为安全不动。', read.screenshot); return; }
    if (one.codigo && screenCode !== String(one.codigo)) { await finish(false, `屏幕上是 código ${screenCode}，不是 ${one.codigo}——为安全不动。`, read.screenshot); return; }
    // Búsqueda por EAN o por nombre: el código Unide no se conocía de
    // antemano; el de pantalla (que el usuario acaba de confirmar en la
    // captura) es el bueno.
    if (!one.codigo) {
      one.codigo = screenCode;
      if (one.label === one.ean) one.label = `EAN ${one.ean}（código ${screenCode}）`;
      else if (one.nombre && one.label === one.nombre) one.label = `${one.nombre}（código ${screenCode}）`;
    }
  }
  if (!one.codigo) {
    // Sin codigoPantalla calibrado no hay forma de saber qué artículo cargó
    // la búsqueda por EAN/nombre: no se toca nada a ciegas.
    await finish(false, '按 EAN/名字搜索时读不到屏幕上的 Código（priceReadSteps 里缺 codigoPantalla），为安全不动。', read.screenshot); return;
  }
  if (!('bloqVentaChecked' in values)) { await finish(false, '读不到 Bloq.Venta 的勾选状态（priceReadSteps 里缺这一步？），为安全不动。', read.screenshot); return; }
  const current = Boolean(values.bloqVentaChecked);
  if (current === one.marcar) {
    await finish(true, `「${one.label}」的 Bloq.Venta 本来就是${one.marcar ? '勾选（停卖）' : '未勾选（可卖）'}状态，什么都不用改。`, read.screenshot); return;
  }
  const applied = await applyBloqDesktop(one.codigo, config, logger);
  if (applied.status !== 'ok') {
    // El toggle puede haberse quedado a medias sin guardar: descartar para
    // no dejar el formulario sucio (origen del diálogo "¿guardar cambios?"
    // que bloqueaba la búsqueda siguiente).
    await discardDesktop(config, logger);
    await finish(false, `写入失败：${applied.error || applied.reason || '未知'}\n已自动放弃未保存的改动并清屏。`, applied.screenshot); return;
  }
  // Verificación: releer y comprobar que el estado quedó como se pidió.
  const recheck = await readPriceDesktop(config, logger);
  const after = recheck.status === 'ok' ? Boolean(recheck.values?.bloqVentaChecked) : null;
  if (after === one.marcar) {
    await finish(true, `「${one.label}」Bloq.Venta 已${one.marcar ? '勾选（停卖）' : '取消（恢复可卖）'}并保存。`, recheck.screenshot || applied.screenshot);
  } else if (after === null) {
    await finish(true, `已执行${one.marcar ? '勾选' : '取消勾选'}+保存，但复查读取失败（${recheck.error || '未知'}）——看截图确认一下。`, applied.screenshot);
  } else {
    // El estado leido despues de guardar sigue siendo el contrario. No
    // inventamos una causa: Proveedor e Inventariable pueden estar completos.
    const discarded = await discardDesktop(config, logger);
    const nota = discarded.status === 'ok'
      ? '已自动放弃这次未保存的改动并清屏，不影响下一次操作。'
      : `自动清屏放弃改动也没成功（${discarded.error || discarded.reason || '未知'}），请手动处理，注意别保存。`;
    const warnings = [...new Set([
      ...(Array.isArray(applied.warnings) ? applied.warnings : []),
      ...(Array.isArray(recheck.warnings) ? recheck.warnings : [])
    ].filter(Boolean))];
    const details = warnings.length ? `\n底层提示：${warnings.join('；')}` : '';
    await finish(false, `Bloq.Venta 点击/保存后复查仍是${after ? '勾选' : '未勾选'}状态，脚本已停止；没有证据表明是 Proveedor 或 Inventariable 缺失。${nota}${details}`, recheck.screenshot || applied.screenshot);
  }
}

// /ahorro — estrategia de ahorro a partir del ÚLTIMO CSV de /promociones:
// cruza el PVD normal contra el PVD de promoción de cada artículo y lo que
// la tienda compra de verdad (tabla tienda, plantilla carne, tabla frutas),
// y saca en chino qué pedir, cuánto se ahorra y qué se acaba ya. No abre
// el navegador: usa el CSV que ya está en disco (correr /promociones antes
// si está viejo).
async function handleAhorro(chatId) {
  const latest = findLatestPromotionsCsv(config);
  if (!latest) {
    await telegram.sendMessage(chatId, '还没有促销数据。先跑一次 /promociones，抓完再发 /ahorro。');
    return;
  }
  const ageHours = (Date.now() - latest.mtime) / 3600000;
  let text;
  try {
    text = fs.readFileSync(latest.file, 'utf8');
  } catch (error) {
    await telegram.sendMessage(chatId, `读取促销 CSV 失败：${error.message}`);
    return;
  }
  const items = parsePromotionsCsv(text);
  if (!items.length) { await telegram.sendMessage(chatId, `促销 CSV 是空的（${path.basename(latest.file)}）。重跑一次 /promociones 吧。`); return; }
  const relevance = buildRelevanceSets({ storeIndex, carneTemplate: loadTemplate(config, 'carne'), config });
  const advice = buildSavingsAdvice(items, relevance, new Date());
  const csvDate = path.basename(latest.file).replace(/^promociones-productos-activos-|\.csv$/g, '');
  let summary = formatAdvice(advice, { csvDate });
  if (ageHours > 48) summary += `\n\n⚠️ 这份数据是 ${Math.round(ageHours / 24)} 天前抓的，建议先 /promociones 刷新再看。`;
  await telegram.sendMessage(chatId, summary);
  try {
    const detailFile = path.join(path.dirname(latest.file), `ahorro-${csvDate}.txt`);
    fs.writeFileSync(detailFile, formatAdviceDetail(advice, { csvDate }));
    await telegram.sendDocument(chatId, detailFile, '完整省钱明细（按力度排序）');
  } catch (error) {
    logger.warn('ahorro detail send failed', { error: error.message });
  }
}

// /ahorro_pedido [nombre] — la variante que de verdad ahorra: abre en la
// web de Pedidos el pedido indicado (o el PDA más reciente si no se da
// nombre — los pedidos grandes), lee TODAS sus líneas y las cruza con las
// promociones vigentes: qué líneas ya van a precio de promoción, cuáles de
// ellas caducan ya (plantearse subir cajas en ESTE pedido) y qué chollos
// relevantes no están en el pedido. Solo lectura.
async function handleAhorroPedido(chatId, text) {
  const arg = String(text || '').replace(/^\/\S+\s*/, '').trim();
  if (!config.webOrder?.enabled) { await telegram.sendMessage(chatId, '网页自动化没启用（webOrder.enabled=false），开着 Edge 调试模式才能读单子。'); return; }
  const latest = findLatestPromotionsCsv(config);
  if (!latest) { await telegram.sendMessage(chatId, '还没有促销数据。先跑一次 /promociones，再来对单子。'); return; }

  await telegram.sendMessage(chatId, `正在打开 Pedidos 读取${arg ? `「${arg}」` : '最新的 PDA'}单子…`);
  const fetched = await fetchOrderLinesByName(config, arg, logger);
  if (!fetched.ok) {
    let msg = `读取单子失败：${fetched.error}`;
    if (fetched.names?.length) msg += `\n列表里最近的单子：\n${fetched.names.map((n) => `· ${n}`).join('\n')}\n可以用 /ahorro_pedido 名字片段 指定。`;
    await telegram.sendMessage(chatId, msg);
    return;
  }
  if (!fetched.items?.length) { await telegram.sendMessage(chatId, `单子「${fetched.orderName}」里没读到商品行。`); return; }

  const promoItems = parsePromotionsCsv(fs.readFileSync(latest.file, 'utf8'));
  const csvDate = path.basename(latest.file).replace(/^promociones-productos-activos-|\.csv$/g, '');
  const orderAdvice = buildOrderAdvice(fetched.items, promoItems, new Date());

  // Sustitutos con IA: las reglas por palabras confunden "pizza" con "patatas
  // sabor pizza"; si hay apiKey se le pide a Claude que empareje solo
  // productos de verdad intercambiables. Si falla, se queda el emparejado
  // por palabras que ya trae buildOrderAdvice.
  let similarViaLlm = false;
  if (llmConfigured(config) && orderAdvice.noPromo.length) {
    await telegram.sendMessage(chatId, '🤖 正在让 AI 对比正常价的行和整张促销清单，挑真正能换着叫的…');
    try {
      const inOrder0 = new Set([...orderAdvice.onPromo, ...orderAdvice.noPromo].map((l) => l.code));
      const candidates = [...orderAdvice.promoByCode.entries()]
        .filter(([code, p]) => Number.isFinite(p.pct) && p.pct >= 10 && !inOrder0.has(code))
        .map(([code, p]) => ({ code, name: p.name, pct: p.pct, promo: p }));
      const pairs = await llmPickSimilarPromos(
        orderAdvice.noPromo.filter((l) => l.code),
        candidates,
        config,
        logger
      );
      const candByCode = new Map(candidates.map((c) => [c.code, c]));
      const lineByCode = new Map(orderAdvice.noPromo.map((l) => [l.code, l]));
      orderAdvice.similar = pairs
        .map((p) => ({ line: lineByCode.get(p.lineCode), promo: candByCode.get(p.promoCode)?.promo, motivo: p.motivo }))
        .filter((s) => s.line && s.promo)
        .sort((a, b) => (b.promo.pct || 0) - (a.promo.pct || 0));
      similarViaLlm = true;
    } catch (error) {
      logger.warn('llm similar failed, using keyword fallback', { error: error.message });
      await telegram.sendMessage(chatId, `AI 匹配没成功（${error.message.slice(0, 120)}），这次先用关键词匹配。`);
    }
  }

  // Chollos relevantes que NO están en el pedido (≥20%, etiquetados).
  const relevance = buildRelevanceSets({ storeIndex, carneTemplate: loadTemplate(config, 'carne'), config });
  const general = buildSavingsAdvice(promoItems, relevance, new Date());
  const inOrder = new Set([...orderAdvice.onPromo, ...orderAdvice.noPromo].map((l) => l.code));
  const extraDeals = general.topSavings.filter((s) => s.relevant && s.pct >= 20 && !inOrder.has(s.code));

  let summary = formatOrderAdvice(fetched, orderAdvice, extraDeals, { csvDate, similarViaLlm });
  const ageHours = (Date.now() - latest.mtime) / 3600000;
  if (ageHours > 48) summary += `\n\n⚠️ 促销数据是 ${Math.round(ageHours / 24)} 天前的，建议先 /promociones 刷新。`;
  await telegram.sendMessage(chatId, summary);
  try {
    const detailFile = path.join(path.dirname(latest.file), `ahorro-pedido-${csvDate}.txt`);
    fs.writeFileSync(detailFile, formatOrderAdviceDetail(fetched, orderAdvice, { csvDate, similarViaLlm }));
    await telegram.sendDocument(chatId, detailFile, '单子逐行对照促销的完整明细');
  } catch (error) {
    logger.warn('ahorro_pedido detail send failed', { error: error.message });
  }
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
          recordPriceExecution({ status: 'failed', source: 'fruit_batch', groupId: `fruit-batch:${id}`, item, requestedPrice: it.priceRaw, plan: result.plan, read: result.read, stage: result.stage, error: result.error });
          failItems.push({ it, error: `${fruitStageLabel(result.stage)}失败：${result.error}` });
          await telegram.sendMessage(chatId, `${progress} ❌ ${label}：${fruitStageLabel(result.stage)}失败`);
          continue;
        }
        recordPriceExecution({ status: 'success', source: 'fruit_batch', groupId: `fruit-batch:${id}`, item, requestedPrice: it.priceRaw, plan: result.plan, read: result.read });
        okItems.push(it);
        await telegram.sendMessage(chatId, `${progress} ✅ ${label} → ${it.priceRaw} €（P.defecto ${result.plan.pDefecto}%）`);
      } catch (error) {
        logger.error('fruit batch item failed', { codigo: it.codigo, error: error.message });
        recordPriceExecution({ status: 'failed', source: 'fruit_batch', groupId: `fruit-batch:${id}`, item: makeFruitItem(it.name, it.codigo, it.articulo, it.priceRaw, false), requestedPrice: it.priceRaw, stage: 'unexpected', error: error.message });
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
    await sendWithOptionalScreenshot(chatId, result, await humanizarError('刷新促销', `Promociones 抓取失败（${result.stage || '?'}）：\n${result.error || '未知错误'}`));
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
      ? (result.message || '订单填入：已执行。请检查 Pedidos 页面；这一步还没有点 Guardar，也没有点 Enviar Pedido。')
      : await humanizarError('填入订单', `订单填入失败（${result.stage || '?'}）：\n${result.error}`);
    // Tras un llenado correcto se ofrece TERMINAR el pedido desde aquí:
    // Guardar y después Enviar, cada uno con su propio botón de
    // confirmación (los únicos caminos del bot que pulsan esos botones).
    let options = {};
    if (result.ok) {
      const sendId = saveSession({ orderSend: { orderName: session.orderDraft.orderName } });
      options = { reply_markup: { inline_keyboard: [[
        { text: '点 Guardar 保存', callback_data: `osave:${sendId}` },
        { text: '先不动', callback_data: `cancel:${sendId}` }
      ]] } };
    }
    // La captura del navegador (si existe) es la mejor confirmación; el
    // volcado de DOM solo se manda cuando una línea falla en edición.
    if (result.screenshot) {
      try { await telegram.sendPhoto(chatId, result.screenshot, text, options); }
      catch { await telegram.sendMessage(chatId, text, options); }
    } else {
      await telegram.sendMessage(chatId, text, options);
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

// Guardar del pedido web recién rellenado, SOLO desde su botón de
// confirmación. Tras guardar bien, ofrece el segundo paso (Enviar Pedido)
// con otro botón — así el pedido de carne se termina entero desde aquí.
async function handleOrderSave(chatId, callbackId, id) {
  const session = sessions.get(id);
  const os = session?.orderSend;
  if (!os?.orderName) { await telegram.answerCallbackQuery(callbackId, '记录已过期'); await telegram.sendMessage(chatId, '这条订单记录已过期。订单还在页面上，可以手动点 Guardar，或重新填单。'); return; }
  if (os.running) { await telegram.answerCallbackQuery(callbackId, '正在处理，别重复点'); return; }
  os.running = true;
  sessions.set(id, session);
  await telegram.answerCallbackQuery(callbackId, '正在点 Guardar');
  const result = await saveOrderWeb(config, logger, os.orderName);
  os.running = false;
  if (!result.ok) {
    sessions.set(id, session);
    const text = await humanizarError('保存订单', `保存失败（${result.stage || '?'}）：\n${result.error}`);
    await sendWithOptionalScreenshot(chatId, { status: result.screenshot ? 'ok' : 'error', screenshot: result.screenshot }, `❌ ${text}`, { reply_markup: { inline_keyboard: [[
      { text: '再试一次 Guardar', callback_data: `osave:${id}` },
      { text: '算了', callback_data: `cancel:${id}` }
    ]] } });
    return;
  }
  os.saved = true;
  sessions.set(id, session);
  await sendWithOptionalScreenshot(chatId, { status: 'ok', screenshot: result.screenshot },
    `✅ ${result.message}`,
    { reply_markup: { inline_keyboard: [[
      { text: '点 Enviar Pedido 发送', callback_data: `osend:${id}` },
      { text: '先不发', callback_data: `cancel:${id}` }
    ]] } });
}

async function handleOrderSend(chatId, callbackId, id) {
  const session = sessions.get(id);
  const os = session?.orderSend;
  if (!os?.orderName) { await telegram.answerCallbackQuery(callbackId, '记录已过期'); await telegram.sendMessage(chatId, '这条订单记录已过期。可以在页面上手动点 Enviar Pedido。'); return; }
  if (!os.saved) { await telegram.answerCallbackQuery(callbackId, '要先 Guardar'); await telegram.sendMessage(chatId, '这个订单还没经我保存过，先点「点 Guardar 保存」。'); return; }
  if (os.running) { await telegram.answerCallbackQuery(callbackId, '正在处理，别重复点'); return; }
  os.running = true;
  sessions.set(id, session);
  await telegram.answerCallbackQuery(callbackId, '正在发送');
  const result = await sendOrderWeb(config, logger, os.orderName);
  if (!result.ok) {
    os.running = false;
    sessions.set(id, session);
    const text = await humanizarError('发送订单', `发送失败（${result.stage || '?'}）：\n${result.error}`);
    await sendWithOptionalScreenshot(chatId, { status: result.screenshot ? 'ok' : 'error', screenshot: result.screenshot }, `❌ ${text}`, { reply_markup: { inline_keyboard: [[
      { text: '再试一次发送', callback_data: `osend:${id}` },
      { text: '算了', callback_data: `cancel:${id}` }
    ]] } });
    return;
  }
  sessions.delete(id);
  await sendWithOptionalScreenshot(chatId, { status: 'ok', screenshot: result.screenshot }, `✅ ${result.message}`);
}

// /pedido_web_test — diagnóstico de la automatización web: conecta al
// Edge, localiza la pestaña de Pedidos, resume lo que ve y envía el HTML
// de la página como documento (para afinar los selectores del grid).
async function handlePedidoWebTest(chatId) {
  await telegram.sendMessage(chatId, '正在连接 Edge 并读取 Pedidos 页面…（如果失败，请先双击 launch-edge-debug.cmd）');
  const result = await inspectOrderPage(config, logger);
  if (!result.ok) {
    await telegram.sendMessage(chatId, await humanizarError('读取 Pedidos 页面', `读取失败（${result.stage}）：\n${result.error}`));
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
    await telegram.sendMessage(chatId, await humanizarError('读取 Pedidos 页面', `读取失败（${result.stage}）：\n${result.error}`));
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

// Tareas futuras creadas desde Telegram o el panel. Solo ejecutan la
// lista blanca de scheduledTasks.js; nunca Guardar ni Enviar Pedido.
async function maybeRunScheduledTasks() {
  if (scheduledTaskRunnerActive || !scheduledTasks.enabled) return;
  const due = scheduledTasks.claimDue(new Date());
  if (!due.length) return;
  scheduledTaskRunnerActive = true;
  try {
    for (const task of due) {
      try {
        notePanelActivity('定时：' + task.label);
        replyContextByChat.set(String(task.chatId), { text: '定时任务：' + task.label, at: Date.now() });
        await telegram.sendMessage(task.chatId, '定时任务到点 #' + task.id + '：' + task.label + '\n现在开始执行 ' + task.command + '。');
        await executeScheduledTask(task);
        scheduledTasks.complete(task.id);
      } catch (error) {
        scheduledTasks.fail(task.id, error.message);
        logger.error('scheduled task failed', { taskId: task.id, action: task.action, error: error.message });
        try { await telegram.sendMessage(task.chatId, '定时任务 #' + task.id + ' 执行失败：' + error.message); } catch { /* sin red */ }
      }
    }
  } finally {
    scheduledTaskRunnerActive = false;
  }
}

async function executeScheduledTask(task) {
  switch (task.action) {
    case 'carne': await startTally(task.chatId, 'carne'); return;
    case 'pedido': {
      const cmd = '/pedido' + (task.argument ? ' ' + task.argument : '');
      await telegram.sendMessage(task.chatId, formatOrderResponse(parseOrderMode(cmd), new Date(), config), makeOrderButtons());
      return;
    }
    case 'promociones': await handlePromotions(task.chatId, '/promociones'); return;
    case 'pedidos_recientes': {
      const request = parseRecentOrdersRequest('/pedidos ' + (task.argument || 3));
      await handleRecentOrders(task.chatId, request || { requested: 3, limit: 3, capped: false });
      return;
    }
    case 'llegada': await handleArrivalChecklist(task.chatId, '/llegada' + (task.argument ? ' ' + task.argument : '')); return;
    case 'ahorro': await handleAhorro(task.chatId); return;
    case 'ahorro_pedido': await handleAhorroPedido(task.chatId, '/ahorro_pedido' + (task.argument ? ' ' + task.argument : '')); return;
    default: throw new Error('不允许的定时任务动作');
  }
}

// Tarea diaria automática (config.autoAdvisor): refrescar promociones y
// analizar pedidos PDA nuevos sin que nadie lo pida. Corre una vez al día a
// la hora configurada (por defecto 07:15, antes de abrir la tienda, para no
// pelearse con nadie por el Edge). Los fallos se avisan y NO se reintenta
// hasta el día siguiente, para no machacar el navegador en bucle.
async function maybeRunAutoAdvisor() {
  const due = autoAdvisor.due(new Date());
  if (!due) return;
  const chatIds = arrivalChatIds();
  if (!chatIds.length || !config.webOrder?.enabled) { autoAdvisor.markSent(due.key); return; }
  autoAdvisor.markSent(due.key); // primero: si algo casca a mitad, no reintentar en bucle
  const chatId = chatIds[0];

  // 1. Promociones frescas para que /ahorro_pedido no trabaje con datos viejos.
  try {
    notePanelActivity('⏰ 每日自动任务');
    await telegram.sendMessage(chatId, '⏰ 每日自动任务：先刷新促销数据…');
    const result = await fetchActivePromotions(config, due.dateStr, logger);
    if (result.ok) await telegram.sendMessage(chatId, `促销数据已刷新 ✅\n${formatPromotionsSummary(result, config).split('\n').slice(0, 3).join('\n')}`);
    else await telegram.sendMessage(chatId, await humanizarError('每日自动刷新促销', `自动刷新促销失败（${result.stage || '?'}）：${result.error || '未知'}。今天先用旧数据。`));
  } catch (error) {
    logger.error('auto promotions failed', { error: error.message });
    try { await telegram.sendMessage(chatId, `自动刷新促销出错：${error.message}`); } catch { /* noop */ }
  }

  // 2. Pedidos PDA nuevos → análisis de ahorro automático.
  try {
    const listed = await listOrders(config, logger);
    if (!listed.ok) { await telegram.sendMessage(chatId, `自动任务读不了 Pedidos 列表：${listed.error}`); return; }
    const lookback = Number.isFinite(Number(config.autoAdvisor?.lookbackDays)) ? Number(config.autoAdvisor.lookbackDays) : 2;
    const cutoff = addDays(due.dateStr, -lookback);
    const fresh = listed.rows.filter((r) => /pda/i.test(r.nombre)
      && String(r.fechaIso || '') >= cutoff
      && !autoAdvisor.isOrderAnalyzed(r.nombre));
    if (!fresh.length) { logger.info('auto advisor: no new pda orders'); return; }
    for (const row of fresh.slice(0, 3)) {
      const nro = (row.nombre.match(/(\d+)\s*$/) || [])[1] || '';
      await telegram.sendMessage(chatId, `发现新 PDA 单「${row.nombre}」，自动对照促销：`);
      await handleAhorroPedido(chatId, `/ahorro_pedido ${nro}`.trim());
      autoAdvisor.markOrderAnalyzed(row.nombre);
    }
  } catch (error) {
    logger.error('auto advisor failed', { error: error.message });
    try { await telegram.sendMessage(chatId, `自动分析新单出错：${error.message}`); } catch { /* noop */ }
  }
}

// /pedidos 3 — inspección de solo lectura de los pedidos más recientes.
// Abre cada detalle y lee TODAS sus páginas; nunca pulsa Guardar ni Enviar.
async function handleRecentOrders(chatId, request) {
  if (config.webOrder?.enabled === false) {
    await telegram.sendMessage(chatId, '网页订单功能没有启用，先在 config.local.json 里打开 webOrder.enabled。');
    return;
  }
  const limit = Number(request?.limit) || 3;
  await telegram.sendMessage(
    chatId,
    `正在只读检查最近 ${limit} 张 Pedidos…\n会逐张翻完全部明细页，不会 Guardar，也不会 Enviar Pedido。`
  );
  const result = await fetchLatestOrders(config, limit, logger);
  if (!result.ok) {
    const friendly = await humanizarError('查看最近订单', result.error || '无法读取 Pedidos');
    await telegram.sendMessage(chatId, `最近订单检查失败：${friendly}`);
    return;
  }
  if (!result.orders?.length) {
    await telegram.sendMessage(chatId, 'Pedidos 列表里没有读到订单。请确认自动化 Edge 已登录，并停在可访问 UnideGes 的状态。');
    return;
  }
  await telegram.sendMessage(chatId, formatRecentOrdersSummary(result.orders, request));
}

// /llegada — saca la lista a demanda (imprime + Telegram).
//   /llegada             → pedidos que llegan HOY (por fecha, como siempre)
//   /llegada 1/7         → pedidos que llegan esa fecha
//   /llegada 152 153     → esos pedidos por NOMBRE/número, lleguen cuando
//   /llegada carne 0807    lleguen (el usuario elige exactamente cuáles)
async function handleArrivalChecklist(chatId, text = '') {
  const today = todayString(config);
  const arg = String(text || '').replace(/^\/llegada(?:_hoy)?\s*/i, '').trim();
  const requested = parseDateArg(arg, today);
  if (arg && !requested) {
    await handleArrivalByNames(chatId, arg);
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

// /llegada con nombres/números: abre en la web exactamente los pedidos que
// pidió el usuario y los imprime, sin filtrar por fecha (el filtro por fecha
// de creación se dejaba pedidos fuera cuando dos entregas del mismo día se
// habían pedido en días distintos).
async function handleArrivalByNames(chatId, arg) {
  if (!config.webOrder?.enabled) {
    await telegram.sendMessage(chatId, '按单名打印需要网页自动化（webOrder.enabled）和开着调试模式的 Edge。');
    return;
  }
  await telegram.sendMessage(chatId, `正在打开 Pedidos 找「${arg}」…`);
  const res = await fetchOrdersBySelectors(config, arg, logger);
  if (!res.ok) {
    await telegram.sendMessage(chatId, `读取失败：${res.error}`);
    return;
  }
  let note = '';
  if (res.notFound?.length) {
    note = `\n⚠️ 没找到「${res.notFound.join('」「')}」对应的单子。`;
    if (res.names?.length) note += `\n列表里最近的单子：\n${res.names.map((n) => `· ${n}`).join('\n')}`;
  }
  if (!res.orders.length) {
    await telegram.sendMessage(chatId, `一张单也没匹配上。${note}`);
    return;
  }
  const delivered = await sendAndPrintChecklist([chatId], { source: 'web', orders: res.orders }, todayString(config));
  if (note && delivered) await telegram.sendMessage(chatId, note.trim());
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
  if (session.applyRunning || session.applyDone) { await telegram.answerCallbackQuery(callbackId, session.applyDone ? '这条已经执行过了' : '正在写入，别重复点'); return; }
  session.applyRunning = true;
  sessions.set(id, session);
  await telegram.answerCallbackQuery(callbackId, '正在写入');
  let result;
  try {
    result = await applyPriceDesktop(session.plan, config, logger);
  } catch (error) {
    result = { status: 'error', error: error.message };
  }
  session.applyRunning = false;
  session.applyDone = result.status === 'ok';
  sessions.set(id, session);
  recordPriceExecution({
    status: result.status === 'ok' ? 'success' : 'failed',
    source: 'article',
    groupId: `article:${id}`,
    item: session.item,
    requestedPrice: session.item?.precio?.value,
    plan: session.plan,
    read: session.priceRead,
    stage: result.status === 'ok' ? '' : 'apply',
    error: result.error || result.reason
  });
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

function recordPriceExecution({ status, source, groupId, item, requestedPrice, plan, read, stage = '', error = '' }) {
  try {
    const store = lookupStore(storeIndex, item || {});
    const values = read?.values || {};
    const desktopPreviousPrice = firstLedgerNumber(
      values.pTpv,
      values.ptpv,
      values.pTPV,
      values.precioActual
    );
    const cachedPreviousPrice = firstLedgerNumber(store?.product?.pvp_tienda);
    const previousPrice = desktopPreviousPrice ?? cachedPreviousPrice;
    const previousPriceSource = desktopPreviousPrice !== null ? 'desktop' : cachedPreviousPrice !== null ? 'store_cache' : '';
    const newPrice = plan?.mode === 'ptpv'
      ? firstLedgerNumber(plan.price, requestedPrice)
      : firstLedgerNumber(requestedPrice);
    return operationLedger.record({
      type: 'price_change',
      status,
      code: item?.codigo,
      ean: item?.ean,
      name: item?.nombre || store?.product?.articulo_tienda,
      previousPrice,
      previousPriceSource,
      newPrice,
      requestedPrice,
      pDefecto: plan?.pDefecto,
      mode: plan?.mode,
      source,
      groupId,
      stage,
      error,
      note: previousPrice === null ? 'Old P.TPV was not available from desktop/cache.' : previousPriceSource === 'store_cache' ? 'Old price came from the local store cache.' : ''
    });
  } catch (ledgerError) {
    logger.warn('price operation ledger failed', { error: ledgerError.message, code: item?.codigo });
    return { status: 'error', error: ledgerError.message };
  }
}

function firstLedgerNumber(...values) {
  for (const value of values) {
    const parsed = parseNumber(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
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
    // El campo P.defecto NO admite 3 decimales: redondear a 2 antes de
    // escribirlo (formatNumber solo recorta ceros, dejaba p. ej. 29,974).
    pDefecto: formatNumber(Math.round(pDefecto * 100) / 100),
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
// Panel de escritorio (127.0.0.1): botones grandes para las acciones de
// cada día. Despacha los mismos comandos que Telegram (mismo handleUpdate,
// mismas confirmaciones); el resultado llega por Telegram.
// Últimas acciones para la tarjeta "最近动态" del panel: comandos que
// llegan (Telegram o panel) y tareas automáticas. Solo en memoria.
const panelActivity = [];
function notePanelActivity(text) {
  panelActivity.unshift({ at: new Date().toISOString(), text: String(text).slice(0, 60) });
  if (panelActivity.length > 8) panelActivity.pop();
}

// Estadística rápida del CSV de promociones para el panel, cacheada por
// mtime (el status se pide cada 15 s; parsear 500 filas cada vez sobra).
let promoStatsCache = { mtime: 0, stats: null };
function promoStatsForPanel() {
  const latest = findLatestPromotionsCsv(config);
  if (!latest) return null;
  if (promoStatsCache.mtime === latest.mtime) return promoStatsCache.stats;
  try {
    const items = parsePromotionsCsv(fs.readFileSync(latest.file, 'utf8'));
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const promos = new Set(items.map((i) => i.promoCode).filter(Boolean));
    let endingSoon = 0;
    for (const it of items) {
      if (!it.hasta) continue;
      const days = Math.round((it.hasta - today) / 86400000);
      if (days === 0 || days === 1) endingSoon += 1;
    }
    const stats = { promos: promos.size, items: items.length, endingSoon };
    promoStatsCache = { mtime: latest.mtime, stats };
    return stats;
  } catch {
    return null;
  }
}

if (config.panel?.enabled !== false) {
  startPanel(config, logger, {
    dispatch: async (cmd) => {
      const ids = arrivalChatIds();
      if (!ids.length) throw new Error('sin chatIds configurados para el panel');
      // Eco al chat de Telegram para que el móvil también vea lo que se
      // pidió desde el panel (sin transcribirlo dos veces).
      try { await telegram.sendMessage(ids[0], `🖥 ${String(cmd)}`, { __noLog: true }); } catch { /* sin red */ }
      await handleUpdate({ __panel: true, message: { chat: { id: ids[0] }, from: { id: ids[0] }, text: String(cmd) } });
    },
    chat: (sinceSeq) => {
      const since = Number(sinceSeq) || 0;
      // Al cliente no se le manda la ruta del fichero de la captura, solo un
      // booleano; la imagen se sirve por /file/<id> (hook file de abajo).
      const messages = chatLog.filter((m) => m.seq > since).slice(-100)
        .map(({ photo, doc, tgMessageId, ...rest }) => ({ ...rest, photo: Boolean(photo), doc: Boolean(doc) }));
      return { seq: chatSeq, messages };
    },
    callback: async (data) => {
      const ids = arrivalChatIds();
      if (!ids.length) throw new Error('sin chatIds configurados para el panel');
      const cbId = `panelcb:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      await handleCallback({ id: cbId, data: String(data), message: { chat: { id: ids[0] } }, from: { id: ids[0] } });
      const toast = panelToasts.get(cbId) || '';
      panelToasts.delete(cbId);
      return toast;
    },
    file: (entryId) => {
      const entry = chatLog.find((e) => e.id === Number(entryId));
      const filePath = entry?.photo || entry?.doc;
      return filePath && fs.existsSync(filePath) ? filePath : null;
    },
    status: async () => {
      const latest = findLatestPromotionsCsv(config);
      let promoCsv = null;
      if (latest) {
        const days = Math.floor((Date.now() - latest.mtime) / 86400000);
        promoCsv = days <= 0 ? '今天的' : `${days} 天前的`;
      }
      let arrivingToday = 0;
      try { arrivingToday = ordersArrivingOn(config, todayString(config)).length; } catch { /* sin historial */ }
      return {
        // boot cambia en cada reinicio: la página lo usa para saber con
        // certeza que la actualización terminó aunque el corte fuera breve.
        boot: START_TIME,
        updateLine: lastUpdateLogLine(),
        uptime: humanUptime(process.uptime()),
        promoCsv,
        promoStats: promoStatsForPanel(),
        arrivingToday,
        autoRanToday: Boolean(autoAdvisor.state.sent[`auto|${todayString(config)}`]),
        webOrder: Boolean(config.webOrder?.enabled),
        desktop: Boolean(config.desktop?.enabled),
        llm: llmConfigured(config),
        memories: memoryStore.count,
        operations: operationLedger.count,
        successfulPriceChanges: operationLedger.successfulPriceChanges,
        scheduledTasks: scheduledTasks.list({ status: 'pending', limit: 12 }).map((task) => ({
          id: task.id, label: task.label, command: task.command, runAt: task.runAt
        })),
        activity: panelActivity
      };
    },
    commandList: () => formatCommandList(),
    cancelTask: (id) => {
      const cancelled = scheduledTasks.cancel(id);
      if (!cancelled) throw new Error('任务不存在，或者已经不是待执行状态');
      notePanelActivity('取消定时：' + cancelled.label);
      return '已取消 #' + cancelled.id + ' ' + cancelled.label;
    },
    // Mantenimiento desde el propio panel: como el bot ya corre elevado,
    // puede lanzar el updater o pararse a si mismo sin UAC ni ventanas.
    admin: async (accion) => {
      if (accion === 'stop') {
        logger.info('panel admin: stop');
        setTimeout(() => process.exit(0), 400);
        return '好，正在关闭。想再开就双击 panel.cmd 或 abrir-panel.vbs';
      }
      if (accion === 'update') {
        if (process.platform !== 'win32') return '更新只在店里的 Windows 电脑上有用';
        const updater = path.join(config.__toolRoot, 'update-bot.ps1');
        if (!fs.existsSync(updater)) return '找不到 update-bot.ps1，先手动跑一次 update-bot.cmd';
        logger.info('panel admin: update', { updater });
        if (!lanzarUpdater(updater)) return '启动更新器失败，看看 logs 里的报错';
        return '正在后台更新。面板会断开一两分钟，更新完 bot 自己回来，刷新即可';
      }
      return '';
    }
  });
}

// Lanza update-bot.ps1 mediante una tarea programada independiente. El
// actualizador tiene que sobrevivir cuando stop-bot.ps1 mate este proceso;
// si se lanza como hijo directo de Node, Windows puede cerrar los dos juntos.
function lanzarUpdater(updater) {
  const estadoFile = path.resolve(config.logsDir || '.', UPDATE_ESTADO);
  const logFile = path.resolve(config.logsDir || '.', UPDATE_LOG);
  let out = 'ignore';
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(estadoFile, 'lanzando el actualizador…');
    fs.appendFileSync(logFile, `\n--- ${new Date().toISOString()} ---\n`);
    out = fs.openSync(logFile, 'a');
    const launcher = path.join(config.__toolRoot, 'launch-update.ps1');
    if (!fs.existsSync(launcher)) throw new Error('falta launch-update.ps1');
    const psExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = spawnSync(fs.existsSync(psExe) ? psExe : 'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher,
        '-Updater', updater, '-WorkingDirectory', config.__toolRoot],
      { cwd: config.__toolRoot, stdio: ['ignore', out, out], windowsHide: true, timeout: 15000 });
    fs.closeSync(out);
    out = 'ignore';
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`launch-update.ps1 salió con código ${result.status}`);
    logger.info('independent updater task started');
    return true;
  } catch (error) {
    if (out !== 'ignore') { try { fs.closeSync(out); } catch { /* ya */ } }
    logger.error('updater launch failed', { error: error.message });
    return null;
  }
}

const UPDATE_LOG = 'update-panel.log';
const UPDATE_ESTADO = 'update-estado.txt';
// Estado del updater para la barra del panel. Primero el archivo de estado
// que escribe el propio update-bot.ps1 (un paso por línea, fiable incluso
// oculto — Write-Host no llega a stdout); si no, la última línea del log
// donde cae stdout/stderr del proceso. Solo si es reciente.
function lastUpdateLogLine() {
  for (const name of [UPDATE_ESTADO, UPDATE_LOG]) {
    try {
      const file = path.resolve(config.logsDir || '.', name);
      const st = fs.statSync(file);
      if (Date.now() - st.mtimeMs > 10 * 60000) continue;
      const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/)
        .filter((l) => l.trim() && !l.startsWith('---'));
      if (lines.length) return lines[lines.length - 1].slice(0, 140);
    } catch { /* probar el siguiente */ }
  }
  return '';
}

function humanUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h${m}m` : `${m}m`;
}

await mainLoop();
