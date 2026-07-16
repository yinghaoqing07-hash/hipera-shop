import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_XLSX_SCRIPT = path.resolve(__dirname, '..', 'desktop', 'read-xlsx.ps1');

const HEADER_ALIASES = {
  codigo: ['codigo', 'codigo unide', 'cod unide', 'cod art', 'codigo articulo', 'id articulo', 'articulo codigo'],
  ean: ['ean', 'codigo ean', 'cod ean', 'codigo barras', 'codigo de barras', 'barcode'],
  nombre: ['nombre', 'articulo', 'descripcion', 'descripcion articulo', 'nombre articulo', 'producto']
};

export async function parseProductExport(filePath, originalName = '', options = {}) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  if (ext === '.xls') throw new Error('旧版 .xls 暂不安全支持，请在 UnideGes 里重新导出为 .xlsx 或 .csv。');
  if (ext === '.pdf') throw new Error('PDF 不适合自动诊断，请重新导出为 .xlsx 或 .csv。');
  if (!['.xlsx', '.csv', '.txt', '.tsv'].includes(ext)) {
    throw new Error('只接受 .xlsx 或 .csv 商品导出文件。');
  }

  let matrix;
  if (ext === '.xlsx') {
    matrix = await readXlsx(filePath, options.xlsxScript || DEFAULT_XLSX_SCRIPT);
  } else {
    const text = decodeText(fs.readFileSync(filePath));
    matrix = parseDelimited(text);
  }
  return normalizeMatrix(matrix);
}

export function normalizeMatrix(matrix) {
  const rows = Array.isArray(matrix) ? matrix.filter((row) => Array.isArray(row) && row.some(nonEmpty)) : [];
  if (!rows.length) throw new Error('文件里没有读到商品行。');

  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) throw new Error('没有找到 Código Unide / EAN / Artículo 列，请确认导出的是 Pedido 商品明细。');
  const headers = rows[headerIndex].map(normalizeHeader);
  const columns = findColumns(headers);
  if (columns.codigo < 0 && columns.ean < 0) throw new Error('文件里没有可用的 Código Unide 或 EAN 列。');

  const items = [];
  let ignored = 0;
  for (let offset = headerIndex + 1; offset < rows.length; offset += 1) {
    const row = rows[offset];
    const codigo = normalizeIdentifier(cell(row, columns.codigo));
    const ean = normalizeIdentifier(cell(row, columns.ean));
    const nombre = cleanText(cell(row, columns.nombre));
    if (!codigo && !ean) { ignored += 1; continue; }
    items.push({ codigo, ean, nombre, sourceRow: offset + 1 });
  }
  if (!items.length) throw new Error('找到表头了，但没有读到任何 Código/EAN。');

  const unique = [];
  const seen = new Map();
  for (const item of items) {
    const key = item.ean ? `ean:${item.ean}` : `codigo:${item.codigo}`;
    if (seen.has(key)) {
      seen.get(key).duplicateRows.push(item.sourceRow);
      continue;
    }
    const record = { ...item, duplicateRows: [] };
    seen.set(key, record);
    unique.push(record);
  }
  return {
    items: unique,
    meta: {
      sourceRows: items.length,
      uniqueItems: unique.length,
      duplicates: items.length - unique.length,
      ignored,
      headerRow: headerIndex + 1
    }
  };
}

