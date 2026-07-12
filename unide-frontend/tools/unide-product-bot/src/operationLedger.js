import fs from 'node:fs';
import path from 'node:path';

const SCHEMA_VERSION = 1;
const DEFAULT_MAX_ENTRIES = 10000;
const DEFAULT_RECENT_MINUTES = 30;

export class OperationLedger {
  constructor(ledgerConfig = {}, logger) {
    this.enabled = ledgerConfig?.enabled !== false;
    this.filePath = path.resolve(ledgerConfig?.path || 'data/operation-ledger.json');
    this.backupPath = `${this.filePath}.bak`;
    this.maxEntries = positiveInt(ledgerConfig?.maxEntries, DEFAULT_MAX_ENTRIES);
    this.timeZone = String(ledgerConfig?.timeZone || 'Europe/Madrid');
    this.logger = logger;
    this.state = emptyState();
    this.recoveredFromBackup = false;
    if (this.enabled) this.load();
  }

  load() {
    const primary = readState(this.filePath, this.logger);
    if (primary) {
      this.state = normalizeState(primary);
      return;
    }
    const backup = readState(this.backupPath, this.logger);
    if (backup) {
      this.state = normalizeState(backup);
      this.recoveredFromBackup = true;
      this.logger?.warn('operation ledger recovered from backup', {
        file: this.backupPath,
        entries: this.state.entries.length
      });
    }
  }

  get count() {
    return this.state.entries.length;
  }

  get successfulPriceChanges() {
    return this.state.entries.filter((entry) => entry.type === 'price_change' && entry.status === 'success').length;
  }

  record(input = {}) {
    if (!this.enabled) return { status: 'disabled' };
    const normalized = normalizeRecordInput(input);
    if (!normalized) return { status: 'invalid' };
    if (normalized.dedupeKey) {
      const existing = this.state.entries.find((entry) => entry.dedupeKey === normalized.dedupeKey);
      if (existing) return { status: 'duplicate', entry: { ...existing } };
    }
    const entry = { id: this.state.nextId++, ...normalized };
    this.state.entries.push(entry);
    this.trim();
    this.save();
    return { status: 'added', entry: { ...entry } };
  }

  importLegacyChat(messages = []) {
    if (!this.enabled) return { imported: 0, candidates: 0 };
    if (this.state.legacyImportComplete) return { imported: 0, candidates: 0, alreadyComplete: true };
    const candidates = extractLegacyPriceEvents(messages);
    let imported = 0;
    for (const candidate of candidates) {
      if (candidate.dedupeKey && this.state.entries.some((entry) => entry.dedupeKey === candidate.dedupeKey)) continue;
      const normalized = normalizeRecordInput(candidate);
      if (!normalized) continue;
      this.state.entries.push({ id: this.state.nextId++, ...normalized });
      imported += 1;
    }
    this.state.legacyImportComplete = true;
    this.trim();
    this.save();
    if (imported) {
      this.logger?.info('legacy price history imported', { imported, candidates: candidates.length });
    }
    return { imported, candidates: candidates.length };
  }

