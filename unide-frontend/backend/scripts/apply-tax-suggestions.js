// =====================================================================
// Aplicación por lotes de sugerencias de IVA (one-off, pre-lanzamiento)
// =====================================================================
// Lee public/tax-suggestions/product-tax-suggestions.json y clasifica
// cada producto en niveles de seguridad:
//
//   Tier A — precio POS == precio web (±0,005 €) Y todos los candidatos
//            POS coinciden en el IVA  → aplicar y marcar 'reviewed'.
//            (Mismo producto con certeza y tipo sin ambigüedad.)
//   Tier B — todos los candidatos coinciden en IVA pero el precio NO
//            cuadra → aplicar el tipo y marcar 'needs_review'.
//            (Aunque el match fuese el producto equivocado, todos los
//            similares llevan el mismo tipo; revisar de un vistazo.)
//   Tier C — candidatos con IVAs distintos o sin sugerencia → NO tocar
//            (se queda 'pending' para revisión manual en el Admin).
//
// Además ejecuta un escaneo de "banderas rojas": sugerencias que
// contradicen heurísticas claras por nombre (refrescos azucarados o
// alcohol a tipo distinto de 21, fruta/verdura/leche/pan a tipo
// distinto de 4, pañales a tipo reducido, etc.). Las banderas rojas se
// EXCLUYEN de la aplicación automática y se listan para decisión humana.
//
// Uso (desde /backend, necesita .env con SUPABASE_URL y SUPABASE_SERVICE_KEY):
//   node scripts/apply-tax-suggestions.js            ← dry-run (no escribe)
//   node scripts/apply-tax-suggestions.js --apply    ← escribe en Supabase
//
// Solo actualiza productos cuyo tax_review_status actual sea 'pending' o
// '' (nunca pisa una revisión manual ya hecha).
// =====================================================================

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const APPLY = process.argv.includes('--apply');

const SUGGESTIONS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'public', 'tax-suggestions', 'product-tax-suggestions.json'
);

// --- Heurísticas de bandera roja (nombre → tipo esperado) ---
// Si el nombre del producto matchea y la sugerencia difiere del tipo
// esperado, se marca para revisión humana en lugar de aplicarse.
const RED_FLAG_RULES = [
  // Bebidas azucaradas/edulcoradas y alcohol: SIEMPRE 21 desde 2021.
  { re: /\b(coca[- ]?cola|pepsi|fanta|sprite|seven ?up|7up|aquarius|monster|red ?bull|energ(y|ética)|refresco|tónica|tonica|kas\b)/i, expect: 21, why: 'refresco azucarado/edulcorado → 21%' },
  { re: /\b(cerveza|vino|ron|whisky|whiskey|vodka|ginebra|gin\b|licor|brandy|coñac|cognac|tequila|cava|champagne|champán|sangr[ií]a|vermut|vermouth|anís|orujo)\b/i, expect: 21, why: 'bebida alcohólica → 21%' },
  // Higiene/limpieza/cosmética: 21 (error común dejarlas a 10).
  { re: /\b(detergente|lej[ií]a|suavizante|champ[uú]|gel de ducha|desodorante|pasta de dientes|dent[ií]frico|crema facial|maquillaje|colonia|perfume)\b/i, expect: 21, why: 'limpieza/higiene/cosmética → 21%' },
  { re: /\b(pañal|panal|toallitas)\b/i, expect: 21, why: 'pañales/toallitas → 21% (no reducido)' },
  // Básicos a 4 (superreducido).
  { re: /\b(leche (entera|semi|desnatada)|huevos?\b|pan com[uú]n|harina)\b/i, expect: 4, why: 'alimento básico → 4%' },
];

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const parseCandidateIva = (s) => {
  const m = /IVA\s+(\d+)/.exec(String(s || ''));
  return m ? Number(m[1]) : null;
};

function classify(item) {
  const rate = toNum(item.suggested_tax_rate);
  if (rate === null) return { tier: 'C', reason: 'sin sugerencia' };

  const ivas = [rate];
  const i2 = parseCandidateIva(item.candidate_2);
  const i3 = parseCandidateIva(item.candidate_3);
  if (i2 !== null) ivas.push(i2);
  if (i3 !== null) ivas.push(i3);

  const allAgree = ivas.length >= 2 && new Set(ivas).size === 1;
  const posPvp = toNum(item.matched_pvp);
  const webPrice = toNum(item.online_price);
  const priceExact = posPvp !== null && webPrice !== null && Math.abs(posPvp - webPrice) < 0.005;

  // Bandera roja: heurística por nombre contradice la sugerencia.
  for (const rule of RED_FLAG_RULES) {
    if (rule.re.test(String(item.online_name || '')) && rate !== rule.expect) {
      return { tier: 'FLAG', reason: `${rule.why} pero sugerido ${rate}%` };
    }
  }

  if (allAgree && priceExact) return { tier: 'A', rate };
  if (allAgree) return { tier: 'B', rate };
  return { tier: 'C', reason: 'candidatos con IVA distinto o match único sin refuerzo' };
}

