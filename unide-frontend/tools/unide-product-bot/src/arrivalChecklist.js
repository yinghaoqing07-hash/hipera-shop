import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Lista de comprobación de LLEGADA: cuando el bot rellena un pedido, lo
// registra en logs/orders-history.json; el día estimado de llegada (fecha
// del pedido + offsetDays, por defecto 2: lunes→miércoles, miércoles→
// viernes) genera una lista con casillas para comprobar los bultos y la
// IMPRIME en la impresora del PC de la tienda, además de mandarla por
// Telegram. Solo lee el historial local; no toca la web de UnideGes.

const HISTORY_FILE = 'orders-history.json';
const HISTORY_KEEP_DAYS = 60;

// --- registro ---------------------------------------------------------

// Guarda un pedido rellenado (draft confirmado) en el historial local.
// Se llama tras un applyOrderWeb con ok=true; la fecha se toma en la zona
// configurada para que el cálculo del día de llegada sea el de Madrid.
export function recordFilledOrder(config, draft, logger, now = new Date()) {
  try {
    const file = historyPath(config);
    const history = loadHistory(file);
    const timezone = config.ordering?.timezone || 'Europe/Madrid';
    history.push({
      recordedAt: now.toISOString(),
      orderDate: zonedDateString(now, timezone),
      orderName: String(draft.orderName || '').trim(),
      items: (draft.items || []).map((item) => ({
        code: String(item.originalCode || item.code || '').trim(),
        nombre: String(item.nombre || item.name || '').trim(),
        quantity: String(item.quantity ?? '').trim()
      }))
    });
    pruneHistory(history, now);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(history, null, 2));
    logger?.info('order recorded for arrival checklist', { name: draft.orderName, lines: draft.items?.length });
    return true;
  } catch (error) {
    logger?.warn('could not record order for arrival checklist', { error: error.message });
    return false;
  }
}

// 'YYYY-MM-DD' de hoy en la zona horaria de la tienda (para /llegada).
export function todayString(config, now = new Date()) {
  return zonedDateString(now, config.ordering?.timezone || 'Europe/Madrid');
}

// Pedidos cuya llegada estimada (orderDate + offsetDays) cae en dateStr.
export function ordersArrivingOn(config, dateStr) {
  const offset = Number(config.arrival?.offsetDays);
  const offsetDays = Number.isFinite(offset) ? offset : 2;
  return loadHistory(historyPath(config)).filter((order) => {
    if (!order?.orderDate) return false;
    return addDays(order.orderDate, offsetDays) === dateStr;
  });
}

// --- formato ----------------------------------------------------------

// Texto imprimible, TODO en español: las impresoras de tique/las fuentes
// por defecto de Out-Printer no siempre tienen glifos chinos. El mensaje
// de Telegram que lo acompaña sí va en chino (se arma en bot.js).
export function formatChecklist(orders, dateStr) {
  const lines = [];
  lines.push('LISTA DE COMPROBACION DE LLEGADA');
  lines.push(`Fecha llegada: ${prettyDate(dateStr)}`);
  lines.push('='.repeat(46));
  for (const order of orders) {
    lines.push('');
    lines.push(`PEDIDO: ${order.orderName}   (pedido el ${prettyDate(order.orderDate)})`);
    lines.push('-'.repeat(46));
    for (const item of order.items || []) {
      const qty = item.quantity || '?';
      const name = item.nombre || '';
      const code = item.code || '';
      lines.push(`[ ] ${padRight(qty, 4)} x ${padRight(code, 14)} ${name}`);
    }
    lines.push('');
    lines.push('    Bultos recibidos: ____   Incidencias: ______________');
  }
  lines.push('');
  lines.push('='.repeat(46));
  lines.push('Marcar cada linea al contar. Si falta o sobra algo,');
  lines.push('apuntarlo y registrar la incidencia en UnideGes.');
  return lines.join('\n');
}

// --- impresión --------------------------------------------------------

