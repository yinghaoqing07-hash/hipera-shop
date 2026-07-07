import fs from 'node:fs';
import path from 'node:path';

// Diccionario "fruta/verdura → código" con APRENDIZAJE, para el cambio de
// precio automatizado (/precio_fruta):
//   - Primera vez: se busca el nombre en las tablas locales (tienda y
//     proveedor) y el usuario elige el candidato correcto con un botón.
//   - El bot GUARDA la elección en data/frutas-codigos.json (el directorio
//     data sobrevive a update-bot), así la próxima vez es instantáneo.
//   - /fruta_add permite registrar a mano un nombre → código (p. ej. si el
//     código viene del panel Diseño Pantalla y no está en las tablas).

const MAP_FILE = 'data/frutas-codigos.json';
// Diccionario "de fábrica": nombre→código que viaja con el bot (el usuario
// entregó la lista de frutas/verduras). Se consulta DESPUÉS del aprendido
// (para que una corrección manual del usuario mande) y ANTES de las tablas
// locales. Va en la raíz del tool, así que update-bot lo refresca; el
// aprendido vive en data/ y sobrevive a las actualizaciones.
const SEED_FILE = 'fruta-codigos-seed.json';
let seedCache = null;

function loadFruitSeed(config) {
  if (seedCache) return seedCache;
  try {
    const file = path.resolve(config.__toolRoot || '.', SEED_FILE);
    if (!fs.existsSync(file)) { seedCache = {}; return seedCache; }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    seedCache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    seedCache = {};
  }
  return seedCache;
}

export function normalizeFruitName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapPath(config) {
  return path.resolve(config.__toolRoot || '.', MAP_FILE);
}

export function loadFruitMap(config) {
  try {
    const file = mapPath(config);
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveFruitEntry(config, name, codigo, articulo, logger) {
  try {
    const key = normalizeFruitName(name);
    if (!key || !codigo) return false;
    const file = mapPath(config);
    const map = loadFruitMap(config);
    map[key] = { codigo: String(codigo), articulo: String(articulo || '').trim(), savedAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(map, null, 2));
    return true;
  } catch (error) {
    logger?.warn?.('could not save fruit code entry', { error: error.message });
    return false;
  }
}

// Resuelve un nombre a código:
//   { status: 'found', codigo, articulo, source: 'aprendido'|'tabla' }
//   { status: 'candidates', candidates: [{codigo, articulo}] }  → elegir
//   { status: 'not_found' }
export function resolveFruitCode(config, storeIndex, supplierIndex, name) {
  const key = normalizeFruitName(name);
  if (!key) return { status: 'not_found' };

  const learned = loadFruitMap(config)[key];
  if (learned?.codigo) {
    return { status: 'found', codigo: learned.codigo, articulo: learned.articulo || '', source: 'aprendido' };
  }

  const seed = loadFruitSeed(config)[key];
  if (seed?.codigo) {
    return { status: 'found', codigo: seed.codigo, articulo: seed.articulo || '', source: 'tabla frutas' };
  }

  const candidates = searchByName(storeIndex, supplierIndex, key);
  if (candidates.length === 1) {
    return { status: 'found', codigo: candidates[0].codigo, articulo: candidates[0].articulo, source: 'tabla' };
  }
  if (candidates.length > 1) return { status: 'candidates', candidates };
  return { status: 'not_found' };
}

// Busca por nombre en la tabla de la tienda y en el catálogo del proveedor:
// filas cuyo nombre contiene TODOS los tokens de la consulta. Dedupe por
// código, tienda primero. Tope 8 (se elige con botones).
function searchByName(storeIndex, supplierIndex, normalizedQuery, max = 8) {
  const tokens = normalizedQuery.split(' ').filter(Boolean);
  if (!tokens.length) return [];
  const out = [];
  const seen = new Set();
  const scan = (rows, nameField) => {
    for (const row of rows || []) {
      const nombre = normalizeFruitName(row?.[nameField] || row?.articulo || '');
      if (!nombre) continue;
      if (!tokens.every((t) => nombre.includes(t))) continue;
      const codigo = String(row.codigo_unide || '').replace(/[^\d]/g, '');
      if (!codigo || seen.has(codigo)) continue;
      seen.add(codigo);
      out.push({ codigo, articulo: String(row[nameField] || row.articulo || '').trim() });
      if (out.length >= max) return;
    }
  };
  scan(storeIndex?.rows, 'articulo_tienda');
  if (out.length < max) scan(supplierIndex?.rows, 'articulo');
  return out;
}

// Separa el argumento de /precio_fruta en nombre + precio opcional. El
// precio es el ÚLTIMO token si tiene decimales (2,99 / 1.50); así "manzana
// golden 2,99" → { name: 'manzana golden', priceRaw: '2,99' } y un código
// suelto no se confunde con un precio.
export function parseFruitCommandArg(argText) {
  const arg = String(argText || '').replace(/\s+/g, ' ').trim();
  if (!arg) return { name: '', priceRaw: '' };
  const match = arg.match(/^(.*\S)\s+(\d+[.,]\d+)\s*€?$/);
  if (match) return { name: match[1].trim(), priceRaw: match[2] };
  return { name: arg, priceRaw: '' };
}

// Cambio de precio en LOTE (/precios_fruta): una línea por artículo,
// "nombre 2,99" o "código 2,99". Devuelve una entrada por línea no vacía.
export function parseFruitBatchLines(bodyText) {
  return String(bodyText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((raw) => ({ raw, ...parseFruitCommandArg(raw) }));
}

// Clasifica las líneas del lote en listas para el plan:
//   ready  → [{ name, priceRaw, codigo, articulo }]  se pueden cambiar ya
//   issues → [{ raw, name, reason: 'no_price'|'ambiguous'|'not_found', count? }]
// Un "nombre" que es todo dígitos (≥3) se toma como código directo, sin
// pasar por el diccionario: el usuario ya tiene los códigos apuntados.
export function partitionFruitBatch(config, storeIndex, supplierIndex, entries) {
  const ready = [];
  const issues = [];
  for (const entry of entries || []) {
    if (!entry.priceRaw) { issues.push({ raw: entry.raw, name: entry.name, reason: 'no_price' }); continue; }
    const compact = String(entry.name || '').replace(/\s+/g, '');
    if (/^\d{3,}$/.test(compact)) {
      ready.push({ name: entry.name, priceRaw: entry.priceRaw, codigo: compact, articulo: '' });
      continue;
    }
    const resolved = resolveFruitCode(config, storeIndex, supplierIndex, entry.name);
    if (resolved.status === 'found') {
      ready.push({ name: entry.name, priceRaw: entry.priceRaw, codigo: resolved.codigo, articulo: resolved.articulo || '' });
    } else if (resolved.status === 'candidates') {
      issues.push({ raw: entry.raw, name: entry.name, reason: 'ambiguous', count: resolved.candidates.length });
    } else {
      issues.push({ raw: entry.raw, name: entry.name, reason: 'not_found' });
    }
  }
  return { ready, issues };
}
