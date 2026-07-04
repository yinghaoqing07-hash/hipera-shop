import fs from 'node:fs';
import path from 'node:path';

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const ORDER_DAYS = new Set([0, 1, 3, 4]);

export function isOrderCommand(text) {
  const value = String(text || '').trim().toLowerCase();
  return /^\/(pedido|pedidos|jiaohuo|order)\b/.test(value)
    || value === '叫货'
    || value.includes('今天要不要叫货')
    || value.includes('自动化叫货');
}

export function isOrderDraftCommand(text) {
  return /^\/(pedido_nuevo|pedido_manual|crear_pedido|order_new)\b/i.test(String(text || '').trim());
}

export function parseOrderDraftMessage(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  const draft = {
    raw,
    orderName: '',
    items: []
  };

  for (const line of lines.slice(1)) {
    const match = line.match(/^([^:：]+)[:：]\s*(.+)$/);
    if (match) {
      const key = normalizeKey(match[1]);
      const value = match[2].trim();
      if (['nombre', 'pedido', 'nombre_pedido', 'order', 'name', '订单名'].includes(key)) {
        draft.orderName = value;
        continue;
      }
    }

    const item = parseOrderLine(line);
    if (item) { draft.items.push(item); continue; }
    // Si no es una línea por código, puede ser una línea por NOMBRE: cuando
    // no sabes el código, escribes el nombre del producto (+ cantidad). Se
    // resolverá luego buscándolo en la web y eligiendo tú entre las opciones.
    const named = parseNameLine(line);
    if (named) draft.items.push(named);
  }

  if (!draft.orderName) return { ok: false, error: '缺订单名。请写 nombre: CARNE 0207' };
  if (!draft.items.length) return { ok: false, error: '缺商品行。每行写：商品代码 数量（如 620002 1），或不知道代码时写商品名（如 ensalada florette 2）。' };
  return { ok: true, draft };
}

// Una línea es "por nombre" si contiene letras (no es solo un código). La
// cantidad va al final (ensalada florette 2 / coca cola 2l x6); sin cantidad
// se asume 1. La resolución (elegir el producto concreto) se hace después.
function parseNameLine(line) {
  const normalized = String(line || '').replace(/\s+/g, ' ').trim();
  if (!/\p{L}/u.test(normalized)) return null; // debe tener letras
  let name = normalized;
  let quantity = '1';
  const qm = normalized.match(/^(.*\S)\s+[xX×]?\s*(\d+(?:[.,]\d+)?)$/);
  if (qm) { name = qm[1].trim(); quantity = qm[2].replace('.', ','); }
  if (!name) return null;
  return { name, quantity, raw: line };
}

// ¿Es una línea por nombre todavía sin resolver (falta que elijas el
// producto)? Se usa para lanzar el flujo de selección y para el preview.
export function isPendingNameItem(item) {
  return Boolean(item?.name) && !item?.resolved;
}

// Aplica la opción elegida (del desplegable de la web) a la línea por nombre:
// queda resuelta y pasa a rellenarse por el EAN (identificador único) si lo
// hay, o por el Código Unide; el Código Unide queda como ancla de respaldo.
export function resolveNameItem(item, chosen) {
  const ean = String(chosen?.ean || '').replace(/[^\d]/g, '');
  const code = String(chosen?.code || '').replace(/[^\d]/g, '');
  const search = ean || code;
  const out = { ...item, resolved: true, nombre: cleanName(chosen?.name || chosen?.text) };
  if (search) { out.code = search; out.anchorCode = code || search; }
  return out;
}

export function parseOrderMode(text) {
  const value = String(text || '').trim().toLowerCase();
  if (/help|ayuda|帮助|怎么用/.test(value)) return 'help';
  if (/pda|regatte|自动导入/.test(value)) return 'pda';
  if (/carne|肉/.test(value)) return 'meat';
  if (/fruta|verdura|果蔬|水果|蔬菜|frutas/.test(value)) return 'produce';
  if (/jueves|补货|周四|缺口/.test(value)) return 'topup';
  return 'today';
}

export function makeOrderButtons() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '今天', callback_data: 'order:today' },
          { text: '肉类', callback_data: 'order:meat' },
          { text: '果蔬', callback_data: 'order:produce' }
        ],
        [
          { text: 'PDA', callback_data: 'order:pda' },
          { text: '周四补货', callback_data: 'order:topup' }
        ]
      ]
    }
  };
}

export function makeOrderDraftButtons(id) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '确认填入', callback_data: `orderApply:${id}` },
          { text: '取消', callback_data: `cancel:${id}` }
        ]
      ]
    }
  };
}

