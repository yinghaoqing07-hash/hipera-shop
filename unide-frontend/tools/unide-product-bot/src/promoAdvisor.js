import fs from 'node:fs';
import path from 'node:path';
import { loadFruitMap } from './fruitCodes.js';

// Consejero de ahorro (/ahorro): cruza el CSV de /promociones (que ya trae
// el PVD normal y el PVD de promoción por artículo) con lo que la tienda
// compra de verdad (tabla de la tienda, plantilla de carne, tabla de
// frutas) y saca una estrategia de pedido en chino: qué conviene pedir,
// cuánto se ahorra y qué promociones se acaban ya.

// ---------- CSV ----------

// Parser CSV con comillas (los campos campos_articulo/campos_promocion van
// entrecomillados y llevan JSON dentro).
export function parseCsv(text, separator = ';') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else { field += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === separator) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else { field += ch; }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function parsePromotionsCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  const iPromoCode = idx('codigo_promocion');
  const iPromo = idx('promocion');
  const iHastaPromo = idx('hasta_promocion');
  const iCode = idx('codigo_articulo');
  const iName = idx('descripcion_articulo');
  const iPvd = idx('pvp');
  const iOferta = idx('oferta');
  const iTexto = idx('texto_oferta');
  const iHastaArt = idx('hasta_articulo');
  const out = [];
  for (const r of rows.slice(1)) {
    const code = String(r[iCode] ?? '').trim();
    if (!code) continue;
    out.push({
      promoCode: String(r[iPromoCode] ?? '').trim(),
      promoName: String(r[iPromo] ?? '').trim(),
      code,
      name: String(r[iName] ?? '').trim(),
      pvd: parseEuro(r[iPvd]),
      oferta: parseEuro(r[iOferta]),
      offerText: String(r[iTexto] ?? '').trim(),
      hasta: parseSpanishDate(String(r[iHastaArt] ?? '').trim()) || parseSpanishDate(String(r[iHastaPromo] ?? '').trim())
    });
  }
  return out;
}

