import fs from 'node:fs';
import path from 'node:path';

const SAFE_ACTIONS = new Set([
  'carne',
  'fruta',
  'pedido',
  'promociones',
  'pedidos_recientes',
  'llegada',
  'ahorro',
  'ahorro_pedido'
]);

export class ScheduledTaskStore {
  constructor(config = {}, logger) {
    this.enabled = config.enabled !== false;
    this.filePath = String(config.path || 'data/scheduled-tasks.json');
    this.maxEntries = positiveInt(config.maxEntries, 500);
    this.maxLateMinutes = positiveInt(config.maxLateMinutes, 360);
    this.timeZone = String(config.timeZone || 'Europe/Madrid');
    this.logger = logger;
    this.state = { nextId: 1, tasks: [] };
    if (this.enabled) this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, ''));
      if (Array.isArray(parsed.tasks)) this.state.tasks = parsed.tasks.map(normalizeTask).filter(Boolean);
      this.state.nextId = Math.max(positiveInt(parsed.nextId, 1), ...this.state.tasks.map((task) => task.id + 1), 1);
    } catch (error) {
      if (error.code !== 'ENOENT') this.logger?.warn('scheduled task store load failed', { error: error.message });
    }
  }

  add(input = {}) {
    if (!this.enabled) throw new Error('定时任务功能已关闭');
    const action = String(input.action || '').trim();
    if (!SAFE_ACTIONS.has(action)) throw new Error('这个动作不允许定时自动执行');
    const runAtDate = input.runAt instanceof Date ? input.runAt : new Date(input.runAt);
    if (Number.isNaN(runAtDate.getTime())) throw new Error('时间格式不正确');
    if (runAtDate.getTime() <= Date.now() + 5000) throw new Error('定时时间必须晚于现在');
    const command = commandForTask(action, input.argument);
    const task = {
      id: this.state.nextId++,
      action,
      argument: String(input.argument || '').trim().slice(0, 120),
      command,
      label: String(input.label || taskLabel(action, input.argument)).trim().slice(0, 120),
      chatId: Number(input.chatId),
      runAt: runAtDate.toISOString(),
      status: 'pending',
      sourceText: String(input.sourceText || '').trim().slice(0, 500),
      createdAt: new Date().toISOString(),
      startedAt: '',
      finishedAt: '',
      error: ''
    };
    if (!Number.isFinite(task.chatId)) throw new Error('缺少 Telegram chat id');
    this.state.tasks.push(task);
    this.trim();
    this.save();
    return { ...task };
  }

  list(options = {}) {
    const status = String(options.status || '').trim();
    const limit = positiveInt(options.limit, 100);
    return this.state.tasks
      .filter((task) => !status || task.status === status)
      .sort((a, b) => new Date(a.runAt) - new Date(b.runAt))
      .slice(0, limit)
      .map((task) => ({ ...task }));
  }

  claimDue(now = new Date()) {
    if (!this.enabled) return [];
    const nowMs = now.getTime();
    const maxLateMs = this.maxLateMinutes * 60000;
    const due = [];
    let changed = false;
    for (const task of this.state.tasks) {
      if (task.status !== 'pending') continue;
      const runAtMs = new Date(task.runAt).getTime();
      if (!Number.isFinite(runAtMs) || runAtMs > nowMs) continue;
      if (nowMs - runAtMs > maxLateMs) {
        task.status = 'failed';
        task.finishedAt = now.toISOString();
        task.error = `电脑错过执行时间超过 ${this.maxLateMinutes} 分钟，已取消自动执行`;
        changed = true;
        continue;
      }
      task.status = 'running';
      task.startedAt = now.toISOString();
      due.push({ ...task });
      changed = true;
    }
    if (changed) this.save();
    return due;
  }

  complete(id) {
    return this.updateStatus(id, 'completed', '');
  }

  fail(id, error) {
    return this.updateStatus(id, 'failed', String(error || '未知错误').slice(0, 500));
  }

  cancel(id) {
    const task = this.state.tasks.find((item) => item.id === Number(id));
    if (!task || task.status !== 'pending') return null;
    task.status = 'cancelled';
    task.finishedAt = new Date().toISOString();
    task.error = '';
    this.save();
    return { ...task };
  }

  updateStatus(id, status, error) {
    const task = this.state.tasks.find((item) => item.id === Number(id));
    if (!task) return null;
    task.status = status;
    task.finishedAt = new Date().toISOString();
    task.error = error;
    this.save();
    return { ...task };
  }

  trim() {
    if (this.state.tasks.length <= this.maxEntries) return;
    const keep = this.state.tasks.filter((task) => ['pending', 'running'].includes(task.status));
    const history = this.state.tasks
      .filter((task) => !['pending', 'running'].includes(task.status))
      .sort((a, b) => new Date(b.finishedAt || b.createdAt) - new Date(a.finishedAt || a.createdAt));
    this.state.tasks = [...keep, ...history.slice(0, Math.max(0, this.maxEntries - keep.length))];
  }

  save() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const temp = `${this.filePath}.tmp`;
    const backup = `${this.filePath}.bak`;
    const body = JSON.stringify(this.state, null, 2);
    try {
      if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, backup);
      fs.writeFileSync(temp, body, 'utf8');
      fs.renameSync(temp, this.filePath);
    } catch (error) {
      try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch { /* noop */ }
      throw error;
    }
  }
}

