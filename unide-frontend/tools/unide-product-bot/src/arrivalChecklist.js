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

// Fecha opcional de "/llegada 1/7" → 'YYYY-MM-DD'. Acepta d/m, d/m/yyyy y
// yyyy-mm-dd; sin año se asume el de hoy (zona de la tienda). '' si no
// se reconoce.
export function parseDateArg(value, todayStr) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return '';
  const year = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : String(todayStr || '').slice(0, 4);
  if (!/^\d{4}$/.test(year)) return '';
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
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
  lines.push('='.repeat(75));
  for (const order of orders) {
    lines.push('');
    const estado = order.estado ? `, ${order.estado}` : '';
    lines.push(`PEDIDO: ${order.orderName}   (pedido el ${prettyDate(order.orderDate)}${estado})`);
    // Con precios (pedidos leídos de la web, que traen C.Central/PVD/Oferta/
    // Total del grid) se imprime en tabla; los del historial local viejo no
    // tienen esas columnas y salen en el formato simple de siempre.
    const items = order.items || [];
    const hasExtras = items.some((it) => it.central || it.pvd || it.total);
    if (hasExtras) {
      lines.push('-'.repeat(75));
      lines.push(`    ${padRight('C.CENTRAL', 10)}${padRight('ARTICULO', 29)}${padLeft('CAJAS', 5)}${padLeft('PVD', 9)}${padLeft('OFERTA', 9)}${padLeft('TOTAL', 10)}`);
      lines.push('-'.repeat(75));
      let sum = 0;
      let sumOk = items.length > 0;
      for (const item of items) {
        lines.push('[ ] '
          + padRight(item.central || item.code || '', 10)
          + padRight(cut(item.nombre || '', 28), 29)
          + padLeft(item.quantity || '?', 5)
          + padLeft(cleanMoney(item.pvd), 9)
          + padLeft(cleanMoney(item.oferta), 9)
          + padLeft(cleanMoney(item.total), 10));
        const t = parseSpanishNumber(item.total);
        if (Number.isFinite(t)) sum += t; else sumOk = false;
      }
      lines.push('-'.repeat(75));
      lines.push(`    ${padRight(`${items.length} lineas`, 39)}${padLeft('SUMA TOTAL:', 24)}${padLeft(sumOk ? formatEuro(sum) : '', 12)}`);
    } else {
      lines.push('-'.repeat(46));
      for (const item of items) {
        const qty = item.quantity || '?';
        const name = item.nombre || '';
        const code = item.code || '';
        lines.push(`[ ] ${padRight(qty, 4)} x ${padRight(code, 14)} ${name}`);
      }
    }
    lines.push('');
    lines.push('    Bultos recibidos: ____   Incidencias: ______________');
  }
  lines.push('');
  lines.push('='.repeat(75));
  lines.push('Marcar cada linea al contar. Si falta o sobra algo,');
  lines.push('apuntarlo y registrar la incidencia en UnideGes.');
  return lines.join('\n');
}

function cut(s, n) {
  const str = String(s || '');
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

function padLeft(value, width) {
  const str = String(value ?? '');
  return str.length >= width ? str : ' '.repeat(width - str.length) + str;
}

// Los importes del grid vienen como "1,89 €" o "12,345"; para la tabla se
// quita el símbolo y los espacios (la cabecera ya dice que son euros).
function cleanMoney(value) {
  return String(value ?? '').replace(/[€\s ]/g, '');
}

function parseSpanishNumber(value) {
  const s = cleanMoney(value).replace(/\./g, '').replace(',', '.');
  if (!s) return NaN;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

function formatEuro(n) {
  return `${n.toFixed(2).replace('.', ',')} EUR`;
}

// --- impresión --------------------------------------------------------

// Imprime texto en la impresora del PC (Windows): se escribe a un archivo
// temporal UTF-8 con BOM y se manda con Out-Printer (impresora
// predeterminada, o la de config.arrival.printerName). Antes se comprueba
// si la impresora está APAGADA/desconectada (WorkOffline): el trabajo se
// encola igual —Windows lo imprime solo al encenderla—, pero se devuelve
// queuedOffline=true para avisar por Telegram de que hay que encenderla.
// En otros sistemas se omite con aviso.
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
      const psName = printerName.replace(/'/g, "''").replace(/"/g, '');
      const nameArg = printerName ? ` -Name '${psName}'` : '';
      const getPrinter = printerName
        ? `Get-CimInstance Win32_Printer -Filter "Name='${psName}'"`
        : 'Get-CimInstance Win32_Printer -Filter "Default=TRUE"';
      // Primero el estado (marcador en stdout), después la impresión.
      const command = [
        `$p = ${getPrinter} | Select-Object -First 1`,
        "if ($p -and $p.WorkOffline) { Write-Output 'PRINTER_OFFLINE' } else { Write-Output 'PRINTER_ONLINE' }",
        `Get-Content -LiteralPath '${file.replace(/'/g, "''")}' -Encoding UTF8 | Out-Printer${nameArg}`
      ].join('; ');
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true });
      let stderr = '';
      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => resolve({ ok: false, error: error.message }));
      child.on('close', (code) => {
        const queuedOffline = /PRINTER_OFFLINE/.test(stdout);
        if (code === 0) resolve({ ok: true, queuedOffline });
        else resolve({ ok: false, queuedOffline, error: stderr.trim() || `powershell salió con código ${code}` });
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

  // Devuelve { key, dateStr } si toca generar la lista ahora; null si no.
  // Solo decide el CUÁNDO (hora + una vez al día); el llamador busca los
  // pedidos (web o historial local) y marca la clave al terminar.
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
    return { key, dateStr: parts.date };
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
export function addDays(dateStr, days) {
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