export function parseEuro(value) {
  const n = Number.parseFloat(String(value ?? '').replace(/[€\s]/g, '').replace(/\./g, (m, off, s) => (s.includes(',') ? '' : m)).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function parseSpanishDate(value) {
  const m = String(value || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

// ---------- localizar el CSV más reciente ----------

export function findLatestPromotionsCsv(config) {
  const dir = path.resolve(config.__toolRoot || '.', config.promotions?.outputDir || 'promotions');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => /^promociones-productos-activos-.*\.csv$/i.test(f))
    .map((f) => ({ file: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] || null;
}

// ---------- relevancia: lo que la tienda compra ----------

export function buildRelevanceSets({ storeIndex, carneTemplate, config }) {
  const store = new Set();
  for (const row of storeIndex?.rows || []) {
    const c = String(row.codigo_unide || '').replace(/[^\d]/g, '');
    if (c) store.add(c);
  }
  const carne = new Set();
  for (const item of carneTemplate?.items || []) {
    const c = String(item.code || item.codigo || '').replace(/[^\d]/g, '');
    if (c) carne.add(c);
  }
  const fruta = new Set();
  if (config) {
    for (const entry of Object.values(loadFruitMap(config))) {
      const c = String(entry?.codigo || '').replace(/[^\d]/g, '');
      if (c) fruta.add(c);
    }
    try {
      const seed = JSON.parse(fs.readFileSync(path.resolve(config.__toolRoot || '.', 'fruta-codigos-seed.json'), 'utf8'));
      for (const entry of Object.values(seed)) {
        const c = String(entry?.codigo || '').replace(/[^\d]/g, '');
        if (c) fruta.add(c);
      }
    } catch { /* sin seed */ }
  }
  return { store, carne, fruta };
}

// ---------- estrategia ----------

export function buildSavingsAdvice(items, relevance, referenceDate = new Date()) {
  const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const scored = [];
  for (const it of items) {
    if (!Number.isFinite(it.oferta) || it.oferta <= 0) continue;
    const hasPvd = Number.isFinite(it.pvd) && it.pvd > 0;
    const saving = hasPvd ? it.pvd - it.oferta : NaN;
    const pct = hasPvd && it.pvd > 0 ? (saving / it.pvd) * 100 : NaN;
    const daysLeft = it.hasta ? Math.round((it.hasta - today) / 86400000) : null;
    const tags = [];
    if (relevance?.carne?.has(it.code)) tags.push('carne');
    if (relevance?.fruta?.has(it.code)) tags.push('fruta');
    if (relevance?.store?.has(it.code)) tags.push('tienda');
    scored.push({ ...it, saving, pct, daysLeft, tags, relevant: tags.length > 0 });
  }

  const withPct = scored.filter((s) => Number.isFinite(s.pct) && s.pct >= 1 && (s.daysLeft == null || s.daysLeft >= 0));
  const endingSoon = withPct.filter((s) => s.daysLeft != null && s.daysLeft <= 3 && s.pct >= 5)
    .sort((a, b) => (a.daysLeft - b.daysLeft) || (b.pct - a.pct));
  const topSavings = [...withPct].sort((a, b) => b.pct - a.pct);
  const relevantDeals = withPct.filter((s) => s.relevant).sort((a, b) => b.pct - a.pct);

  return { scored, withPct, endingSoon, topSavings, relevantDeals };
}

function fmtPct(p) { return `${p.toFixed(0)}%`; }
function fmtEur(n) { return Number.isFinite(n) ? `${n.toFixed(2).replace('.', ',')}€` : '?'; }
function fmtDays(d) {
  if (d == null) return '';
  if (d <= 0) return '（今天最后一天！）';
  if (d === 1) return '（明天结束）';
  return `（还剩 ${d} 天）`;
}
function tagLabel(tags) {
  const map = { carne: '🥩常订', fruta: '🍎果蔬', tienda: '🏪在售' };
  return tags.map((t) => map[t] || t).join('');
}
function line(s) {
  const rel = s.tags.length ? ` ${tagLabel(s.tags)}` : '';
  return `· ${s.name}（${s.code}）${rel}\n  进价 ${fmtEur(s.pvd)} → ${fmtEur(s.oferta)}，省 ${fmtPct(s.pct)} ${fmtDays(s.daysLeft)}`;
}

// Resumen corto para Telegram + detalle completo para adjuntar.
export function formatAdvice(advice, meta = {}) {
  const lines = [];
  lines.push(`📊 促销省钱策略${meta.csvDate ? `（数据：${meta.csvDate}）` : ''}`);
  lines.push(`促销商品 ${advice.scored.length} 个，其中 ${advice.withPct.length} 个能算出折扣，你店里相关的 ${advice.relevantDeals.length} 个。`);

  if (advice.endingSoon.length) {
    lines.push('', '⏰ 快结束、值得赶末班车的：');
    for (const s of advice.endingSoon.slice(0, 6)) lines.push(line(s));
    if (advice.endingSoon.length > 6) lines.push(`  …还有 ${advice.endingSoon.length - 6} 个，见附件`);
  }

  if (advice.relevantDeals.length) {
    lines.push('', '🛒 你常买/在售的商品正在促销（按力度排）：');
    for (const s of advice.relevantDeals.slice(0, 8)) lines.push(line(s));
    if (advice.relevantDeals.length > 8) lines.push(`  …还有 ${advice.relevantDeals.length - 8} 个，见附件`);
  }

  const rest = advice.topSavings.filter((s) => !s.relevant).slice(0, 5);
  if (rest.length) {
    lines.push('', '💰 全场力度榜（非常购，可考虑试销）：');
    for (const s of rest) lines.push(line(s));
  }

  lines.push('', '👉 建议：周一/周三叫货时优先把上面 🥩🍎🏪 的加进单子；');
  lines.push('“快结束”的想囤就得这一两天下单，过期恢复原价。');
  return lines.join('\n');
}

export function formatAdviceDetail(advice, meta = {}) {
  const lines = [];
  lines.push(`促销省钱明细${meta.csvDate ? `（数据：${meta.csvDate}）` : ''}`);
  lines.push('按折扣力度从大到小，全部能算出折扣的商品：');
  lines.push('');
  for (const s of advice.topSavings) {
    const rel = s.tags.length ? ` [${s.tags.join(',')}]` : '';
    const until = s.hasta ? ` hasta ${s.hasta.getDate()}/${s.hasta.getMonth() + 1}` : '';
    lines.push(`${fmtPct(s.pct).padStart(4)}  ${s.code}  ${s.name}${rel}  ${fmtEur(s.pvd)}→${fmtEur(s.oferta)}${until}  [${s.promoCode} ${s.promoName}]`);
  }
  return lines.join('\n');
}
