import fs from 'node:fs';
import path from 'node:path';

// Tareas AUTOMÁTICAS DIARIAS del bot (recordatorio de pedidos, lista de
// llegada, asesor matinal). Hasta ahora su hora y su on/off vivían solo en
// config.local.json; este módulo las expone como una lista editable desde
// el panel. Los cambios se aplican EN CALIENTE mutando el objeto config
// compartido (los tres schedulers releen config en cada due()) y se
// persisten en logs/auto-tareas.json para sobrevivir reinicios, sin tocar
// config.local.json.

const OVERRIDES_FILE = 'auto-tareas.json';

// Cada entrada sabe leer/escribir su rincón de config. `hoyKey` lo usa
// bot.js para saber si la tarea ya corrió hoy (cada scheduler guarda sus
// claves con un prefijo distinto).
const TAREAS = [
  {
    id: 'advisor',
    label: '晨务：刷新促销＋新PDA单省钱分析',
    desc: '每天到点自动刷新促销数据；发现新 PDA 单就自动跑省钱分析',
    leer: (config) => ({
      enabled: config.autoAdvisor?.enabled !== false,
      time: horaValida(config.autoAdvisor?.time) || '07:15'
    }),
    escribir: (config, cambios) => {
      config.autoAdvisor = config.autoAdvisor || {};
      if (cambios.enabled !== undefined) config.autoAdvisor.enabled = cambios.enabled;
      if (cambios.time) config.autoAdvisor.time = cambios.time;
    }
  },
  {
    id: 'llegada',
    label: '今日到货核对清单（打印＋发消息）',
    desc: '到货日早上自动汇总当天要到的订单，打印勾选清单并发到 Telegram',
    leer: (config) => ({
      enabled: config.arrival?.enabled !== false,
      time: horaValida(config.arrival?.printTime) || '08:30'
    }),
    escribir: (config, cambios) => {
      config.arrival = config.arrival || {};
      if (cambios.enabled !== undefined) config.arrival.enabled = cambios.enabled;
      if (cambios.time) config.arrival.printTime = cambios.time;
    }
  },
  {
    id: 'recordatorio',
    label: '叫货节点提醒',
    desc: '叫货日（周一/周三/周四/周日）到点提醒今天该叫什么货',
    leer: (config) => ({
      enabled: config.ordering?.enabled !== false,
      time: horaValida(config.ordering?.reminderTime) || '10:00'
    }),
    escribir: (config, cambios) => {
      config.ordering = config.ordering || {};
      if (cambios.enabled !== undefined) config.ordering.enabled = cambios.enabled;
      if (cambios.time) config.ordering.reminderTime = cambios.time;
    }
  }
];

export function listAutoTasks(config) {
  return TAREAS.map((tarea) => ({ id: tarea.id, label: tarea.label, desc: tarea.desc, ...tarea.leer(config) }));
}

// Al arrancar: volver a aplicar sobre config lo que el dueño cambió desde
// el panel en sesiones anteriores.
export function applyAutoTaskOverrides(config, logger) {
  const overrides = leerOverrides(config, logger);
  for (const tarea of TAREAS) {
    const cambios = normalizarCambios(overrides[tarea.id]);
    if (cambios) tarea.escribir(config, cambios);
  }
}

// Cambio desde el panel: valida, aplica en caliente y persiste. Devuelve
// el estado resultante de la tarea (para el toast).
export function setAutoTask(config, id, cambios = {}, logger) {
  const tarea = TAREAS.find((t) => t.id === String(id));
  if (!tarea) throw new Error('没有这个每日任务');
  const limpio = {};
  if (cambios.enabled !== undefined) limpio.enabled = Boolean(cambios.enabled);
  if (cambios.time !== undefined) {
    const hora = horaValida(cambios.time);
    if (!hora) throw new Error('时间格式不对，要像 07:30 这样');
    limpio.time = hora;
  }
  if (limpio.enabled === undefined && !limpio.time) throw new Error('没有要改的内容');
  tarea.escribir(config, limpio);
  const overrides = leerOverrides(config, logger);
  overrides[tarea.id] = { ...normalizarCambios(overrides[tarea.id]), ...limpio };
  guardarOverrides(config, overrides, logger);
  return { id: tarea.id, label: tarea.label, ...tarea.leer(config) };
}

function normalizarCambios(valor) {
  if (!valor || typeof valor !== 'object') return null;
  const cambios = {};
  if (typeof valor.enabled === 'boolean') cambios.enabled = valor.enabled;
  const hora = horaValida(valor.time);
  if (hora) cambios.time = hora;
  return (cambios.enabled === undefined && !cambios.time) ? null : cambios;
}

// 'H:MM' o 'HH:MM' → 'HH:MM'; cualquier otra cosa → ''.
function horaValida(valor) {
  const m = String(valor || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

function overridesPath(config) {
  return path.resolve(config.logsDir || '.', OVERRIDES_FILE);
}

function leerOverrides(config, logger) {
  try {
    const file = overridesPath(config);
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    logger?.warn?.('auto task overrides load failed', { error: error.message });
    return {};
  }
}

function guardarOverrides(config, overrides, logger) {
  try {
    const file = overridesPath(config);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(overrides, null, 2));
  } catch (error) {
    logger?.warn?.('auto task overrides save failed', { error: error.message });
    throw new Error('改好了但没能保存到磁盘，重启后可能丢：' + error.message);
  }
}
