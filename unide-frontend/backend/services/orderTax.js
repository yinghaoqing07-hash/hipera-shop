// =====================================================================
// snapshotItemTaxRates — congela el tipo de IVA de cada producto en el
// momento de la venta.
// =====================================================================
// VeriFactu exige que la factura refleje el IVA vigente CUANDO se vendió,
// no el actual. Si mañana se reclasifica un producto en el panel (p. ej.
// de 21% a 10%), las facturas ya emitidas —con hash encadenado inmutable—
// deben poder reconstruirse con el IVA correcto. Por eso copiamos
// products.tax_rate dentro de cada línea del pedido en el instante de la
// compra; el desglose de IVA (tax_breakdown) de la fase de facturación se
// calculará a partir de este valor congelado, nunca releyendo el catálogo.
//
// Fuente AUTORITATIVA = tabla products (servidor). Ignoramos cualquier
// tax_rate que viniera en el body del cliente (no es de fiar para algo
// fiscal). Los servicios (sin id en products) se dejan intactos: su IVA se
// resolverá aparte en facturación. Si un producto se borra tras la compra
// se deja como estaba (no podemos inventar su IVA).
//
// Tolerante a fallos: si la lectura del catálogo falla devolvemos los
// items sin tocar en vez de bloquear la venta. Es preferible un pedido sin
// IVA congelado (la facturación lo marcará para revisión) a un cliente que
// no puede comprar por un glitch de Supabase.
import { supabase } from '../lib/supabase.js';

export async function snapshotItemTaxRates(items) {
  if (!Array.isArray(items) || items.length === 0) return items;

  const ids = [...new Set(
    items
      .filter((it) => it && it.id && !it.isService)
      .map((it) => it.id)
  )];
  if (ids.length === 0) return items;

  const { data, error } = await supabase
    .from('products')
    .select('id, tax_rate')
    .in('id', ids);
  if (error) {
    console.error('[tax] snapshot de IVA falló (pedido se guarda sin congelar):', error.message);
    return items;
  }

  const rateById = new Map((data || []).map((p) => [p.id, p.tax_rate]));
  return items.map((it) => {
    if (!it || !it.id || it.isService || !rateById.has(it.id)) return it;
    return { ...it, tax_rate: rateById.get(it.id) };
  });
}

export function hasValidItemTaxRate(item) {
  return [4, 10, 21].includes(Number(item?.tax_rate));
}

export function shouldBackfillOrderTaxRates(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.some((it) => {
    if (!it || it.isGift || it.isService) return false;
    const price = Number(it.price);
    const qty = Number(it.quantity) || 0;
    return Number.isFinite(price) && price > 0 && qty > 0 && !hasValidItemTaxRate(it);
  });
}

// Rellena el IVA congelado de un pedido antiguo justo antes de facturar
// (backfill) y lo persiste. Usado como hook prepareOrderForInvoice por
// los servicios de facturación (fiskaly / local).
export async function prepareOrderForInvoice(order) {
  if (!shouldBackfillOrderTaxRates(order)) return order;

  const items = Array.isArray(order.items) ? order.items : [];
  const hydratedItems = await snapshotItemTaxRates(items);
  const changed = JSON.stringify(hydratedItems) !== JSON.stringify(items);
  if (!changed) return order;

  const { data, error } = await supabase
    .from('orders')
    .update({ items: hydratedItems })
    .eq('id', order.id)
    .select('*')
    .single();
  if (error) {
    throw new Error(`[tax] no se pudo guardar IVA congelado antes de facturar: ${error.message}`);
  }

  console.log(`[tax] IVA de pedido antiguo completado antes de facturar: ${String(order.id).slice(0, 8)}`);
  return data || { ...order, items: hydratedItems };
}