// Imprime texto en la impresora del PC (Windows): se escribe a un archivo
// temporal UTF-8 con BOM y se manda con Out-Printer (impresora
// predeterminada, o la de config.arrival.printerName). En otros sistemas
// se omite con aviso (el texto siempre llega también por Telegram).
export function printText(config, text, logger) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      logger?.info('printing skipped (not windows)');
      resolve({ ok: false, skipped: true, reason: 'no es Windows' });
      return;
    }
    try {
      const dir = path.resolve(config.logsDir || '.', 'print');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `llegada-${Date.now()}.txt`);
      fs.writeFileSync(file, '\uFEFF' + text, 'utf8'); // BOM explícito: PowerShell lee bien UTF-8
      const printerName = String(config.arrival?.printerName || '').trim();
      const nameArg = printerName ? ` -Name '${printerName.replace(/'/g, "''")}'` : '';
      const command = `Get-Content -LiteralPath '${file.replace(/'/g, "''")}' -Encoding UTF8 | Out-Printer${nameArg}`;
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => resolve({ ok: false, error: error.message }));
      child.on('close', (code) => {
        if (code === 0) resolve({ ok: true });
        else resolve({ ok: false, error: stderr.trim() || `powershell salió con código ${code}` });
      });
    } catch (error) {
      resolve({ ok: false, error: error.message });
    }
  });
}

// --- programación (mismo patrón que OrderReminderScheduler) ------------

export class ArrivalChecklistScheduler {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.sent = loadSentState(config.logsDir, logger);
  }

  // Devuelve { key, dateStr, orders } si toca imprimir ahora; null si no.
  due(now = new Date()) {
    const arrival = this.config.arrival || {};
    if (!arrival.enabled) return null;
    const timezone = this.config.ordering?.timezone || 'Europe/Madrid';
    const parts = zonedParts(now, timezone);
    const printMinutes = parseTimeToMinutes(arrival.printTime || '08:30');
    const windowMinutes = Number.isFinite(Number(arrival.windowMinutes)) ? Number(arrival.windowMinutes) : 180;
    const nowMinutes = parts.hour * 60 + parts.minute;
    if (nowMinutes < printMinutes || nowMinutes > printMinutes + windowMinutes) return null;

    const key = `llegada|${parts.date}`;
    if (this.sent[key]) return null;
    const orders = ordersArrivingOn(this.config, parts.date);
    if (!orders.length) {
      // Nada que comprobar hoy: se marca para no re-evaluar cada poll.
      this.markSent(key);
      return null;
    }
    return { key, dateStr: parts.date, orders };
  }

  markSent(key) {
    this.sent[key] = new Date().toISOString();
    saveSentState(this.config.logsDir, this.sent, this.logger);
  }
}

// --- helpers ----------------------------------------------------------

function historyPath(config) {
  return path.resolve(config.logsDir || '.', HISTORY_FILE);
}

function loadHistory(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pruneHistory(history, now) {
  const cutoff = new Date(now.getTime() - HISTORY_KEEP_DAYS * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if ((history[i]?.orderDate || '') < cutoffStr) history.splice(i, 1);
  }
}

// 'YYYY-MM-DD' en la zona horaria pedida.
function zonedDateString(date, timeZone) {
  return zonedParts(date, timeZone).date;
}

function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute)
  };
}

// Suma días a 'YYYY-MM-DD' sin líos de zona (mediodía UTC evita saltos DST).
function addDays(dateStr, days) {
  const base = new Date(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(base.getTime())) return '';
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function prettyDate(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(dateStr || '');
}

function padRight(value, width) {
  const s = String(value || '');
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function parseTimeToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 8 * 60 + 30;
  return Number(match[1]) * 60 + Number(match[2]);
}

function statePath(logsDir) {
  return path.resolve(logsDir || '.', 'arrival-checklist-state.json');
}

function loadSentState(logsDir, logger) {
  try {
    const file = statePath(logsDir);
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    logger?.warn?.('could not load arrival checklist state', { error: error.message });
    return {};
  }
}

function saveSentState(logsDir, sent, logger) {
  try {
    const file = statePath(logsDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(sent, null, 2));
  } catch (error) {
    logger?.warn?.('could not save arrival checklist state', { error: error.message });
  }
}