export function formatOrderResponse(mode, now = new Date(), config = {}) {
  const parts = getZonedParts(now, config.ordering?.timezone || 'Europe/Madrid');
  if (mode === 'help') return formatOrderHelp();
  if (mode === 'meat') return formatMeat(parts);
  if (mode === 'produce') return formatProduce(parts);
  if (mode === 'pda') return formatPda(parts);
  if (mode === 'topup') return formatTopup(parts);
  return formatToday(parts);
}

export function formatOrderReminder(now = new Date(), config = {}) {
  const parts = getZonedParts(now, config.ordering?.timezone || 'Europe/Madrid');
  const intro = `叫货提醒：今天${DAY_NAMES[parts.day]}。`;
  if (parts.day === 0) return `${intro}\n${formatPda(parts)}`;
  if (parts.day === 1) return `${intro}\n${formatMonday(parts)}`;
  if (parts.day === 3) return `${intro}\n${formatWednesday(parts)}`;
  if (parts.day === 4) return `${intro}\n${formatTopup(parts)}`;
  return `${intro}\n今天没有固定叫货节点，只在库存/促销/缺货异常时补。`;
}

export class OrderReminderScheduler {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.sent = loadSentState(config.logsDir, logger);
  }

  due(now = new Date()) {
    const ordering = this.config.ordering || {};
    if (!ordering.enabled) return null;
    const chatIds = reminderChatIds(this.config);
    if (!chatIds.length) return null;

    const parts = getZonedParts(now, ordering.timezone || 'Europe/Madrid');
    if (!ORDER_DAYS.has(parts.day)) return null;

    const reminderMinutes = parseTimeToMinutes(ordering.reminderTime || '10:00');
    const windowMinutes = Number.isFinite(Number(ordering.reminderWindowMinutes))
      ? Number(ordering.reminderWindowMinutes)
      : 180;
    const nowMinutes = parts.hour * 60 + parts.minute;
    if (nowMinutes < reminderMinutes || nowMinutes > reminderMinutes + windowMinutes) return null;

    const key = `${parts.date}|${ordering.reminderTime || '10:00'}|${parts.day}`;
    if (this.sent[key]) return null;

    return {
      key,
      chatIds,
      text: formatOrderReminder(now, this.config)
    };
  }

  markSent(key) {
    this.sent[key] = new Date().toISOString();
    saveSentState(this.config.logsDir, this.sent, this.logger);
  }
}

function formatToday(parts) {
  if (parts.day === 0) return formatPda(parts);
  if (parts.day === 1) return formatMonday(parts);
  if (parts.day === 3) return formatWednesday(parts);
  if (parts.day === 4) return formatTopup(parts);
  return [
    `今天是${DAY_NAMES[parts.day]}，没有固定肉类/果蔬叫货节点。`,
    '',
    '只在这些情况补：',
    '- 库存撑不到下一次到货',
    '- 促销商品或周末高消耗商品快断',
    '- 昨天/今天明显缺货',
    '',
    '想看固定流程可以点下面的“肉类”或“果蔬”。'
  ].join('\n');
}

function formatMonday(parts) {
  return [
    `今天是${DAY_NAMES[parts.day]}：第一轮肉类 + 果蔬检查，通常准备周三到货。`,
    '',
    `肉类：参考上一张周一 CARNE，历史常见 20-30 kg / 128-178 EUR。订单名可用：CARNE ${parts.ddmm}`,
    `果蔬：按库存决定，历史可参考 56-65 kg / 154-171 EUR。订单名可用：FRUTA Y VERDURA ${parts.ddmm}`,
    '',
    commonChecks()
  ].join('\n');
}

function formatWednesday(parts) {
  return [
    `今天是${DAY_NAMES[parts.day]}：第二轮肉类 + 果蔬检查，通常准备周五到货，并覆盖周末前需求。`,
    '',
    `肉类：参考上一张周三 CARNE，历史常见 37-48 kg / 178-264 EUR。订单名可用：CARNE ${parts.ddmm}`,
    `果蔬：重点看周末前会不会断，历史可参考 56-65 kg / 154-171 EUR。订单名可用：FRUTA Y VERDURA ${parts.ddmm}`,
    '',
    commonChecks()
  ].join('\n');
}

