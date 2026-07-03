// =====================================================================
// Detección de bebidas alcohólicas en el carrito (restricción +18)
// =====================================================================
// Base legal: Ley 5/2002 de la Comunidad de Madrid (prohibida la venta
// de alcohol a menores de 18 años, también a distancia) y T&C §2.2.
// El checkout exige una declaración de mayoría de edad cuando el
// carrito contiene alcohol; el backend replica esta comprobación de
// forma autoritativa (backend/services/alcohol.js) consultando el
// catálogo real, así que este helper es solo la capa de UX.
//
// Detección por NOMBRE de la categoría / subcategoría del producto
// (los ids de categoría son datos libres del panel, no hay flag
// dedicado). Mantener la regex sincronizada con la del backend.
import { normalizeText } from './shipping';

// Sobre texto normalizado (sin acentos, minúsculas). Palabras enteras
// donde hay riesgo de falso positivo (p. ej. "ron" dentro de "macarrones",
// "vino" está seguro: "vinagre" normaliza a "vinagre", no contiene "vino").
const ALCOHOL_NAME_REGEX =
  /alcohol|cervez|vino|licor|whisky|vodka|ginebra|tequila|brandy|vermut|cava|champan|sangria|\bron\b/;

export function isAlcoholCategoryName(name) {
  return ALCOHOL_NAME_REGEX.test(normalizeText(name));
}

/**
 * ¿Contiene el carrito algún producto de categoría alcohólica?
 * Los regalos también cuentan: regalar alcohol a un menor sigue
 * siendo venta restringida.
 *
 * @param {Array} items       items del carrito (con category / subCategoryId)
 * @param {Array} categories  categorías cargadas ({ id, name })
 * @param {Array} subCategories subcategorías cargadas ({ id, name })
 */
export function cartContainsAlcohol(items, categories, subCategories) {
  if (!Array.isArray(items) || items.length === 0) return false;
  const catNameById = new Map((categories || []).map((c) => [c.id, c.name]));
  const subNameById = new Map((subCategories || []).map((s) => [s.id, s.name]));
  return items.some((it) => {
    if (!it || it.isService) return false;
    const catName = catNameById.get(it.category) || '';
    const subName = subNameById.get(it.subCategoryId ?? it.sub_category_id) || '';
    return isAlcoholCategoryName(catName) || isAlcoholCategoryName(subName);
  });
}