  summarize(request = {}, now = new Date()) {
    const scope = normalizeScope(request.scope);
    const all = this.state.entries
      .filter((entry) => entry.type === 'price_change')
      .sort(compareChronological);
    let entries = all;
    let anchorEntry = null;
    let anchorMissing = false;

    if (scope === 'today') {
      const today = localDayKey(now, this.timeZone);
      entries = all.filter((entry) => localDayKey(entry.occurredAt, this.timeZone) === today);
    } else if (scope === 'week') {
      const todayOrdinal = dayOrdinal(localDayKey(now, this.timeZone));
      const weekday = new Date(todayOrdinal * 86400000).getUTCDay();
      const mondayOrdinal = todayOrdinal - (weekday === 0 ? 6 : weekday - 1);
      entries = all.filter((entry) => dayOrdinal(localDayKey(entry.occurredAt, this.timeZone)) >= mondayOrdinal);
    } else if (scope === 'recent') {
      const newest = all.at(-1);
      const minutes = positiveInt(request.minutes, DEFAULT_RECENT_MINUTES);
      const cutoff = newest ? new Date(newest.occurredAt).getTime() - minutes * 60000 : 0;
      entries = all.filter((entry) => new Date(entry.occurredAt).getTime() >= cutoff);
    } else if (scope === 'latest_group') {
      const newest = all.at(-1);
      entries = newest ? all.filter((entry) => entry.groupId === newest.groupId) : [];
    } else if (scope === 'since') {
      const matches = all.filter((entry) => entry.status === 'success' && matchesAnchor(entry, request.anchor, request.targetPrice));
      if (!matches.length) {
        entries = [];
        anchorMissing = true;
      } else {
        anchorEntry = request.occurrence === 'first' ? matches[0] : matches.at(-1);
        entries = all.filter((entry) => compareChronological(entry, anchorEntry) >= 0);
      }
    } else if (scope === 'last') {
      const limit = Math.max(1, Math.min(100, Number(request.limit) || 10));
      entries = all.slice(-limit);
    }

    const successful = entries.filter((entry) => entry.status === 'success');
    const failed = entries.filter((entry) => entry.status === 'failed');
    const uniqueProducts = new Set(successful.map(productIdentity).filter(Boolean));
    return {
      scope,
      request: { ...request },
      entries: [...entries].sort((a, b) => compareChronological(b, a)),
      successCount: successful.length,
      failureCount: failed.length,
      uniqueProductCount: uniqueProducts.size,
      anchorEntry,
      anchorMissing,
      totalRecorded: all.length,
      importedCount: entries.filter((entry) => entry.source === 'legacy_chat').length,
      timeZone: this.timeZone
    };
  }

  buildContext(limit = 12, now = new Date()) {
    if (!this.enabled || !this.count) return '';
    const today = this.summarize({ scope: 'today' }, now);
    const latest = this.summarize({ scope: 'last', limit }, now);
    const lines = [
      'HISTORIAL REAL DE CAMBIOS DE PRECIO (registro persistente):',
      `Hoy: ${today.successCount} operaciones correctas, ${today.uniqueProductCount} productos distintos, ${today.failureCount} fallos.`,
      'Últimas operaciones:'
    ];
    for (const entry of latest.entries) {
      lines.push(formatContextEntry(entry, this.timeZone));
    }
    lines.push('Para totales exactos usa la acción price_history; no calcules totales contando mensajes del chat.');
    return lines.join('\n');
  }

