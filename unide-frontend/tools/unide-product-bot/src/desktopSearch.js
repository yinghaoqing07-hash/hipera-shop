import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export async function searchDesktop(item, config, logger, options = {}) {
  // Tres búsquedas distintas en Artículos:
  //   byCode → campo Código (searchCode);
  //   byName → campo del nombre, con comodines *nombre* (searchName);
  //   por defecto → el catalejo/EAN de siempre (search).
  const query = options.byName
    ? item.nombre
    : (item.codigo || item.ean || item.nombre);
  const mode = options.byName ? 'searchName' : (options.byCode ? 'searchCode' : 'search');
  return runDesktopAction(mode, query, {}, config, logger);
}

export async function clearDesktop(config, logger) {
  return runDesktopAction('clear', 'clear', {}, config, logger);
}

export async function readPriceDesktop(config, logger) {
  return runDesktopAction('priceRead', 'price', {}, config, logger);
}

export async function applyPriceDesktop(plan, config, logger) {
  return runDesktopAction('priceApply', 'price', plan, config, logger);
}

// Marca/desmarca el checkbox Bloq.Venta del artículo YA cargado en pantalla
// y guarda (Ctrl+S). El bot solo llama cuando el estado actual difiere del
// pedido, así que el paso uiaToggleIf siempre debe alternar.
export async function applyBloqDesktop(codigo, config, logger) {
  return runDesktopAction('bloqApply', codigo, { toggleBloqVenta: true }, config, logger);
}

// Descarta los cambios SIN GUARDAR del artículo en pantalla: vaciar
// pantalla y responder "No" al aviso de guardar. Se usa tras un guardado
// fallido, para no dejar el formulario "sucio" (un formulario sucio hace
// que la siguiente búsqueda, al vaciar, dispare el diálogo de confirmación
// que se queda bloqueando la ventana).
export async function discardDesktop(config, logger) {
  return runDesktopAction('discard', 'discard', {}, config, logger);
}

export async function applyOrderDesktop(draft, config, logger) {
  return runDesktopAction('orderApply', draft.orderName, draft, config, logger, { timeoutMs: 120000 });
}

// Vuelca el árbol de controles (UI Automation) de la ventana de UnideGes a
// un fichero: tipo, AutomationId, nombre, clase y valor de cada control.
// Sirve para cablear los pasos uiaFocus/uiaRead/uiaSet por identidad.
export async function dumpUiaDesktop(config, logger) {
  return runDesktopAction('uiaDump', 'uia', {}, config, logger, { timeoutMs: 90000 });
}

// Modo diagnóstico (/debug on): cada acción de escritorio captura la
// pantalla después de CADA paso, además de la traza de texto que ya viaja
// siempre. Se activa aquí y el PS lo recibe como variable __trace.
let TRACE_STEPS = false;
export function setDesktopTrace(enabled) { TRACE_STEPS = Boolean(enabled); }
export function isDesktopTrace() { return TRACE_STEPS; }

async function runDesktopAction(mode, query, variables, config, logger, options = {}) {
  if (!config.desktop?.enabled) {
    return { status: 'disabled', reason: 'desktop.enabled=false' };
  }

  if (!query) return { status: 'skipped', reason: 'missing query' };
  if (!fs.existsSync(config.desktop.script)) {
    return { status: 'error', error: `script not found: ${config.desktop.script}` };
  }

  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    config.desktop.script,
    '-Query',
    String(query),
    '-ConfigPath',
    config.__configFile,
    '-OutDir',
    config.desktop.screenshotDir,
    '-Mode',
    mode,
    '-VariablesJson',
    JSON.stringify(TRACE_STEPS ? { ...(variables || {}), __trace: true } : (variables || {}))
  ];

  logger?.info(`desktop ${mode} started`, { query });
  const result = await run('powershell.exe', args, { timeoutMs: options.timeoutMs ?? 45000 });
  // El PS emite su JSON TAMBIÉN al fallar (status=error + paso exacto +
  // captura del instante + traza) antes de salir con código 1: se parsea
  // SIEMPRE. Antes el código de salida cortaba antes de parsear y toda esa
  // estructura llegaba aplastada como texto plano en `error`.
  const parsed = parseLastJson(result.stdout);
  if (!parsed) {
    return {
      status: 'error',
      error: (result.exitCode !== 0 ? (result.stderr || result.stdout) : '') || 'desktop script did not return json',
      stdout: result.stdout
    };
  }
  if (parsed.screenshot) parsed.screenshot = path.resolve(parsed.screenshot);
  if (Array.isArray(parsed.traceShots)) parsed.traceShots = parsed.traceShots.filter(Boolean).map((p) => path.resolve(p));
  return parsed;
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ exitCode: -1, stdout, stderr: `${stderr}\nTimeout`.trim() });
    }, options.timeoutMs ?? 45000);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function parseLastJson(stdout) {
  const lines = String(stdout || '').trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
    try {
      return JSON.parse(trimmed);
    } catch {
      // Keep scanning older lines.
    }
  }
  return null;
}
