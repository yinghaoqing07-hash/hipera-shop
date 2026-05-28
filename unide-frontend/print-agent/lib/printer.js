// =====================================================================
// printer.js — impresion RAW en Windows via spooler (PowerShell helper)
// =====================================================================
// Escribimos los bytes ESC/POS a un archivo temporal y llamamos a
// raw-print.ps1, que usa la API WritePrinter con tipo "RAW". Asi
// imprimimos a traves del driver ya instalado (XP-80C) sin librerias
// nativas ni reemplazo de driver.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PS1 = path.resolve(__dirname, '..', 'raw-print.ps1');

/**
 * Imprime un Buffer ESC/POS en la impresora indicada.
 * Resuelve si el spooler aceptó el trabajo; rechaza (throw) si la
 * impresora no está disponible o hay error de escritura, para que el
 * agente NO marque el pedido como impreso y lo reintente.
 */
export function printRaw(buffer, printerName) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `hipera-ticket-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
    try {
      fs.writeFileSync(tmpFile, buffer);
    } catch (e) {
      return reject(new Error('No se pudo escribir el archivo temporal: ' + e.message));
    }

    const args = [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', PS1,
      '-PrinterName', printerName,
      '-FilePath', tmpFile,
    ];
    const ps = spawn('powershell.exe', args, { windowsHide: true });

    let stderr = '';
    ps.stderr.on('data', (d) => { stderr += d.toString(); });
    ps.on('error', (err) => {
      cleanup(tmpFile);
      reject(new Error('No se pudo lanzar PowerShell: ' + err.message));
    });
    ps.on('close', (code) => {
      cleanup(tmpFile);
      if (code === 0) return resolve(true);
      const reason = code === 2
        ? `Impresora "${printerName}" no disponible (nombre incorrecto u offline)`
        : code === 4
          ? 'Archivo temporal no encontrado'
          : `Error de impresion (codigo ${code})`;
      reject(new Error(reason + (stderr ? ' :: ' + stderr.trim() : '')));
    });
  });
}

function cleanup(file) {
  try { fs.unlinkSync(file); } catch { /* ignore */ }
}