async function main() {
  const raw = await readFile(SUGGESTIONS_PATH, 'utf8');
  const suggestions = JSON.parse(raw);
  console.log(`Sugerencias cargadas: ${suggestions.length}`);
  console.log(`Modo: ${APPLY ? '*** APPLY (escribe en Supabase) ***' : 'dry-run (no escribe nada)'}\n`);

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Estado actual de los productos: nunca pisar revisiones manuales.
  // ⚠️ .range explícito: Supabase corta a 1000 filas por defecto y el
  // catálogo ya supera esa cifra; sin esto algunos productos quedarían
  // fuera de la clasificación silenciosamente.
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, tax_rate, tax_review_status')
    .range(0, 9999);
  if (error) throw new Error('No se pudieron leer products: ' + error.message);
  const productById = new Map(products.map((p) => [String(p.id), p]));

  const tiers = { A: [], B: [], C: [], FLAG: [] };
  const skipped = { notFound: [], alreadyReviewed: [] };

  for (const item of suggestions) {
    const id = String(item.online_id ?? '');
    const product = productById.get(id);
    if (!product) { skipped.notFound.push(item); continue; }
    const status = String(product.tax_review_status || '').toLowerCase();
    if (status && status !== 'pending') { skipped.alreadyReviewed.push(item); continue; }

    const cls = classify(item);
    tiers[cls.tier].push({ item, product, cls });
  }

  console.log(`Tier A (aplicar + reviewed):      ${tiers.A.length}`);
  console.log(`Tier B (aplicar + needs_review):  ${tiers.B.length}`);
  console.log(`Tier C (no tocar, manual):        ${tiers.C.length}`);
  console.log(`Banderas rojas (no tocar):        ${tiers.FLAG.length}`);
  console.log(`Saltados — sin producto en BD:    ${skipped.notFound.length}`);
  console.log(`Saltados — ya revisados a mano:   ${skipped.alreadyReviewed.length}\n`);

  if (tiers.FLAG.length) {
    console.log('=== BANDERAS ROJAS (revisar a mano) ===');
    for (const { item, cls } of tiers.FLAG) {
      console.log(`  #${item.online_id} ${item.online_name} → ${cls.reason}`);
    }
    console.log('');
  }

  if (!APPLY) {
    console.log('--- Muestra Tier A (primeros 15) ---');
    for (const { item, cls } of tiers.A.slice(0, 15)) {
      console.log(`  #${item.online_id} ${item.online_name} → IVA ${cls.rate}%`);
    }
    console.log('\n--- Muestra Tier B (primeros 15) ---');
    for (const { item, cls } of tiers.B.slice(0, 15)) {
      console.log(`  #${item.online_id} ${item.online_name} → IVA ${cls.rate}% (needs_review)`);
    }
    console.log('\nDry-run terminado. Ejecuta con --apply para escribir.');
    return;
  }

  // --- Escritura ---
  let ok = 0, failed = 0;
  const applyTier = async (list, reviewStatus, noteSuffix) => {
    for (const { item, cls } of list) {
      const { error: upErr } = await supabase
        .from('products')
        .update({
          tax_rate: cls.rate,
          tax_category: item.suggested_tax_category || 'pos_match',
          tax_review_status: reviewStatus,
          tax_note: `bulk ${new Date().toISOString().slice(0, 10)}: ${item.tax_source || 'pos'} ${noteSuffix}`,
        })
        .eq('id', item.online_id);
      if (upErr) {
        failed++;
        console.error(`  ✗ #${item.online_id} ${item.online_name}: ${upErr.message}`);
      } else {
        ok++;
      }
    }
  };

  console.log('Aplicando Tier A…');
  await applyTier(tiers.A, 'reviewed', '(precio exacto + candidatos coinciden)');
  console.log('Aplicando Tier B…');
  await applyTier(tiers.B, 'needs_review', '(candidatos coinciden, precio sin confirmar)');

  console.log(`\nHecho: ${ok} actualizados, ${failed} errores.`);
  console.log('Tier C y banderas rojas quedan en pending para revisión manual en el Admin.');
}

main().catch((e) => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
