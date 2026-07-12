import fs from 'node:fs';
import path from 'node:path';

const SCHEMA_VERSION = 1;
const VALID_CATEGORIES = new Set(['preference', 'procedure', 'schedule', 'correction', 'fact', 'other']);
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_CONTEXT_LIMIT = 12;

export class MemoryStore {
  constructor(memoryConfig = {}, logger) {
    this.enabled = memoryConfig?.enabled !== false;
    this.filePath = path.resolve(memoryConfig?.path || 'data/bot-memory.json');
    this.backupPath = `${this.filePath}.bak`;
    this.maxEntries = positiveInt(memoryConfig?.maxEntries, DEFAULT_MAX_ENTRIES);
    this.contextLimit = positiveInt(memoryConfig?.contextLimit, DEFAULT_CONTEXT_LIMIT);
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
      this.logger?.warn('memory recovered from backup', { file: this.backupPath, entries: this.state.entries.length });
    }
  }

  get count() {
    return this.state.entries.length;
  }

  remember(input = {}) {
    if (!this.enabled) return { status: 'disabled' };
    const text = cleanText(input.text, 320);
    if (!text) return { status: 'empty' };
    if (containsSensitiveData(text)) return { status: 'sensitive' };

    const now = new Date().toISOString();
    const category = VALID_CATEGORIES.has(input.category) ? input.category : 'other';
    const topic = cleanText(input.topic, 100);
    const normalizedText = normalizeForMatch(text);
    const normalizedTopic = normalizeForMatch(topic);
    const keywords = normalizeKeywords(input.keywords, text);
    const source = input.source === 'explicit' ? 'explicit' : 'auto';
    const importance = clampInt(input.importance, source === 'explicit' ? 5 : 3, 1, 5);

    let existing = this.state.entries.find((entry) => normalizeForMatch(entry.text) === normalizedText);
    if (!existing && normalizedTopic) {
      existing = this.state.entries.find((entry) => entry.topic && normalizeForMatch(entry.topic) === normalizedTopic);
    }

    if (existing) {
      const changed = normalizeForMatch(existing.text) !== normalizedText
        || existing.category !== category
        || normalizeForMatch(existing.topic) !== normalizedTopic;
      existing.text = text;
      existing.category = category;
      existing.topic = topic || existing.topic || '';
      existing.keywords = uniqueStrings([...(existing.keywords || []), ...keywords]).slice(0, 16);
      existing.importance = Math.max(Number(existing.importance) || 1, importance);
      existing.source = existing.source === 'explicit' || source === 'explicit' ? 'explicit' : 'auto';
      existing.updatedAt = now;
      existing.confirmations = (Number(existing.confirmations) || 1) + 1;
      this.save();
      return { status: changed ? 'updated' : 'duplicate', entry: { ...existing } };
    }

    const entry = {
      id: this.state.nextId++,
      text,
      category,
      topic,
      keywords,
      importance,
      source,
      createdAt: now,
      updatedAt: now,
      confirmations: 1
    };
    this.state.entries.push(entry);
    this.trimAutoMemories();
    this.save();
    return { status: 'added', entry: { ...entry } };
  }

  forgetById(id) {
    const wanted = Number(id);
    if (!Number.isInteger(wanted) || wanted <= 0) return null;
    const index = this.state.entries.findIndex((entry) => entry.id === wanted);
    if (index === -1) return null;
    const [removed] = this.state.entries.splice(index, 1);
    this.save();
    return removed;
  }

  list({ query = '', limit = 20 } = {}) {
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
    if (String(query || '').trim()) return this.search(query, safeLimit);
    return [...this.state.entries]
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, safeLimit)
      .map((entry) => ({ ...entry }));
  }

  search(query, limit = this.contextLimit) {
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || this.contextLimit));
    const source = String(query || '').trim();
    return this.state.entries
      .map((entry) => ({ entry, score: relevanceScore(entry, source) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || String(b.entry.updatedAt).localeCompare(String(a.entry.updatedAt)))
      .slice(0, safeLimit)
      .map(({ entry }) => ({ ...entry }));
  }

  buildContext(query, options = {}) {
    if (!this.enabled || !this.count) return '';
    const limit = positiveInt(options.limit, this.contextLimit);
    const maxChars = positiveInt(options.maxChars, 6000);
    const relevant = this.search(query, limit);
    const globalRules = this.state.entries
      .filter((entry) => Number(entry.importance) >= 5 && ['procedure', 'preference', 'schedule', 'correction'].includes(entry.category))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 5);
    const selected = [];
    const seen = new Set();
    for (const entry of [...globalRules, ...relevant]) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      selected.push(entry);
      if (selected.length >= limit) break;
    }
    if (!selected.length) {
      selected.push(...this.list({ limit: Math.min(4, limit) }));
    }

    const lines = [
      'MEMORIA LARGA DEL NEGOCIO (aportada por la usuaria):',
      'La instrucción actual de la usuaria prevalece si contradice una memoria. No inventes recuerdos.'
    ];
    for (const entry of selected) {
      const line = `[M${entry.id}][${entry.category}][${entry.updatedAt.slice(0, 10)}] ${entry.text}`;
      if (lines.join('\n').length + line.length + 1 > maxChars) break;
      lines.push(line);
    }
    return lines.length > 2 ? lines.join('\n') : '';
  }

  save() {
    if (!this.enabled) return;
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
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
      this.logger?.error('memory save failed', { file: this.filePath, error: error.message });
      throw error;
    }
  }

  trimAutoMemories() {
    while (this.state.entries.length > this.maxEntries) {
      const removable = this.state.entries
        .filter((entry) => entry.source !== 'explicit')
        .sort((a, b) => Number(a.importance) - Number(b.importance)
          || String(a.updatedAt).localeCompare(String(b.updatedAt)))[0];
      if (!removable) break;
      this.state.entries = this.state.entries.filter((entry) => entry.id !== removable.id);
    }
  }
}

