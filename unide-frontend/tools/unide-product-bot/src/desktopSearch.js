import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export async function searchDesktop(item, config, logger, options = {}) {
  const query = item.codigo || item.ean || item.nombre;
  // El cambio de precio de fruta busca por CÓDIGO, que en Artículos va en su
  // propio campo, no en el catalejo/EAN. byCode usa el modo searchCode (que
  // en el PS cae en `steps` si no se han calibrado codeSearchSteps).
  const mode = options.byCode ? 'searchCode' : 'search';
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

export async function applyOrderDesktop(draft, config, logger) {
  return runDesktopAction('orderApply', draft.orderName, draft, config, logger, { timeoutMs: 120000 });
}

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
    JSON.stringify(variables || {})
  ];

  logger?.info(`desktop ${mode} started`, { query });
  const result = await run('powershell.exe', args, { timeoutMs: options.timeoutMs ?? 45000 });
  if (result.exitCode !== 0) {
    return {
      status: 'error',
      error: result.stderr || result.stdout || `exit code ${result.exitCode}`
    };
  }

  const parsed = parseLastJson(result.stdout);
  if (!parsed) {
    return { status: 'error', error: 'desktop script did not return json', stdout: result.stdout };
  }
  if (parsed.screenshot) parsed.screenshot = path.resolve(parsed.screenshot);
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
