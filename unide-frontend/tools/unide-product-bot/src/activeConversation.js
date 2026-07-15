import fs from 'node:fs';
import path from 'node:path';

const YES_WORDS = new Set([
  '要', '是', '对', '好', '好的', '可以', '行', '确认', '确认填入',
  '填入', '开始', '执行', '继续', '重试', '再试', '再试一次',
  '重新试', '重新试一次'
]);

const NO_WORDS = new Set([
  '不', '不要', '否', '取消', '算了', '先不', '先不要', '不用',
  '不用了', '停止', '停', '先停'
]);

export function classifyShortDecision(text) {
  const normalized = String(text || '')
    .trim()
    .replace(/[!！。,.，?？;；:：\s]+/g, '');
  if (!normalized || normalized.length > 12 || normalized.startsWith('/')) return '';
  if (YES_WORDS.has(normalized)) return 'confirm';
  if (NO_WORDS.has(normalized)) return 'cancel';
  return '';
}

export class ActiveConversationStore {
  constructor(filePath, { ttlMs = 24 * 60 * 60 * 1000, runningTimeoutMs = 15 * 60 * 1000 } = {}) {
    this.filePath = filePath;
    this.ttlMs = ttlMs;
    this.runningTimeoutMs = runningTimeoutMs;
    this.state = { version: 1, chats: {} };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (parsed && typeof parsed === 'object' && parsed.chats) this.state = parsed;
      }
    } catch {
      this.state = { version: 1, chats: {} };
    }
    this.recoverInterruptedRuns();
    this.cleanup();
  }

  recoverInterruptedRuns() {
    const now = Date.now();
    let changed = false;
    for (const [key, value] of Object.entries(this.state.chats)) {
      if (value?.status !== 'running') continue;
      this.state.chats[key] = {
        ...value,
        status: 'awaiting_retry',
        failure: value.failure || '上一次执行被 bot 重启或意外中断，可以直接回复“重试”。',
        updatedAt: now
      };
      changed = true;
    }
    if (changed) this.save();
  }

  get(chatId) {
    this.cleanup();
    return this.state.chats[String(chatId)] || null;
  }

  set(chatId, value) {
    const now = Date.now();
    this.state.chats[String(chatId)] = {
      ...value,
      createdAt: Number(value?.createdAt) || now,
      updatedAt: now
    };
    this.save();
    return this.get(chatId);
  }

  update(chatId, patch) {
    const current = this.get(chatId);
    if (!current) return null;
    return this.set(chatId, { ...current, ...patch, createdAt: current.createdAt });
  }

  clear(chatId) {
    const key = String(chatId);
    if (!this.state.chats[key]) return false;
    delete this.state.chats[key];
    this.save();
    return true;
  }

  clearMatchingSession(chatId, sessionId) {
    const active = this.get(chatId);
    if (!active || String(active.sessionId) !== String(sessionId)) return false;
    return this.clear(chatId);
  }

  formatContext(chatId) {
    const active = this.get(chatId);
    if (!active || active.kind !== 'order_apply') return '';
    const itemCount = Array.isArray(active.orderDraft?.items)
      ? active.orderDraft.items.length
      : 0;
    return [
      '[ACTIVE_EXECUTABLE_TASK]',
      'kind=order_apply',
      'status=' + (active.status || 'awaiting_confirmation'),
      'sessionId=' + (active.sessionId || ''),
      'orderName=' + (active.orderDraft?.orderName || ''),
      'itemCount=' + itemCount,
      active.failure ? 'lastFailure=' + String(active.failure).slice(0, 300) : '',
      'Short confirmations must be handled by the deterministic dispatcher, not simulated in text.'
    ].filter(Boolean).join('\n');
  }

  cleanup() {
    const now = Date.now();
    const cutoff = now - this.ttlMs;
    const interruptedCutoff = now - this.runningTimeoutMs;
    let changed = false;
    for (const [key, value] of Object.entries(this.state.chats)) {
      const updatedAt = Number(value?.updatedAt) || 0;
      if (updatedAt < cutoff) {
        delete this.state.chats[key];
        changed = true;
      } else if (value?.status === 'running' && updatedAt < interruptedCutoff) {
        this.state.chats[key] = {
          ...value,
          status: 'awaiting_retry',
          failure: value.failure || '上一次执行被 bot 重启或意外中断，可以直接回复“重试”。',
          updatedAt: now
        };
        changed = true;
      }
    }
    if (changed) this.save();
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = this.filePath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tempPath, this.filePath);
  }
}
