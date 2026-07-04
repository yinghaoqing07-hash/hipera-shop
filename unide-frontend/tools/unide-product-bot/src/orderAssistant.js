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
    if (item) draft.items.push(item);
  }

  if (!draft.orderName) return { ok: false, error: '缺订单名。请写 nombre: CARNE 0207' };
  if (!draft.items.length) return { ok: false, error: '缺商品行。每行写：商品代码 数量，例如 620002 1' };
  return { ok: true, draft };
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
    '620002 1',
    '620006 2',
    '609950 1',
    '',
    '目前只做提醒和清单，不会自动提交订单。'
  ].join('\n');
}

export function formatOrderDraft(draft) {
  const converted = draft.items.filter((item) => item.originalCode && item.originalCode !== item.code);
  return [
    '准备填入订单：',
    `订单名：${draft.orderName}`,
    `商品行：${draft.items.length} 条`,
    '',
    ...draft.items.map((item, index) => {
      const code = item.originalCode && item.originalCode !== item.code
        ? `${item.originalCode} -> ${item.code}`
        : item.code;
      const note = item.searchSource ? `（${item.searchSource}）` : '';
      return `${index + 1}. ${code}  数量 ${item.quantity}${note}`;
    }),
    converted.length ? '' : null,
    converted.length ? `已自动把 ${converted.length} 个短码换成 EAN，减少网页自动补全多选。` : null,
    '',
    '确认后只会填入当前打开的订单页面并截图；不会 Guardar，也不会 Enviar Pedido。'
  ].filter((line) => line !== null).join('\n');
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