export function parseScheduleCommand(text, now = new Date()) {
  const source = String(text || '').trim();
  if (/^\/(?:tareas|tasks)(?:@\w+)?\s*$/i.test(source)) return { action: 'list' };
  const cancel = source.match(/^\/(?:cancelar_tarea|cancel_task)(?:@\w+)?\s+(\d+)\s*$/i);
  if (cancel) return { action: 'cancel', id: Number(cancel[1]) };
  const create = source.match(/^\/(?:tarea|task)(?:@\w+)?\s+(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s+(.+)$/is);
  if (!create) return null;
  const runAt = parseLocalDateTime(`${create[1]} ${create[2]}`);
  if (!runAt || runAt <= now) return { action: 'invalid', error: '时间格式不正确，或者时间已经过去了' };
  const safe = safeTaskFromCommand(create[3]);
  if (!safe) return { action: 'invalid', error: '这个命令不能定时执行。可用：/carne、/fruta、/pedido、/promociones、/pedidos、/llegada、/ahorro' };
  return { action: 'create', ...safe, runAt, label: taskLabel(safe.taskAction, safe.argument) };
}

export function parseLlmScheduleArgument(argument, now = new Date()) {
  const parts = String(argument || '').split('|').map((part) => part.trim());
  if (parts.length < 2) return { ok: false, error: '还缺少准确时间或要执行的事情' };
  const runAt = parseLocalDateTime(parts[0]);
  if (!runAt || runAt <= now) return { ok: false, error: '定时时间不正确，或者已经过去了' };
  const safe = safeTaskFromCommand(parts[1]);
  if (!safe) return { ok: false, error: '这个动作不能定时自动执行' };
  return {
    ok: true,
    taskAction: safe.taskAction,
    argument: safe.argument,
    command: safe.command,
    runAt,
    label: (parts[2] || taskLabel(safe.taskAction, safe.argument)).slice(0, 120)
  };
}

export function formatScheduledTask(task, timeZone = 'Europe/Madrid') {
  return `#${task.id} ${formatTaskTime(task.runAt, timeZone)} · ${task.label}（${task.command}）`;
}

export function formatTaskList(tasks, timeZone = 'Europe/Madrid') {
  if (!tasks.length) return '现在没有待执行的定时任务。';
  return ['待执行的定时任务：', ...tasks.map((task) => formatScheduledTask(task, timeZone)), '', '取消：/cancelar_tarea 编号'].join('\n');
}

export function formatTaskTime(value, timeZone = 'Europe/Madrid') {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '?';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

export function safeTaskFromCommand(command) {
  const source = String(command || '').trim();
  if (/^\/(?:carne|pedido_carne)\s*$/i.test(source)) return taskCommand('carne', '');
  if (/^\/(?:fruta|verdura|fruta_verdura|pedido_fruta|pedido_verdura)\s*$/i.test(source)) return taskCommand('fruta', '');
  const pedido = source.match(/^\/pedido(?:\s+(carne|fruta|pda))?\s*$/i);
  if (pedido) return taskCommand('pedido', pedido[1] || '');
  if (/^\/(?:promociones|promo)\s*$/i.test(source)) return taskCommand('promociones', '');
  const recent = source.match(/^\/pedidos(?:\s+(\d+))?\s*$/i);
  if (recent) return taskCommand('pedidos_recientes', String(Math.min(10, Math.max(1, Number(recent[1]) || 3))));
  const llegada = source.match(/^\/llegada(?:\s+(.+))?$/i);
  if (llegada) return taskCommand('llegada', llegada[1] || '');
  if (/^\/ahorro\s*$/i.test(source)) return taskCommand('ahorro', '');
  const pedidoAhorro = source.match(/^\/ahorro_pedido(?:\s+(.+))?$/i);
  if (pedidoAhorro) return taskCommand('ahorro_pedido', pedidoAhorro[1] || '');
  return null;
}

function taskCommand(taskAction, argument) {
  return { taskAction, argument: String(argument || '').trim(), command: commandForTask(taskAction, argument) };
}

function commandForTask(action, argument = '') {
  const arg = String(argument || '').trim();
  switch (action) {
    case 'carne': return '/carne';
    case 'fruta': return '/fruta';
    case 'pedido': return `/pedido${arg ? ` ${arg}` : ''}`;
    case 'promociones': return '/promociones';
    case 'pedidos_recientes': return `/pedidos ${arg || 3}`;
    case 'llegada': return `/llegada${arg ? ` ${arg}` : ''}`;
    case 'ahorro': return '/ahorro';
    case 'ahorro_pedido': return `/ahorro_pedido${arg ? ` ${arg}` : ''}`;
    default: throw new Error('unsafe scheduled action');
  }
}

function taskLabel(action, argument = '') {
  const arg = String(argument || '').trim();
  switch (action) {
    case 'carne': return '开始肉类叫货盘点';
    case 'fruta': return '开始水果蔬菜叫货盘点';
    case 'pedido': return `${arg || '当天'}叫货提醒`;
    case 'promociones': return '刷新未过期促销';
    case 'pedidos_recientes': return `检查最新 ${arg || 3} 张订单`;
    case 'llegada': return `到货核对清单${arg ? `：${arg}` : ''}`;
    case 'ahorro': return '生成总体省钱策略';
    case 'ahorro_pedido': return `订单促销省钱分析${arg ? `：${arg}` : ''}`;
    default: return action;
  }
}

function parseLocalDateTime(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), 0, 0);
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
  return date;
}

function normalizeTask(task) {
  if (!task || !Number.isFinite(Number(task.id)) || !SAFE_ACTIONS.has(String(task.action || ''))) return null;
  return {
    id: Number(task.id),
    action: String(task.action),
    argument: String(task.argument || ''),
    command: String(task.command || commandForTask(task.action, task.argument)),
    label: String(task.label || taskLabel(task.action, task.argument)),
    chatId: Number(task.chatId),
    runAt: String(task.runAt || ''),
    status: ['pending', 'running', 'completed', 'failed', 'cancelled'].includes(task.status) ? task.status : 'pending',
    sourceText: String(task.sourceText || ''),
    createdAt: String(task.createdAt || ''),
    startedAt: String(task.startedAt || ''),
    finishedAt: String(task.finishedAt || ''),
    error: String(task.error || '')
  };
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
