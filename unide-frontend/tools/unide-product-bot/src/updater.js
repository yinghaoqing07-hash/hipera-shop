import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export async function applyUpdatePackage(zipPath, config, logger) {
  const scriptPath = path.join(config.__toolRoot, 'apply-update.ps1');
  if (!fs.existsSync(scriptPath)) {
    return { status: 'error', error: `update script not found: ${scriptPath}` };
  }

  const result = await run('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-ZipPath',
    zipPath
  ], { timeoutMs: 60000 });

  if (result.exitCode !== 0) {
    logger?.error('update failed', { stdout: result.stdout, stderr: result.stderr });
    return {
      status: 'error',
      error: result.stderr || result.stdout || `exit code ${result.exitCode}`
    };
  }

  logger?.info('update applied', { zipPath });
  return { status: 'ok', stdout: result.stdout };
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
    }, options.timeoutMs ?? 60000);

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
