// =====================================================================
// Detección AUTORITATIVA de alcohol en un pedido (restricción +18)
// =====================================================================
// Base legal: Ley 5/2002 de la Comunidad de Madrid (prohibida la venta
// de alcohol a menores de 18 años, también en venta a distancia) y
// T&C §2.2. POST /api/orders y /api/checkout/stripe-session exigen
// `age_confirmed: true` cuando el pedido contiene alcohol.
//
// No se confía en los campos del carrito que manda el cliente: se
// consulta el catálogo real (products → categories/sub_categories) por
// los ids de los items. Señales, en orden:
//   1) products.tax_category === 'alcohol' (clasificación fiscal manual)
//   2) nombre de la categoría / subcategoría que case con la regex
// Mantener la regex sincronizada con src/utils/alcohol.js (frontend).
//
// Tolerante a fallos: si el catálogo no responde devolvemos false con
// un warn (fail-open). El checkbox del frontend sigue aplicando y una
// caída de Supabase no debe bloquear TODA la tienda; este check es la
// red del backend, no el único control.
import { supabase } from '../lib/supabase.js';

const normalize = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const ALCOHOL_NAME_REGEX =
  /alcohol|cervez|vino|licor|whisky|vodka|ginebra|tequila|brandy|vermut|cava|champan|sangria|\bron\b/;

export function isAlcoholCategoryName(name) {
  return ALCOHOL_NAME_REGEX.test(normalize(name));
}

export async function orderContainsAlcohol(items) {
  const ids = [...new Set(
    (items || [])
      .filter((it) => it && it.id && !it.isService)
      .map((it) => it.id)
  )];
  if (ids.length === 0) return false;

  try {
    const { data: prods, error } = await supabase
      .from('products')
      .select('id, category, sub_category_id, tax_category')
      .in('id', ids);
    if (error) throw error;
    if (!prods || prods.length === 0) return false;

    if (prods.some((p) => p.tax_category === 'alcohol')) return true;

    const catIds = [...new Set(prods.map((p) => p.category).filter((v) => v != null))];
    const subIds = [...new Set(prods.map((p) => p.sub_category_id).filter((v) => v != null))];

    if (catIds.length > 0) {
      const { data: cats, error: cErr } = await supabase
        .from('categories')
        .select('id, name')
        .in('id', catIds);
      if (cErr) throw cErr;
      if ((cats || []).some((c) => isAlcoholCategoryName(c.name))) return true;
    }

    if (subIds.length > 0) {
      const { data: subs, error: sErr } = await supabase
        .from('sub_categories')
        .select('id, name')
        .in('id', subIds);
      if (sErr) throw sErr;
      if ((subs || []).some((s) => isAlcoholCategoryName(s.name))) return true;
    }

    return false;
  } catch (e) {
    console.warn('[alcohol] detección falló (fail-open, sigue el checkbox del frontend):', e?.message || e);
    return false;
  }
}