function formatMeat(parts) {
  const range = parts.day === 3 ? '37-48 kg / 178-264 EUR' : '20-30 kg / 128-178 EUR';
  return [
    `肉类叫货：订单名建议 CARNE ${parts.ddmm}`,
    '',
    `参考量：${range}。周一偏小，周三偏大。`,
    '',
    '最稳流程：',
    '1. 进 Gestión Tiendas > Pedidos。',
    '2. 找上一张同星期的 CARNE/PEDIDO CARNE。',
    '3. Copiar pedido，改订单名和必要数量。',
    '4. 先 Guardar，再 Enviar Pedido。',
    '',
    '注意：只复制 Alta/历史正常订单做参考，不要直接照抄；先看肉柜库存和周末消耗。'
  ].join('\n');
}

function formatProduce(parts) {
  return [
    `果蔬叫货：订单名建议 FRUTA Y VERDURA ${parts.ddmm}`,
    '',
    '参考量：历史常见 56-65 kg / 154-171 EUR，但果蔬比肉类更看现场库存和损耗。',
    '',
    '优先检查：',
    '- 基础菜和水果是否够撑到下一次到货',
    '- 周末高消耗商品',
    '- 已经损耗/临期的不要机械补满',
    '- 促销或天气导致需求变化',
    '',
    '系统流程和肉类一样：Pedidos 里复制上一张果蔬订单，改数量，Guardar 后再 Enviar Pedido。'
  ].join('\n');
}

function formatPda(parts) {
  return [
    `今天是${DAY_NAMES[parts.day]}：PDA / 自动导入订单检查。重点是 11:00 前确认。`,
    '',
    '检查：',
    '- Pedidos 列表有没有最新 Pedido importado desde PDA Nro.',
    '- 通常可能有两张，一大一小，别漏一张。',
    '- Estado、Peso Total、Importe Total 有没有明显异常。',
    '- 如果没生成，先查 PDA/导入流程，不要急着手工补整单。',
    '',
    '入口：Gestión Tiendas > Pedidos。'
  ].join('\n');
}

function formatTopup(parts) {
  return [
    `今天是${DAY_NAMES[parts.day]}：可选补货，不是固定必须下单。`,
    '',
    '目标：补周末到周一的缺口。',
    '',
    '只看这几件事：',
    '- 肉类主力品够不够撑到下次到货',
    '- 果蔬有没有明显断货风险',
    '- 周末促销/高消耗商品够不够',
    '- 节假日或特殊客流有没有变化',
    '',
    '库存够就不订；有缺口就只补最容易断的。'
  ].join('\n');
}

function commonChecks() {
  return [
    '发送前检查：',
    '- 先看库存、上一张同星期订单、促销和缺货。',
    '- 黄色锁定商品不要订。',
    '- 行还在编辑状态时先完成/取消编辑。',
    '- Guardar 只是保存，最后还要 Enviar Pedido 并确认。'
  ].join('\n');
}

function formatOrderHelp() {
  return [
    '叫货助手命令：',
    '',
    '/pedido        看今天该做什么',
    '/pedido carne  肉类叫货流程',
    '/pedido fruta  果蔬叫货流程',
    '/pedido pda    周日 PDA 检查',
    '',
    '让程序填订单：',
    '/pedido_nuevo',
    'nombre: CARNE 0207',
    '620002 1        ← 知道代码就写代码 数量',
    '620006 2',
    'ensalada florette 2   ← 不知道代码就写商品名 数量，程序会在网页搜、把选项发给你点',
    '',
    '目前只做提醒和填入草稿，不会点 Guardar，也不会 Enviar Pedido。'
  ].join('\n');
}

// Longitud máxima de un "código corto". Los Código Unide reales de la
// tienda son de 6+ dígitos y los EAN de 13; un código de <=5 dígitos es un
// código de artículo interno (p. ej. 3700/3701/3702) que en la web de
// Pedidos dispara búsqueda DIFUSA y saca decenas de opciones parecidas.
const SHORT_CODE_MAX_LEN = 5;

