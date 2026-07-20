import path from 'node:path';
import { readJsonSafe, writeJsonAtomic } from './safeJson.js';

// Tarea diaria automática (config.autoAdvisor): una vez al día, a la hora
// configurada, el bot (1) refresca las promociones de la web y (2) busca
// pedidos PDA nuevos en Pedidos; si hay, corre el análisis de ahorro de
// cada uno y lo manda por Telegram sin que nadie lo pida. El estado (qué
// día ya corrió, qué pedidos ya se analizaron) vive en un JSON en logs
// para sobrevivir reinicios. Mismo patrón que ArrivalChecklistScheduler.

const STATE_FILE = 'auto-advisor-state.json';
const ANALYZED_KEEP = 200;

export class AutoAdvisorScheduler {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.state = loadState(config.logsDir, logger);
  }

  // { key, dateStr } si toca correr ahora; null si no. Solo decide el
  // CUÁNDO; el llamador hace el trabajo y llama markSent al terminar.
  due(now = new Date()) {
    const auto = this.config.autoAdvisor || {};
    if (!auto.enabled) return null;
    const timezone = this.config.ordering?.timezone || 'Europe/Madrid';
    const parts = zonedParts(now, timezone);
    const runMinutes = parseTimeToMinutes(auto.time || '07:15');
    // "time" es la hora MÁS TEMPRANA, no una cita: el PC de la tienda se
    // enciende cuando se enciende, así que por defecto NO hay límite
    // superior — la primera vez que el bot esté vivo pasada esa hora, corre
    // (una vez al día). windowMinutes > 0 lo acota si algún día hiciera falta.
    const windowMinutes = Number(auto.windowMinutes);
    const nowMinutes = parts.hour * 60 + parts.minute;
    if (nowMinutes < runMinutes) return null;
    if (Number.isFinite(windowMinutes) && windowMinutes > 0 && nowMinutes > runMinutes + windowMinutes) return null;
    const key = `auto|${parts.date}`;
    if (this.state.sent[key]) return null;
    return { key, dateStr: parts.date };
  }

  markSent(key) {
    this.state.sent[key] = new Date().toISOString();
    this.save();
  }

  isOrderAnalyzed(orderName) {
    return Boolean(this.state.analyzedOrders[String(orderName)]);
  }

  markOrderAnalyzed(orderName) {
    this.state.analyzedOrders[String(orderName)] = new Date().toISOString();
    // Poda: los pedidos viejos no vuelven a aparecer, no hace falta recordarlos todos.
    const entries = Object.entries(this.state.analyzedOrders);
    if (entries.length > ANALYZED_KEEP) {
      entries.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
      for (const [name] of entries.slice(0, entries.length - ANALYZED_KEEP)) delete this.state.analyzedOrders[name];
    }
    this.save();
  }

  save() {
    try {
      writeJsonAtomic(path.resolve(this.config.logsDir || '.', STATE_FILE), this.state);
    } catch (error) {
      this.logger?.warn('auto advisor state save failed', { error: error.message });
    }
  }
}

function loadState(logsDir, logger) {
  try {
    const parsed = readJsonSafe(path.resolve(logsDir || '.', STATE_FILE), null, logger);
    if (parsed) return { sent: parsed.sent || {}, analyzedOrders: parsed.analyzedOrders || {} };
  } catch (error) {
    logger?.warn('auto advisor state load failed', { error: error.message });
  }
  return { sent: {}, analyzedOrders: {} };
}

function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour === '24' ? 0 : parts.hour),
    minute: Number(parts.minute)
  };
}

function parseTimeToMinutes(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 7 * 60 + 15;
  return Number(m[1]) * 60 + Number(m[2]);
}