export function buildProductDiagnosis({ input, desktop, supplier }) {
  const values = desktop?.values || {};
  const supplierProduct = supplier?.product || supplier || null;
  const banco = normalizeBanco(values.bancoDatos);
  const codigo = normalizeIdentifier(values.codigoPantalla || input.codigo);
  const current = {
    banco,
    codigo,
    pcMedio: parseLocaleNumber(values.pcMedio),
    pcUltimo: parseLocaleNumber(values.pcUltimo),
    pDefecto: parseLocaleNumber(values.pDefectoPrice),
    pDefectoPct: parseLocaleNumber(values.pDefectoPct),
    pTpv: parseLocaleNumber(values.pTpvPrice),
    pTpvPct: parseLocaleNumber(values.pTpvPct),
    supplierCode: normalizeIdentifier(values.supplierCode),
    supplierName: cleanText(values.supplierName),
    supplierRef: cleanText(values.supplierRef),
    inventariable: cleanText(values.inventariable),
    bloqVenta: parseBoolean(values.bloqVentaChecked)
  };
  const recommendation = {
    pvd: roundMoney(firstPositive(supplierProduct?.pvd_promocion, supplierProduct?.pvd)),
    pvp2: roundMoney(secondRecommendedPrice(supplierProduct)),
    supplierCode: '12074',
    supplierName: 'UNIDE SDAD.COOP',
    ref: codigo ? `9${codigo}0` : ''
  };

  const warnings = [...(desktop?.warnings || [])];
  const issues = [];
  const plan = [];
  let outcome = 'ok';

  if (desktop?.status !== 'ok' || !banco || !codigo) {
    return {
      input, current, recommendation, outcome: 'manual',
      issues: ['系统中没有可靠地加载到该商品'],
      plan: ['记录下来，交给人工确认是否完全没有商品'],
      warnings: warnings.concat(desktop?.error ? [String(desktop.error)] : [])
    };
  }

  if (banco === 'SDC') {
    outcome = 'repair';
    issues.push('没有 TIENDA 商品资料');
    if (!(recommendation.pvd > 0) || !(recommendation.pvp2 > 0)) {
      issues.push('供应商表缺少可用的 PVD 或第二建议售价');
      plan.push('停止自动处理，交给人工补价格');
      outcome = 'manual';
    } else {
      plan.push(`在 SDC 填 PC Medio/PC Último = ${formatMoney(recommendation.pvd)}`);
      plan.push(`按第二建议售价设置 P.defecto/P.TPV = ${formatMoney(recommendation.pvp2)}`);
      plan.push(`Proveedor = 12074 UNIDE SDAD.COOP；Ref. = ${recommendation.ref}`);
      plan.push('Inventariable = Sí；Bloq.Venta 取消；Guardar 后确认 TIENDA 行出现');
    }
  } else {
    if (current.bloqVenta === true) issues.push('Bloq.Venta 已勾选');
    if (!current.supplierCode && !current.supplierName) issues.push('Proveedor 为空');
    if (!current.inventariable) issues.push('Inventariable 为空');

    const hasSalePrice = current.pTpv > 0 || current.pDefecto > 0;
    const cost = firstPositive(current.pcUltimo, current.pcMedio);
    const sale = firstPositive(current.pTpv, current.pDefecto);
    const negativeActualMargin = cost > 0 && sale > 0 && sale < cost;
    if (!hasSalePrice) issues.push('没有售价');
    else if ((Number.isFinite(current.pDefectoPct) && current.pDefectoPct <= 0) || negativeActualMargin) {
      issues.push('价格毛利异常（P.defecto ≤ 0 或实际售价低于成本）');
    }

    if (issues.length) outcome = 'repair';
    if (current.bloqVenta === true) plan.push('取消 Bloq.Venta');
    if (!current.supplierCode && !current.supplierName) {
      plan.push('填 Proveedor = 12074 UNIDE SDAD.COOP');
      if (codigo) plan.push(`Ref. = ${recommendation.ref}`);
    }
    if (!current.inventariable) plan.push('Inventariable = Sí');
    if (issues.some((issue) => /没有售价|价格毛利异常/.test(issue))) {
      if (recommendation.pvd > 0 && recommendation.pvp2 > 0) {
        plan.push(`成本采用供应商 PVD ${formatMoney(recommendation.pvd)}，售价采用第二建议价 ${formatMoney(recommendation.pvp2)}`);
      } else {
        plan.push('供应商表价格不完整，交给人工定价');
        outcome = 'manual';
      }
    }
  }

  plan.push('处理完成并验证后生成 etiqueta（本阶段只列计划，不执行）');
  if (!issues.length) plan.unshift('现有资料未发现 1-6 类问题');
  return { input, current, recommendation, outcome, issues, plan, warnings };
}

export function formatDiagnosticsSummary(results, meta = {}) {
  // CORTO y al grano (petición de la dueña): una línea si todo está bien;
  // si hay problemas, solo la lista de los artículos afectados con su
  // problema en una línea cada uno. El detalle completo vive en el CSV.
  const conProblemas = results.filter((r) => r.outcome !== 'ok');
  if (!conProblemas.length) {
    return `诊断完成：${results.length} 件全部正常。（全程只读，没改任何东西）`;
  }
  const nombreDe = (r) => String(r.input?.nombre || r.input?.codigo || r.input?.ean || '?').slice(0, 40);
  const lineas = conProblemas.slice(0, 12).map((r) => {
    const que = r.outcome === 'error'
      ? `读取失败（${String((r.issues || [])[0] || '未知').slice(0, 60)}）`
      : (r.issues || []).join('、').slice(0, 90) || '需人工确认';
    return `- ${nombreDe(r)}：${que}`;
  });
  if (conProblemas.length > 12) lineas.push(`…还有 ${conProblemas.length - 12} 件，见 CSV`);
  return [
    `诊断完成：共 ${results.length} 件，正常 ${results.length - conProblemas.length}，有问题 ${conProblemas.length} 件：`,
    ...lineas,
    '明细和建议见 CSV。全程只读。'
  ].join('\n');
}

