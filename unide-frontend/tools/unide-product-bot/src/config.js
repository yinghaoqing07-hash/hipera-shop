import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
export const toolRoot = path.resolve(path.dirname(__filename), '..');

const defaultOrderApplySteps = [
  { type: 'focus' },
  { type: 'click', name: 'Nuevo pedido', x: 327, y: 177 },
  { type: 'wait', ms: 1000 },
  { type: 'setField', name: 'Nombre del Pedido', x: 486, y: 267, value: '{{orderName}}' },
  { type: 'wait', ms: 300 },
  { type: 'click', name: 'Primera linea articulo', x: 694, y: 615 },
  { type: 'wait', ms: 200 },
  {
    type: 'orderLines',
    selectKeys: '{ENTER}',
    quantityKeys: '{TAB}',
    finishLineKeys: '{ENTER}{ENTER}',
    autocompleteMs: 700,
    selectedMs: 300,
    betweenLinesMs: 700
  },
  { type: 'screenshot', name: 'Order filled screenshot' }
];

const defaultConfig = {
  telegram: {
    allowedChatIds: [],
    pollTimeoutSeconds: 25,
    maxItemsPerMessage: 5
  },
  supplierCsv: 'data/supplier_products_clean.csv',
  storeCsv: 'data/store_products_clean.csv',
  logsDir: 'logs',
  ordering: {
    enabled: true,
    timezone: 'Europe/Madrid',
    reminderTime: '10:00',
    reminderWindowMinutes: 180,
    reminderChatIds: []
  },
  desktop: {
    enabled: false,
    script: 'desktop/unideges-search.ps1',
    windowTitleRegex: 'UNIDEGES|Articulos|Artículos',
    excludedProcessNames: ['chrome', 'msedge', 'firefox'],
    screenshotDir: 'screenshots',
    expectedScreen: { width: 0, height: 0 },
    steps: [],
    orderApplySteps: defaultOrderApplySteps
  }
};

export function loadDotEnv(envPath = path.join(toolRoot, '.env')) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

export function resolveToolPath(value) {
  if (!value) return value;
  if (path.isAbsolute(value)) return value;
  return path.resolve(toolRoot, value);
}

export function loadConfig(configPath) {
  loadDotEnv();

  const configFile = configPath ? path.resolve(configPath) : path.join(toolRoot, 'config.local.json');
  const userConfig = fs.existsSync(configFile)
    ? JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''))
    : {};

  const config = mergeDeep(defaultConfig, userConfig);
  config.__configFile = configFile;
  config.__toolRoot = toolRoot;
  config.supplierCsv = resolveToolPath(config.supplierCsv);
  config.storeCsv = resolveToolPath(config.storeCsv);
  config.logsDir = resolveToolPath(config.logsDir);
  config.desktop.script = resolveToolPath(config.desktop.script);
  config.desktop.screenshotDir = resolveToolPath(config.desktop.screenshotDir);
  normalizeDesktopDefaults(config);

  tryMkdir(config.logsDir);
  tryMkdir(config.desktop.screenshotDir);

  return config;
}

function normalizeDesktopDefaults(config) {
  if (!Array.isArray(config.desktop.orderApplySteps) || isZeroCoordinateOrderFlow(config.desktop.orderApplySteps)) {
    config.desktop.orderApplySteps = defaultOrderApplySteps;
  }
}

function isZeroCoordinateOrderFlow(steps) {
  const coordinateSteps = steps.filter((step) => ['click', 'setField'].includes(step?.type));
  if (!coordinateSteps.length) return false;
  return coordinateSteps.every((step) => Number(step.x || 0) === 0 || Number(step.y || 0) === 0);
}

function tryMkdir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // The logger and desktop scripts will continue without blocking startup.
  }
}

function mergeDeep(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }
  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    output[key] = mergeDeep(base[key], value);
  }
  return output;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readArg(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}


