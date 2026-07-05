const YES_RE = /^(si|sí|s|yes|y|true|1|ok)$/i;
const NO_RE = /^(no|false|0|n)$/i;

export function parseProductMessage(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return { ok: false, error: 'empty_message', items: [] };

  if (/^\/articulos\b/i.test(normalized)) {
    return parseBatch(normalized);
  }
  if (/^\/articulo\b/i.test(normalized)) {
    return parseSingle(normalized);
  }

  const guessed = parseLoose(normalized);
  if (guessed.items.length) return { ok: true, mode: 'loose', items: guessed.items };
  return { ok: false, error: 'unknown_template', items: [] };
}

function baseItem(raw) {
  return {
    raw,
    codigo: '',
    ean: '',
    nombre: '',
    precio: { mode: 'missing', raw: '' },
    margen: { mode: 'missing', raw: '' },
    desbloquear: false,
    etiqueta: false,
    nota: ''
  };
}

function parseSingle(text) {
  const item = baseItem(text);

  for (const line of text.split('\n').slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^([^:：]+)[:：]\s*(.+)$/);
    if (!match) continue;
    const key = normalizeKey(match[1]);
    const value = match[2].trim();

    if (['codigo', 'cod', 'codigo_unide', 'articulo'].includes(key)) item.codigo = onlyDigits(value);
    if (['ean', 'barcode', 'barra', 'barras'].includes(key)) item.ean = onlyDigits(value);
    if (['nombre', 'descripcion', 'producto'].includes(key)) item.nombre = value;
    if (['precio', 'pvp', 'price', 'ptpv', 'p_tpv'].includes(key)) item.precio = parsePrice(value);
    if (['margen', 'margin', 'ptpv_pct', 'p_tpv_pct', 'p_tpv_porcentaje', 'porcentaje'].includes(key)) item.margen = parsePercent(value);
    if (['desbloquear', 'desbloqueo', 'bloqueo'].includes(key)) item.desbloquear = parseBool(value);
    if (['etiqueta', 'label', 'imprimir'].includes(key)) item.etiqueta = parseBool(value);
    if (['nota', 'notas', 'obs', 'observacion'].includes(key)) item.nota = value;
  }

  return validateItems([item], 'single');
}

function parseBatch(text) {
  const items = [];
  for (const line of text.split('\n').slice(1)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    const codigo = onlyDigits(parts[0]);
    if (!codigo) continue;

    const item = baseItem(trimmed);
    item.codigo = codigo;
    const notes = [];

    for (const part of parts.slice(1)) {
      const word = part.toLowerCase();
      const kv = part.match(/^([^=]+)=(.+)$/);
      if (kv) {
        const key = normalizeKey(kv[1]);
        const value = kv[2];
        if (['precio', 'pvp', 'ptpv'].includes(key)) item.precio = parsePrice(value);
        else if (['margen', 'margin', 'ptpv_pct', 'porcentaje'].includes(key)) item.margen = parsePercent(value);
        else notes.push(part);
      } else if (word === 'desbloquear' || word === 'unlock') {
        item.desbloquear = true;
      } else if (word === 'etiqueta' || word === 'label') {
        item.etiqueta = true;
      } else if (word === 'auto' || /^\d+([,.]\d+)?$/.test(part)) {
        item.precio = parsePrice(part);
      } else if (/^margen[:=]?\d+/i.test(part)) {
        item.margen = parsePercent(part.replace(/^margen[:=]?/i, ''));
      } else {
        notes.push(part);
      }
    }

    item.nota = notes.join(' ');
    items.push(item);
  }
  return validateItems(items, 'batch');
}

function parseLoose(text) {
  const codeMatch = text.match(/\b\d{5,14}\b/);
  if (!codeMatch) return { items: [] };
  const priceMatch = text.match(/\b\d+[,.]\d{1,2}\b/);
  const marginMatch = text.match(/(?:margen|ptpv\s*%|p\.?\s*tpv\s*%)\s*[:=]?\s*(\d+(?:[,.]\d+)?)/i);
  const item = baseItem(text);
  item.codigo = onlyDigits(codeMatch[0]);
  item.precio = priceMatch ? parsePrice(priceMatch[0]) : { mode: 'missing', raw: '' };
  item.margen = marginMatch ? parsePercent(marginMatch[1]) : { mode: 'missing', raw: '' };
  item.desbloquear = /desbloquear|bloqueo|解锁|解除/.test(text.toLowerCase());
  item.etiqueta = /etiqueta|label|标签/.test(text.toLowerCase());
  item.nota = 'loose parse';
  return { items: [item] };
}

function validateItems(items, mode) {
  const valid = items.filter((item) => item.codigo || item.ean || item.nombre);
  if (!valid.length) return { ok: false, error: 'missing_product_identifier', mode, items: [] };
  return { ok: true, mode, items: valid };
}

function normalizeKey(value) {
  return value.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[%]/g, 'pct')
    .replace(/\s+/g, '_');
}

function onlyDigits(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

export function parsePrice(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '-') return { mode: 'missing', raw };
  if (/^auto$/i.test(raw)) return { mode: 'auto', raw };
  const normalized = raw.replace(',', '.').replace(/[^\d.]/g, '');
  const number = Number.parseFloat(normalized);
  if (!Number.isFinite(number)) return { mode: 'invalid', raw };
  return { mode: 'manual', raw, value: number };
}

function parsePercent(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '-') return { mode: 'missing', raw };
  const normalized = raw.replace(',', '.').replace(/[^\d.]/g, '');
  const number = Number.parseFloat(normalized);
  if (!Number.isFinite(number)) return { mode: 'invalid', raw };
  return { mode: 'manual', raw, value: number };
}

function parseBool(value) {
  const raw = String(value || '').trim();
  if (YES_RE.test(raw)) return true;
  if (NO_RE.test(raw)) return false;
  return /si|sí|yes|true|1|desbloquear|etiqueta/i.test(raw);
}

export function formatTemplateHelp() {
  return [
    '常用：',
    '/pedido  看今天叫货提醒',
    '',
    '发这个模板给我：',
    '',
    '/articulo',
    'codigo: 620475',
    'precio: 3,49',
    'margen: 30',
    'desbloquear: si',
    'etiqueta: si',
    'nota: FEL 92695469',
    '',
    'precio 可以写 auto；margen 是 P.TPV %。'
  ].join('\n');
}