  save() {
    if (!this.enabled) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp-${process.pid}`;
    const payload = `${JSON.stringify(this.state, null, 2)}\n`;
    try {
      if (!this.recoveredFromBackup && fs.existsSync(this.filePath)) {
        fs.copyFileSync(this.filePath, this.backupPath);
      }
      fs.writeFileSync(temp, payload, 'utf8');
      try {
        fs.renameSync(temp, this.filePath);
      } catch {
        fs.copyFileSync(temp, this.filePath);
        fs.unlinkSync(temp);
      }
      this.recoveredFromBackup = false;
    } catch (error) {
      try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch { /* noop */ }
      this.logger?.error('operation ledger save failed', { file: this.filePath, error: error.message });
      throw error;
    }
  }

  trim() {
    if (this.state.entries.length <= this.maxEntries) return;
    this.state.entries = this.state.entries
      .sort(compareChronological)
      .slice(-this.maxEntries);
  }
}

export function parseOperationHistoryRequest(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const command = text.match(/^\/(?:price_history|historial_precios|cambios_precio)(?:@\w+)?(?:\s+([\s\S]+))?$/i);
  if (command) return parseHistoryArgument(command[1] || 'today');
  if (/^(?:查看|看看|显示)?(?:改价|价格)(?:操作)?(?:记录|历史|账本)(?:[：:]?\s*([\s\S]+))?[？?]?$/u.test(text)) {
    const match = text.match(/(?:记录|历史|账本)(?:[：:]?\s*([\s\S]+))?[？?]?$/u);
    return parseHistoryArgument(match?.[1] || 'today');
  }

  const asksAboutPriceChanges = /改价|改了|改成|价格.{0,10}(?:记录|历史|几个|多少)|precio.{0,20}(?:cambi|historial)|cu[aá]ntos?.{0,20}precios?|cambios?.{0,20}precio/iu.test(text);
  const asksForHistory = /几个|多少|总共|一共|记录|历史|账本|哪些|什么|统计|cu[aá]nt|historial|total/iu.test(text);
  if (!asksAboutPriceChanges || !asksForHistory) return null;
  return parseHistoryArgument(text);
}

export function formatOperationHistory(summary, options = {}) {
  const maxItems = Math.max(1, Math.min(30, Number(options.maxItems) || 12));
  const lines = [`改价账本（${scopeLabel(summary.scope, summary.request)}）：`];
  if (summary.anchorMissing) {
    lines.push(`没有找到作为起点的「${summary.request.anchor || '指定商品'}」成功改价记录。`);
  } else {
    lines.push(`成功 ${summary.successCount} 次，涉及 ${summary.uniqueProductCount} 个商品；失败 ${summary.failureCount} 次。`);
    if (summary.anchorEntry) {
      lines.push(`起点：#${summary.anchorEntry.id} ${summary.anchorEntry.name || summary.anchorEntry.code || '未知商品'} ${formatMoney(summary.anchorEntry.newPrice) || ''}`.trim());
    }
  }

  const visible = summary.entries.slice(0, maxItems);
  if (visible.length) {
    lines.push('');
    for (const entry of visible) lines.push(formatReportEntry(entry, summary.timeZone));
    if (summary.entries.length > visible.length) lines.push(`…还有 ${summary.entries.length - visible.length} 条，发 /price_history last 30 可多看一些。`);
  } else if (!summary.anchorMissing) {
    lines.push('目前这个范围还没有记录。');
  }
  if (summary.importedCount) lines.push('', `其中 ${summary.importedCount} 条由最近聊天记录补回。`);
  lines.push('', '账本从 v135 开始完整记录；更早内容只能从最近 300 条聊天中补回格式明确的记录，可能不完整。');
  return lines.join('\n');
}

export function extractLegacyPriceEvents(messages = []) {
  const source = Array.isArray(messages) ? [...messages].sort((a, b) => Number(a?.seq || 0) - Number(b?.seq || 0)) : [];
  const events = [];
  let activeBatch = null;
  for (const message of source) {
    if (message?.from !== 'bot') continue;
    const text = String(message.text || '');
    const regex = /(?:^|\n)\s*(?:(\d+)\/(\d+)\s+)?✅\s*(?:已改[：:]\s*)?(.+?)\s*→\s*([0-9]+(?:[.,][0-9]+)?)\s*€/gu;
    let match;
    let matchIndex = 0;
    while ((match = regex.exec(text))) {
      matchIndex += 1;
      const itemIndex = Number(match[1] || 0);
      const itemTotal = Number(match[2] || 0);
      let groupId;
      if (itemIndex && itemTotal) {
        if (!activeBatch || itemIndex === 1 || activeBatch.total !== itemTotal) {
          activeBatch = { id: `legacy-batch:${message.id || message.seq || events.length + 1}`, total: itemTotal };
        }
        groupId = activeBatch.id;
        if (itemIndex >= itemTotal) activeBatch = null;
      } else {
        groupId = `legacy-single:${message.id || message.seq || events.length + 1}`;
      }
      events.push({
        type: 'price_change',
        status: 'success',
        name: cleanText(match[3], 180),
        newPrice: parseMoney(match[4]),
        source: 'legacy_chat',
        groupId,
        occurredAt: validIso(message.at) || new Date().toISOString(),
        dedupeKey: `legacy-chat:${message.id || message.seq || 'unknown'}:${matchIndex}`,
        note: 'Imported from a clear success message in panel-chat.json'
      });
    }
  }
  return events;
}

