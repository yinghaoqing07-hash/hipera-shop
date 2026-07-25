import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeJsonAtomic } from './safeJson.js';

// =====================================================================
// La "línea" de Telegram (petición del dueño, 25/07): hay DOS
// instalaciones del bot —la tienda y casa— compartiendo el MISMO token, y
// Telegram solo deja UNA haciendo getUpdates a la vez (la otra recibe
// "Conflict" y se pierden mensajes a ratos). Este módulo pone nombre a
// cada instalación y guarda si esta máquina está EN ESPERA (no toca
// getUpdates) o AL APARATO. El que tiene la línea contesta /donde con su
// nombre; /linea la suelta; el panel de la máquina en espera la retoma.
// El estado sobrevive a reinicios: logs/telegram-linea.json.
// =====================================================================

const ARCHIVO = 'telegram-linea.json';

// Nombre de ESTA instalación: config.instancia.nombre (p.ej. "店里" /
// "家里") o, sin configurar, el nombre de la máquina de Windows — que ya
// distingue las dos (los dos PC del dueño tienen hostname distinto).
export function nombreInstancia(config) {
  return String(config?.instancia?.nombre || '').trim() || os.hostname();
}

function rutaEstado(config) {
  return path.resolve(config?.logsDir || 'logs', ARCHIVO);
}

export function leerLinea(config) {
  try {
    const raw = JSON.parse(fs.readFileSync(rutaEstado(config), 'utf8'));
    return { standby: Boolean(raw.standby), desde: String(raw.desde || ''), motivo: String(raw.motivo || '') };
  } catch {
    return { standby: false, desde: '', motivo: '' };
  }
}

export function guardarLinea(config, { standby, motivo = '' }) {
  const file = rutaEstado(config);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, { standby: Boolean(standby), desde: new Date().toISOString(), motivo: String(motivo || '') });
}

// ¿Este error del bucle de polling es el "Conflict" de Telegram (otra
// instalación peleando por el mismo token)? La descripción oficial es
// "Conflict: terminated by other getUpdates request; make sure that only
// one bot instance is running".
export function esConflictoTelegram(error) {
  const m = String(error?.message || error || '');
  return /terminated by other getUpdates/i.test(m) || (/\bconflict\b/i.test(m) && /getupdates/i.test(m));
}
