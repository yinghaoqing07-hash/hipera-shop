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
  lines.push('='.repeat(93));
  for (const order of orders) {
    lines.push('');
    const estado = order.estado ? `, ${order.estado}` : '';
    lines.push(`PEDIDO: ${order.orderName}   (pedido el ${prettyDate(order.orderDate)}${estado})`);
    // Con precios (pedidos leídos de la web, que traen C.Central/PVD/Oferta/
    // Total del grid) se imprime en tabla; los del historial local viejo no
    // tienen esas columnas y salen en el formato simple de siempre.
    // Ancho total 93 columnas: medido en una impresión real en A4, la fuente
    // de Out-Printer da para ~130, así que 93 entra sobrado y el nombre del
    // artículo (45) casi nunca se corta.
    const items = order.items || [];
    const hasExtras = items.some((it) => it.central || it.pvd || it.total);
    if (hasExtras) {
      lines.push('-'.repeat(93));
      lines.push(`    ${padRight('C.CENTRAL', 10)}${padRight('ARTICULO', 46)}${padLeft('CAJAS', 6)}${padLeft('PVD', 9)}${padLeft('OFERTA', 8)}${padLeft('TOTAL', 10)}`);
      lines.push('-'.repeat(93));
      let sum = 0;
      let sumOk = items.length > 0;
      for (const item of items) {
        lines.push('[ ] '
          + padRight(item.central || item.code || '', 10)
          + padRight(cut(item.nombre || '', 45), 46)
          + padLeft(item.quantity || '?', 6)
          + padLeft(cleanMoney(item.pvd), 9)
          + padLeft(cleanMoney(item.oferta), 8)
          + padLeft(cleanMoney(item.total), 10));
        const t = parseSpanishNumber(item.total);
        if (Number.isFinite(t)) sum += t; else sumOk = false;
      }
      lines.push('-'.repeat(93));
      lines.push(`    ${padRight(`${items.length} lineas`, 55)}${padLeft('SUMA TOTAL:', 22)}${padLeft(sumOk ? formatEuro(sum) : '', 12)}`);
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
  lines.push('='.repeat(93));
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

// Script de PowerShell que imprime el texto con System.Drawing.Printing
// (PrintDocument) en vez de Out-Printer. Motivo: Out-Printer no deja tocar
// ni la fuente ni los márgenes — en A4 dejaba media página en blanco y
// partía las líneas de más de ~85 caracteres. Aquí los márgenes se fijan a
// 0,3" y el tamaño de la fuente (Courier New) se calcula para que la línea
// MÁS LARGA ocupe justo el ancho útil del papel: la tabla llena la hoja.
// Si PrintDocument falla por lo que sea, cae a Out-Printer como antes.
const PRINT_PS1 = String.raw`param(
  [Parameter(Mandatory=$true)][string]$TextPath,
  [string]$PrinterName = '',
  [double]$MaxFontSize = 13
)
$ErrorActionPreference = 'Stop'

# Estado de la impresora (apagada => el trabajo se encola igual)
$filter = if ($PrinterName) { "Name='" + $PrinterName.Replace("'", "''") + "'" } else { 'Default=TRUE' }
try {
  $p = Get-CimInstance Win32_Printer -Filter $filter | Select-Object -First 1
  if ($p -and $p.WorkOffline) { Write-Output 'PRINTER_OFFLINE' } else { Write-Output 'PRINTER_ONLINE' }
} catch { Write-Output 'PRINTER_ONLINE' }

try {
  Add-Type -AssemblyName System.Drawing
  $script:lines = [System.IO.File]::ReadAllLines($TextPath)
  $doc = New-Object System.Drawing.Printing.PrintDocument
  if ($PrinterName) { $doc.PrinterSettings.PrinterName = $PrinterName }
  if (-not $doc.PrinterSettings.IsValid) { throw "Impresora no valida: '$PrinterName'" }
  $doc.DocumentName = 'Lista de llegada'
  # Margenes en centesimas de pulgada: 0,3" lados / 0,35" arriba y abajo
  $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(30, 30, 35, 35)

  $script:format = [System.Drawing.StringFormat]::GenericTypographic
  $script:font = $null
  $script:idx = 0
  $doc.add_PrintPage({
    param($sender, $e)
    if (-not $script:font) {
      # La fuente mas grande con la que la linea mas larga cabe en el ancho util
      $longest = ' '
      foreach ($l in $script:lines) { if ($l.Length -gt $longest.Length) { $longest = $l } }
      $trial = New-Object System.Drawing.Font('Courier New', 10)
      $w = $e.Graphics.MeasureString($longest, $trial, [int]::MaxValue, $script:format).Width
      $trial.Dispose()
      $size = [Math]::Floor(10 * $e.MarginBounds.Width / $w * 4) / 4
      if ($size -gt $MaxFontSize) { $size = $MaxFontSize }
      if ($size -lt 6) { $size = 6 }
      $script:font = New-Object System.Drawing.Font('Courier New', $size)
    }
    $lh = $script:font.GetHeight($e.Graphics)
    $y = [double]$e.MarginBounds.Top
    while ($script:idx -lt $script:lines.Count -and ($y + $lh) -le $e.MarginBounds.Bottom) {
      $e.Graphics.DrawString($script:lines[$script:idx], $script:font, [System.Drawing.Brushes]::Black, $e.MarginBounds.Left, $y, $script:format)
      $y += $lh
      $script:idx++
    }
    $e.HasMorePages = ($script:idx -lt $script:lines.Count)
  })
  $doc.Print()
  Write-Output 'PRINT_SENT'
} catch {
  # Respaldo: el camino viejo. Peor presentacion, pero sale papel.
  Write-Output ("PRINT_FALLBACK " + $_.Exception.Message)
  if ($PrinterName) { Get-Content -LiteralPath $TextPath -Encoding UTF8 | Out-Printer -Name $PrinterName }
  else { Get-Content -LiteralPath $TextPath -Encoding UTF8 | Out-Printer }
}
`;

// Imprime texto en la impresora del PC (Windows) con el script de arriba
// (impresora predeterminada, o la de config.arrival.printerName). Se
// comprueba si la impresora está APAGADA (WorkOffline): el trabajo se
// encola igual —Windows lo imprime al encenderla—, pero se devuelve
// queuedOffline=true para avisar por Telegram. En otros sistemas se omite.
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
      const scriptFile = path.join(dir, 'print-page.ps1');
      fs.writeFileSync(scriptFile, '\uFEFF' + PRINT_PS1, 'utf8'); // BOM: PS 5.1 exige BOM para tratar el .ps1 como UTF-8
      const printerName = String(config.arrival?.printerName || '').trim();
      const maxFont = Number(config.arrival?.printMaxFontSize) || 13;
      const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, '-TextPath', file, '-MaxFontSize', String(maxFont)];
      if (printerName) args.push('-PrinterName', printerName);
      const child = spawn('powershell.exe', args, { windowsHide: true });
      let stderr = '';
      let stdout = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => resolve({ ok: false, error: error.message }));
      child.on('close', (code) => {
        const queuedOffline = /PRINTER_OFFLINE/.test(stdout);
        if (/PRINT_FALLBACK/.test(stdout)) logger?.warn('printdocument fallo, se uso Out-Printer', { detail: stdout.trim().slice(0, 300) });
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