function parseHistoryArgument(input) {
  const source = String(input || '').trim();
  const normalized = stripAccents(source.toLowerCase());
  const since = source.match(/从\s*(第一个|第一次|最近一次|最后一次)?\s*(.+?)(?:\s*改成\s*([0-9]+(?:[.,][0-9]+)?))?\s*(?:后|以后|到现在)/u)
    || source.match(/^since\s+(first\s+|last\s+)?(.+?)(?:\s+(?:price[=:]?\s*)?([0-9]+(?:[.,][0-9]+)?))?$/iu)
    || source.match(/^desde\s+(primero\s+|[uú]ltimo\s+)?(.+?)(?:\s+(?:precio[=:]?\s*)?([0-9]+(?:[.,][0-9]+)?))?$/iu);
  if (since) {
    return {
      scope: 'since',
      occurrence: /第一个|第一次|first|primero/iu.test(since[1] || '') ? 'first' : 'last',
      anchor: cleanAnchor(since[2]),
      targetPrice: parseMoney(since[3])
    };
  }
  const last = normalized.match(/(?:last|ultim(?:os?)?|最近)\s*(\d{1,3})/u);
  if (last) return { scope: 'last', limit: Math.max(1, Math.min(100, Number(last[1]))) };
  if (/刚刚.{0,8}批量|最近一批|latest[ _-]?batch|ultima tanda|última tanda/iu.test(source)) return { scope: 'latest_group' };
  if (/刚刚|刚才|recent|reciente|hace poco/iu.test(source)) return { scope: 'recent', minutes: DEFAULT_RECENT_MINUTES };
  if (/今天|今日|today|hoy/iu.test(source)) return { scope: 'today' };
  if (/这周|本周|week|semana/iu.test(source)) return { scope: 'week' };
  if (/全部|所有|总共|一共|all|todo|total/iu.test(source)) return { scope: 'all' };
  return { scope: 'today' };
}

