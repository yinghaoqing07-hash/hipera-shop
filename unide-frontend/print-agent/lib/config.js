// =====================================================================
// Carga de configuracion (.env) — sin dependencias externas.
// =====================================================================
// Leemos un archivo .env sencillo (KEY=VALUE por linea) para no depender
// de paquetes npm: asi la instalacion en el PC de la tienda es solo
// "instalar Node + copiar carpeta + ejecutar", sin `npm install`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Quitamos comillas envolventes si las hay.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const fileEnv = parseEnvFile(path.join(ROOT, '.env'));
// Prioridad: variables del proceso (process.env) > archivo .env.
const get = (k, def) => (process.env[k] ?? fileEnv[k] ?? def);
const num = (k, def) => {
  const v = get(k);
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const bool = (k, def) => {
  const v = get(k);
  if (v === undefined || v === null || v === '') return def;
  return String(v).toLowerCase() === 'true' || v === '1';
};

export const config = {
  ROOT,
  backendUrl: (get('BACKEND_URL', '') || '').replace(/\/$/, ''),
  token: get('PRINT_AGENT_TOKEN', ''),
  printerName: get('PRINTER_NAME', 'XP-80C'),
  pollIntervalMs: num('POLL_INTERVAL_MS', 10000),
  buzzerEnabled: bool('BUZZER_ENABLED', true),
  buzzerCount: Math.min(9, Math.max(1, num('BUZZER_COUNT', 3))),
  buzzerDuration: Math.min(9, Math.max(1, num('BUZZER_DURATION', 3))),
  openDrawer: bool('OPEN_DRAWER', false),
  printWidth: num('PRINT_WIDTH', 48),
  // Cabecera del ticket (datos de la tienda). Valores por defecto = datos
  // reales de HIPERA; configurables por si cambian.
  storeName: get('STORE_NAME', 'HIPERA'),
  storeLegalName: get('STORE_LEGAL_NAME', 'QIANG GUO SL'),
  storeNif: get('STORE_NIF', 'B86126638'),
  storeAddr1: get('STORE_ADDRESS_1', 'Paseo del Sol 1'),
  storeAddr2: get('STORE_ADDRESS_2', '28880 Meco, Madrid'),
  storePhone: get('STORE_PHONE', '+34 918 782 602'),
};

// Validacion temprana con mensajes claros (para el dueño, no tecnico).
export function validateConfig() {
  const problems = [];
  if (!config.backendUrl) problems.push('Falta BACKEND_URL en .env');
  if (!config.token) problems.push('Falta PRINT_AGENT_TOKEN en .env');
  if (!config.printerName) problems.push('Falta PRINTER_NAME en .env');
  return problems;
}
