import fs from 'node:fs';

export function loadSupplierIndex(csvPath) {
  const index = loadCsvIndex(csvPath, {
    codeField: 'codigo_unide',
    eanField: 'ean',
    nameField: 'articulo'
  });
  return index;
}

export function loadStoreIndex(csvPath) {
  const index = loadCsvIndex(csvPath, {
    codeField: 'codigo_unide',
    eanField: 'ean',
    nameField: 'articulo_tienda'
  });
  return index;
}

function loadCsvIndex(csvPath, fields) {
  if (!csvPath || !fs.existsSync(csvPath)) {
    return { rows: [], byCode: new Map(), byEan: new Map(), fields };
  }

  const text = fs.readFileSync(csvPath, 'utf8');
  const [headerLine, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(headerLine).map((header) => header.replace(/^\uFEFF/, ''));
  const rows = lines.map((line) => rowFromCsv(headers, line)).filter(Boolean);
  const byCode = new Map();
  const byEan = new Map();

  for (const row of rows) {
    const code = normalizeIdentifier(row[fields.codeField]);
    const ean = normalizeIdentifier(row[fields.eanField]);
    if (code) byCode.set(code, row);
    if (ean) byEan.set(ean, row);
  }

  return { rows, byCode, byEan, fields };
}

export function lookupStore(index, item) {
  if (!index) return { status: 'disabled' };

  const query = normalizeIdentifier(item.codigo || item.ean);
  const ean = normalizeIdentifier(item.ean);

  if (query && index.byCode.has(query)) {
    return { status: 'found', matchType: 'codigo', product: index.byCode.get(query) };
  }
  if (query && index.byEan.has(query)) {
    return { status: 'found', matchType: 'ean', product: index.byEan.get(query) };
  }
  if (ean && index.byEan.has(ean)) {
    return { status: 'found', matchType: 'ean', product: index.byEan.get(ean) };
  }

  return { status: 'not_found' };
}

export function lookupSupplier(index, item) {
  if (!index) return { status: 'disabled', candidates: [] };

  const code = normalizeIdentifier(item.codigo);
  const ean = normalizeIdentifier(item.ean);

  if (code && index.byCode.has(code)) {
    return { status: 'found', matchType: 'codigo', product: index.byCode.get(code), candidates: [] };
  }
  if (ean && index.byEan.has(ean)) {
    return { status: 'found', matchType: 'ean', product: index.byEan.get(ean), candidates: [] };
  }

  if (item.nombre) {
    const needle = normalizeText(item.nombre);
    const candidates = index.rows
      .filter((row) => normalizeText(row.articulo).includes(needle))
      .slice(0, 5);
    if (candidates.length === 1) {
      return { status: 'found', matchType: 'nombre', product: candidates[0], candidates: [] };
    }
    if (candidates.length > 1) {
      return { status: 'candidates', candidates };
    }
  }

  return { status: 'not_found', candidates: [] };
}

export function enrichSupplierLookup(supplierIndex, item, storeResult) {
  const direct = lookupSupplier(supplierIndex, item);
  if (direct.status !== 'not_found') return direct;

  const storeCode = normalizeIdentifier(storeResult?.product?.codigo_unide);
  if (!storeCode) return direct;

  const byStoreCode = lookupSupplier(supplierIndex, { ...item, codigo: storeCode });
  if (byStoreCode.status === 'found') {
    return {
      ...byStoreCode,
      matchType: `codigo_desde_cache_tienda (${storeResult.matchType})`,
      viaStore: storeResult.product
    };
  }

  return direct;
}

export function suggestedPrice(product) {
  if (!product) return null;
  return firstPositiveNumber(product.pvp1, product.pvp2, product.pvp3);
}

export function supplierCost(product) {
  if (!product) return null;
  return firstPositiveNumber(product.pvd_promocion, product.pvd);
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number.parseFloat(String(value || '').replace(',', '.'));
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function normalizeIdentifier(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function rowFromCsv(headers, line) {
  const cells = parseCsvLine(line);
  if (!cells.length) return null;
  const row = {};
  headers.forEach((header, index) => {
    row[header] = cells[index] ?? '';
  });
  return row;
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