function normalizeRecordInput(input) {
  const type = input.type === 'price_change' ? 'price_change' : '';
  const status = input.status === 'success' ? 'success' : input.status === 'failed' ? 'failed' : '';
  if (!type || !status) return null;
  return {
    type,
    status,
    code: digits(input.code),
    ean: digits(input.ean),
    name: cleanText(input.name, 180),
    previousPrice: parseMoney(input.previousPrice),
    previousPriceSource: ['desktop', 'store_cache'].includes(input.previousPriceSource) ? input.previousPriceSource : '',
    newPrice: parseMoney(input.newPrice),
    requestedPrice: parseMoney(input.requestedPrice),
    pDefecto: parseMoney(input.pDefecto),
    mode: cleanText(input.mode, 40),
    source: cleanText(input.source, 40) || 'unknown',
    groupId: cleanText(input.groupId, 120) || `single:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    stage: cleanText(input.stage, 60),
    error: cleanText(input.error, 500),
    note: cleanText(input.note, 500),
    dedupeKey: cleanText(input.dedupeKey, 180),
    occurredAt: validIso(input.occurredAt) || new Date().toISOString()
  };
}

function normalizeState(raw) {
  const entries = (Array.isArray(raw?.entries) ? raw.entries : [])
    .map((entry) => {
      const normalized = normalizeRecordInput(entry);
      const id = Number(entry?.id);
      return normalized && Number.isInteger(id) && id > 0 ? { id, ...normalized } : null;
    })
    .filter(Boolean);
  const highestId = entries.reduce((max, entry) => Math.max(max, entry.id), 0);
  return {
    version: SCHEMA_VERSION,
    nextId: Math.max(highestId + 1, positiveInt(raw?.nextId, 1)),
    legacyImportComplete: raw?.legacyImportComplete === true,
    entries
  };
}

function readState(filePath, logger) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    logger?.warn('operation ledger unreadable', { file: filePath, error: error.message });
    return null;
  }
}

function emptyState() {
  return { version: SCHEMA_VERSION, nextId: 1, legacyImportComplete: false, entries: [] };
}

function compareChronological(a, b) {
  const time = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
  return time || Number(a.id || 0) - Number(b.id || 0);
}

function matchesAnchor(entry, anchor, targetPrice) {
  const needle = normalizeText(anchor);
  if (!needle) return false;
  const haystack = normalizeText(`${entry.code} ${entry.ean} ${entry.name}`);
  if (!haystack) return false;
  if (!haystack.includes(needle) && !needle.includes(haystack)) return false;
  const wantedPrice = parseMoney(targetPrice);
  return wantedPrice === null || (entry.newPrice !== null && Math.abs(entry.newPrice - wantedPrice) < 0.005);
}

function productIdentity(entry) {
  return entry.code || entry.ean || normalizeText(entry.name);
}

function localDayKey(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function localTime(value, timeZone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('zh-CN', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function dayOrdinal(dayKey) {
  const [year, month, day] = String(dayKey).split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function formatContextEntry(entry, timeZone) {
  const product = [entry.code, entry.name].filter(Boolean).join(' ') || 'producto desconocido';
  const price = entry.newPrice === null ? (entry.pDefecto === null ? '' : `P.defecto ${entry.pDefecto}%`) : `${entry.newPrice.toFixed(2)} EUR`;
  return `#${entry.id} ${entry.status} ${localDayKey(entry.occurredAt, timeZone)} ${localTime(entry.occurredAt, timeZone)} ${product} ${price}`.trim();
}

function formatReportEntry(entry, timeZone) {
  const mark = entry.status === 'success' ? '✅' : '❌';
  const product = [entry.code, entry.name].filter(Boolean).join(' ') || '未知商品';
  const before = formatMoney(entry.previousPrice);
  const after = formatMoney(entry.newPrice);
  let change = '';
  const beforeLabel = before && entry.previousPriceSource === 'store_cache' ? `缓存旧价 ${before}` : before;
  if (beforeLabel && after) change = `${beforeLabel} → ${after}`;
  else if (after) change = `→ ${after}`;
  else if (entry.pDefecto !== null) change = `P.defecto ${formatNumber(entry.pDefecto)}%`;
  const failure = entry.status === 'failed' ? `（${entry.stage || '执行'}：${entry.error || '未知错误'}）` : '';
  return `${mark} #${entry.id} ${localDayKey(entry.occurredAt, timeZone)} ${localTime(entry.occurredAt, timeZone)} ${product} ${change}${failure}`.trim();
}

function scopeLabel(scope, request = {}) {
  if (scope === 'today') return '今天';
  if (scope === 'week') return '本周';
  if (scope === 'all') return '全部';
  if (scope === 'recent') return `最近 ${request.minutes || DEFAULT_RECENT_MINUTES} 分钟`;
  if (scope === 'latest_group') return '最近一批';
  if (scope === 'last') return `最近 ${request.limit || 10} 条`;
  if (scope === 'since') return `从「${request.anchor || '指定商品'}」起`;
  return scope;
}

function cleanAnchor(value) {
  return cleanText(value, 100)
    .replace(/^(?:第一个|第一次|最近一次|最后一次|first|last|primero|[uú]ltimo)\s*/iu, '')
    .replace(/\s*(?:到现在|hasta ahora).*$/iu, '')
    .trim();
}

function normalizeScope(value) {
  return ['today', 'week', 'all', 'recent', 'latest_group', 'last', 'since'].includes(value) ? value : 'today';
}

function parseMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number.parseFloat(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(number) ? Math.round(number * 10000) / 10000 : null;
}

function formatMoney(value) {
  const number = parseMoney(value);
  return number === null ? '' : `${number.toFixed(2).replace('.', ',')} €`;
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.round(number * 100) / 100).replace('.', ',') : '';
}

function normalizeText(value) {
  return stripAccents(String(value || '').normalize('NFKC').toLowerCase())
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function stripAccents(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}+/gu, '');
}

function cleanText(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function validIso(value) {
  const source = String(value || '');
  return Number.isNaN(Date.parse(source)) ? '' : new Date(source).toISOString();
}

function positiveInt(value, fallback) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