export function writeDiagnosticsCsv(filePath, results) {
  const headers = [
    'fila', 'codigo_entrada', 'ean_entrada', 'nombre_entrada', 'resultado', 'base_datos', 'codigo_sistema',
    'problemas', 'plan_reparacion', 'pc_medio', 'pc_ultimo', 'p_defecto', 'p_defecto_pct', 'p_tpv',
    'proveedor_actual', 'inventariable', 'bloq_venta', 'pvd_sugerido', 'pvp2_sugerido', 'avisos'
  ];
  const rows = results.map((result) => {
    const c = result.current || {};
    const r = result.recommendation || {};
    return [
      result.input?.sourceRow, result.input?.codigo, result.input?.ean, result.input?.nombre, result.outcome,
      c.banco, c.codigo, (result.issues || []).join(' | '), (result.plan || []).join(' | '),
      numberOrBlank(c.pcMedio), numberOrBlank(c.pcUltimo), numberOrBlank(c.pDefecto), numberOrBlank(c.pDefectoPct),
      numberOrBlank(c.pTpv), [c.supplierCode, c.supplierName].filter(Boolean).join(' '), c.inventariable,
      c.bloqVenta === null ? '' : String(c.bloqVenta), numberOrBlank(r.pvd), numberOrBlank(r.pvp2),
      (result.warnings || []).join(' | ')
    ];
  });
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `\uFEFF${csv}`, 'utf8');
  return filePath;
}

export function parseLocaleNumber(value) {
  const raw = String(value ?? '').trim().replace(/\s/g, '').replace(/€/g, '');
  if (!raw) return NaN;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const number = Number.parseFloat(normalized.replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? number : NaN;
}

export function secondRecommendedPrice(product) {
  return firstPositive(product?.pvp2, product?.pvp3, product?.pvp1);
}

function parseDelimited(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const delimiter = detectDelimiter(lines.slice(0, 8));
  return lines.map((line) => parseDelimitedLine(line, delimiter));
}

function detectDelimiter(lines) {
  const candidates = [';', '\t', ','];
  let best = ';';
  let bestScore = -1;
  for (const delimiter of candidates) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter));
    const score = counts.filter((count) => count > 0).length * 100 + Math.min(...counts);
    if (score > bestScore) { best = delimiter; bestScore = score; }
  }
  return best;
}

function parseDelimitedLine(line, delimiter) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') { current += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { cells.push(current); current = ''; }
    else current += char;
  }
  cells.push(current);
  return cells;
}

function countOutsideQuotes(line, delimiter) {
  let count = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === delimiter && !quoted) count += 1;
  }
  return count;
}

function findHeaderRow(rows) {
  for (let index = 0; index < Math.min(rows.length, 25); index += 1) {
    const headers = rows[index].map(normalizeHeader);
    const columns = findColumns(headers);
    if (columns.codigo >= 0 || columns.ean >= 0) return index;
  }
  return -1;
}

function findColumns(headers) {
  const result = { codigo: -1, ean: -1, nombre: -1 };
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    result[field] = headers.findIndex((header) => aliases.includes(header));
  }
  return result;
}

function normalizeHeader(value) {
  return cleanText(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function decodeText(buffer) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  if (!utf8.includes('\uFFFD')) return utf8;
  return new TextDecoder('windows-1252').decode(buffer);
}

function readXlsx(filePath, scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-InputPath', filePath], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) { reject(new Error(stderr || stdout || 'XLSX 读取失败')); return; }
      try {
        const last = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
        const parsed = JSON.parse(last || '{}');
        if (parsed.status !== 'ok' || !Array.isArray(parsed.rows)) throw new Error(parsed.error || 'XLSX 没有返回行');
        resolve(parsed.rows);
      } catch (error) { reject(new Error(`XLSX 解析失败：${error.message}`)); }
    });
  });
}

function normalizeIdentifier(value) { return String(value ?? '').replace(/\.0+$/, '').replace(/[^\d]/g, ''); }
function cleanText(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function cell(row, index) { return index >= 0 ? row[index] ?? '' : ''; }
function nonEmpty(value) { return String(value ?? '').trim() !== ''; }
function normalizeBanco(value) { const text = cleanText(value).toUpperCase(); return /TIENDA/.test(text) ? 'TIENDA' : (/SDC/.test(text) ? 'SDC' : ''); }
function parseBoolean(value) { const text = String(value ?? '').trim().toLowerCase(); if (['true', '1', 'yes', 'si', 'sí', 'checked'].includes(text)) return true; if (['false', '0', 'no', 'unchecked'].includes(text)) return false; return null; }
function firstPositive(...values) { for (const value of values) { const n = parseLocaleNumber(value); if (n > 0) return n; } return NaN; }
function roundMoney(value) { return Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : NaN; }
function numberOrBlank(value) { return Number.isFinite(value) ? String(value).replace('.', ',') : ''; }
function formatMoney(value) { return Number(value).toFixed(2).replace('.', ','); }
function csvCell(value) { const text = String(value ?? ''); return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