// Enriquece cada línea del pedido con datos de la tabla local de la tienda:
//   - nombre     → nombre del producto (para mostrar en la confirmación y
//                  como término de búsqueda de respaldo en la web).
//   - anchorCode → el Código Unide conocido, para elegir en la web la fila
//                  EXACTA cuando el autocompletado saca varias opciones.
//   - code/originalCode/converted → si es un código corto con EAN, se busca
//                  en la web por EAN (exacto) en vez de por el código corto
//                  (que dispara búsqueda difusa con decenas de opciones).
// No toca códigos largos (ya buscan bien), ni los que no estén en la tabla o
// no tengan EAN. Con la tabla vacía es un no-op. Devuelve el draft
// enriquecido y la lista de conversiones (para el mensaje de confirmación).
export function enrichOrderItems(draft, storeIndex, supplierIndex = null, options = {}) {
  const maxLen = Number(options.maxLen) || SHORT_CODE_MAX_LEN;
  const conversions = [];
  const items = (draft.items || []).map((item) => {
    const typed = String(item.code || '').trim();
    const out = { ...item };
    if (!/^\d+$/.test(typed)) return out;
    // Primero la tabla de la tienda; si el código no está ahí (p. ej. un
    // producto que la tienda no tiene dado de alta), se recurre al catálogo
    // completo del proveedor. Así más líneas obtienen nombre y EAN.
    const storeRow = storeIndex?.byCode?.get(typed) || null;
    const supRow = supplierIndex?.byCode?.get(typed) || null;
    if (!storeRow && !supRow) return out;
    // El código tecleado ES el Código Unide (se buscó en byCode): sirve de
    // ancla para desambiguar en la web aunque luego busquemos por EAN/nombre.
    out.anchorCode = typed;
    const nombre = cleanName(firstNonEmpty(
      storeRow?.articulo_tienda, storeRow?.articulo,
      supRow?.articulo_tienda, supRow?.articulo
    ));
    if (nombre) out.nombre = nombre;
    const ean = normalizeEan(storeRow?.ean) || normalizeEan(supRow?.ean);
    if (ean && ean.length >= 8 && ean !== typed && typed.length <= maxLen) {
      out.code = ean;
      out.originalCode = typed;
      out.converted = true;
      conversions.push({ original: typed, ean, articulo: nombre });
    }
    return out;
  });
  return { draft: { ...draft, items }, conversions };
}

function firstNonEmpty(...values) {
  for (const v of values) {
    const s = String(v || '').trim();
    if (s) return s;
  }
  return '';
}

// Los nombres de la tabla local vienen truncados con un punto/espacio final
// (p. ej. "ENSALADA FLORETTE ."). Ese sufijo ensucia la confirmación y, sobre
// todo, hace fallar la búsqueda por nombre en la web (devuelve "sin datos").
function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').replace(/[\s.·,;:|]+$/, '').trim();
}

function normalizeEan(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

export function formatOrderDraft(draft) {
  return [
    '准备填入订单：',
    `订单名：${draft.orderName}`,
    `商品行：${draft.items.length} 条`,
    '',
    ...draft.items.map((item, index) => {
      if (isPendingNameItem(item)) {
        return `${index + 1}. 🔍 待选：${item.name}  数量 ${item.quantity}`;
      }
      const typed = item.originalCode || item.code;
      let line = `${index + 1}. ${typed}  数量 ${item.quantity}`;
      if (item.converted) line += `  →  网页搜 EAN ${item.code}`;
      if (item.nombre) line += `（${item.nombre}）`;
      return line;
    }),
    '',
    '确认后只会填入当前打开的订单页面并截图；不会 Guardar，也不会 Enviar Pedido。'
  ].join('\n');
}

function reminderChatIds(config) {
  const configured = config.ordering?.reminderChatIds || [];
  const ids = configured.length ? configured : (config.telegram?.allowedChatIds || []);
  return ids.map(String).filter(Boolean);
}

function getZonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const day = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday] ?? date.getDay();
  return {
    day,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    ddmm: `${parts.day}${parts.month}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function parseTimeToMinutes(value) {
  const match = String(value || '10:00').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 10 * 60;
  return Number(match[1]) * 60 + Number(match[2]);
}

function parseOrderLine(line) {
  const normalized = line.replace(/[，,;]/g, ' ').replace(/\s+/g, ' ').trim();
  const match = normalized.match(/^(\d{4,14})\s+([xX×\-]|\d+(?:[,.]\d+)?)\b/);
  if (!match) return null;
  const quantity = match[2].toLowerCase() === 'x' || match[2] === '×' || match[2] === '-'
    ? '0'
    : match[2].replace('.', ',');
  return {
    code: match[1],
    quantity,
    raw: line
  };
}

function normalizeKey(value) {
  return value.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
}

function loadSentState(logsDir, logger) {
  const file = statePath(logsDir);
  try {
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    logger?.warn?.('could not load ordering reminder state', { error: error.message });
    return {};
  }
}

function saveSentState(logsDir, sent, logger) {
  const file = statePath(logsDir);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(sent, null, 2));
  } catch (error) {
    logger?.warn?.('could not save ordering reminder state', { error: error.message });
  }
}

function statePath(logsDir) {
  return path.join(logsDir || '.', 'ordering-reminders.json');
}