export function parseMemoryCommand(input) {
  const text = String(input || '').trim();
  if (!text) return null;

  let match = text.match(/^\/(?:remember|recordar|memoria_guardar)(?:@\w+)?(?:\s+([\s\S]+))?$/i)
    || text.match(/^(?:请)?记住\s*[：:]?\s*([\s\S]+)$/);
  if (match) return { action: 'remember', text: String(match[1] || '').trim() };

  match = text.match(/^\/(?:memories|memorias|memory)(?:@\w+)?(?:\s+([\s\S]+))?$/i)
    || text.match(/^(?:查看|看看|列出)(?:长期)?记忆(?:\s+([\s\S]+))?[？?]?$/)
    || text.match(/^你(?:现在|还)?记得什么[？?]?$/);
  if (match) return { action: 'list', query: String(match[1] || '').trim() };

  match = text.match(/^\/(?:forget|olvidar)(?:@\w+)?\s+#?(\d+)$/i)
    || text.match(/^忘记(?:记忆)?\s*#?(\d+)$/);
  if (match) return { action: 'forget', id: Number(match[1]) };

  return null;
}

export function shouldConsiderForMemory(input) {
  const text = String(input || '').trim();
  if (text.length < 6 || text.length > 2000 || text.startsWith('/')) return false;
  if (containsSensitiveData(text)) return false;
  return /记住|以后|从现在|默认|每次|一直|通常|一般来说|规则|流程|习惯|必须|不要|别再|更正|纠正|不是.{0,40}(?:而是|应该是)|(?:星期|周[一二三四五六日天]).{0,30}(?:叫货|到货)|(?:叫货|到货).{0,30}(?:星期|周[一二三四五六日天])|recuerda|a partir de ahora|por defecto|cada vez|siempre|nunca|normalmente|regla|proceso|prefiero|correcci[oó]n|no es.{0,50}sino/iu.test(text);
}

export function containsSensitiveData(input) {
  const text = String(input || '');
  if (/\b\d{8,12}:[A-Za-z0-9_-]{20,}\b/.test(text)) return true;
  if (/(?:api[_ -]?key|token|password|contrase(?:ñ|n)a|密码|密钥|口令|botfather)\s*[:=：]\s*\S{8,}/iu.test(text)) return true;
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text);
}

export function formatMemoryList(entries, total, query = '') {
  const list = Array.isArray(entries) ? entries : [];
  const lines = [query ? `关于「${query}」的长期记忆：` : `长期记忆：${Number(total) || 0} 条`];
  if (!list.length) {
    lines.push(query ? '没有找到相关记忆。' : '目前还没有长期记忆。');
  } else {
    for (const entry of list) {
      const source = entry.source === 'explicit' ? '手动' : '自动';
      lines.push(`#${entry.id} [${categoryLabel(entry.category)}·${source}] ${entry.text}`);
    }
  }
  lines.push('', '添加：记住：内容  ·  删除：/forget 编号  ·  搜索：/memories 关键词');
  return lines.join('\n');
}

function relevanceScore(entry, query) {
  const normalizedQuery = normalizeForMatch(query);
  if (!normalizedQuery) return Number(entry.importance) || 1;
  const normalizedText = normalizeForMatch(`${entry.text} ${entry.topic || ''} ${(entry.keywords || []).join(' ')}`);
  let score = (Number(entry.importance) || 1) * 0.4;
  if (normalizedText.includes(normalizedQuery) || normalizedQuery.includes(normalizeForMatch(entry.topic || entry.text))) score += 20;
  const queryTokens = tokenize(query);
  const memoryTokens = new Set(tokenize(`${entry.text} ${entry.topic || ''} ${(entry.keywords || []).join(' ')}`));
  for (const token of queryTokens) {
    if (memoryTokens.has(token)) score += /\p{Script=Han}/u.test(token) ? 4 : 3;
  }
  return score > (Number(entry.importance) || 1) * 0.4 ? score : 0;
}

function tokenize(input) {
  const text = stripAccents(String(input || '').toLowerCase().normalize('NFKC'));
  const tokens = [];
  for (const word of text.match(/[a-z0-9áéíóúüñ]+/giu) || []) {
    if (word.length >= 2) tokens.push(word);
  }
  for (const segment of text.match(/[\p{Script=Han}]+/gu) || []) {
    if (segment.length <= 4) tokens.push(segment);
    for (let index = 0; index < segment.length - 1; index += 1) tokens.push(segment.slice(index, index + 2));
  }
  return uniqueStrings(tokens);
}

function normalizeState(raw) {
  const entries = Array.isArray(raw?.entries) ? raw.entries : [];
  const normalized = entries
    .map((entry) => normalizeEntry(entry))
    .filter(Boolean);
  const highestId = normalized.reduce((max, entry) => Math.max(max, entry.id), 0);
  return {
    version: SCHEMA_VERSION,
    nextId: Math.max(highestId + 1, positiveInt(raw?.nextId, 1)),
    entries: normalized
  };
}

function normalizeEntry(entry) {
  const id = Number(entry?.id);
  const text = cleanText(entry?.text, 320);
  if (!Number.isInteger(id) || id <= 0 || !text) return null;
  const now = new Date().toISOString();
  return {
    id,
    text,
    category: VALID_CATEGORIES.has(entry.category) ? entry.category : 'other',
    topic: cleanText(entry.topic, 100),
    keywords: normalizeKeywords(entry.keywords, text),
    importance: clampInt(entry.importance, 3, 1, 5),
    source: entry.source === 'explicit' ? 'explicit' : 'auto',
    createdAt: validIso(entry.createdAt) || now,
    updatedAt: validIso(entry.updatedAt) || validIso(entry.createdAt) || now,
    confirmations: positiveInt(entry.confirmations, 1)
  };
}

function readState(filePath, logger) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    logger?.warn('memory file unreadable', { file: filePath, error: error.message });
    return null;
  }
}

function emptyState() {
  return { version: SCHEMA_VERSION, nextId: 1, entries: [] };
}

function normalizeKeywords(input, fallbackText) {
  const values = Array.isArray(input) ? input : String(input || '').split(/[,，;；]/);
  const clean = values.map((value) => cleanText(value, 40)).filter(Boolean);
  if (!clean.length) clean.push(...tokenize(fallbackText).slice(0, 8));
  return uniqueStrings(clean).slice(0, 16);
}

function normalizeForMatch(input) {
  return stripAccents(String(input || '').normalize('NFKC').toLowerCase())
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function stripAccents(input) {
  return String(input || '').normalize('NFD').replace(/\p{M}+/gu, '');
}

function cleanText(input, maxLength) {
  return String(input || '').replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function positiveInt(value, fallback) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampInt(value, fallback, min, max) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function validIso(value) {
  const source = String(value || '');
  return Number.isNaN(Date.parse(source)) ? '' : new Date(source).toISOString();
}

function categoryLabel(category) {
  return ({
    preference: '偏好',
    procedure: '流程',
    schedule: '时间',
    correction: '纠正',
    fact: '事实',
    other: '其他'
  })[category] || '其他';
}
