// =====================================================================
// Stock — ajustes atómicos de inventario
// =====================================================================
import { supabase } from '../lib/supabase.js';

// adjustStockCas — ajuste de stock ATÓMICO por compare-and-swap.
// ---------------------------------------------------------------------
// Sin migración de BD: lee el stock actual y aplica el UPDATE SÓLO si el
// valor no ha cambiado (`.eq('stock', actual)`). Si otra operación lo
// modificó entre el SELECT y el UPDATE, éste afecta 0 filas y se
// reintenta con el valor fresco. Esto elimina los "lost updates" y, por
// tanto, la SOBREVENTA por pedidos/webhooks concurrentes (que con el
// patrón leer-luego-escribir anterior sí podía ocurrir).
//   delta < 0 → descuento (rechaza si dejaría el stock negativo, salvo allowNegative)
//   delta > 0 → reposición
// Devuelve { ok, stock, reason }.
export async function adjustStockCas(productId, delta, { allowNegative = false } = {}) {
  const MAX_ATTEMPTS = 6;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data: product, error: fetchErr } = await supabase
      .from('products')
      .select('stock')
      .eq('id', productId)
      .single();
    if (fetchErr || !product) return { ok: false, reason: 'NOT_FOUND' };

    const current = Number(product.stock) || 0;
    const next = current + delta;
    if (!allowNegative && next < 0) {
      return { ok: false, reason: 'INSUFFICIENT', stock: current };
    }

    const payload = { stock: next };
    if (next <= 0) payload.visible = false;
    else if (delta > 0) payload.visible = true; // reposición → vuelve a ser visible

    const { data: updated, error: uErr } = await supabase
      .from('products')
      .update(payload)
      .eq('id', productId)
      .eq('stock', current) // CAS: sólo si nadie cambió el stock entre medias
      .select('stock');
    if (uErr) return { ok: false, reason: 'DB_ERROR', error: uErr.message };
    if (updated && updated.length === 1) return { ok: true, stock: next };
    // 0 filas → el stock cambió (carrera) → reintentar con el valor fresco
  }
  return { ok: false, reason: 'CONFLICT' };
}

// =====================================================================
// deductStockForItems — descuento de stock reutilizable
// =====================================================================
// Extraído para que el flujo de Stripe (webhook, tras confirmar pago)
// pueda descontar stock con la misma lógica que POST /api/orders, pero
// SIN abortar con 400 (el cliente ya pagó: si falta stock, lo
// registramos para revisión manual en vez de rechazar). Devuelve la
// lista de incidencias para que el llamador decida qué hacer.
//
// Nota: POST /api/orders mantiene su propio bucle inline (comportamiento
// histórico: aborta con 400 si falta stock ANTES de cobrar). No lo
// tocamos para no alterar ese flujo ya probado.
export async function deductStockForItems(items) {
  const issues = [];
  for (const item of items || []) {
    if (item?.isService || item?.isGift) continue;
    const qty = Number(item?.quantity) || 0;
    if (qty <= 0) continue;

    const r = await adjustStockCas(item.id, -qty, { allowNegative: false });
    if (r.reason === 'NOT_FOUND') {
      console.warn(`[stock] producto no encontrado: id=${item.id}, name=${item.name}`);
      continue;
    }
    if (!r.ok) {
      issues.push({ id: item.id, name: item.name, stock: r.stock ?? null, requested: qty, reason: r.reason });
    }
  }
  return { issues };
}

// =====================================================================
// restockItems — reposición de stock (inverso de deductStockForItems)
// =====================================================================
// Usado al cancelar/reembolsar un pedido: devuelve las unidades de cada
// artículo al inventario. Best-effort y tolerante: ignora
// servicios/regalos y productos que ya no existan. Como el stock queda
// > 0, el producto se vuelve a marcar visible (mismo criterio que el
// restock manual del panel de administración).
export async function restockItems(items) {
  for (const item of items || []) {
    if (item?.isService || item?.isGift) continue;
    const qty = Number(item?.quantity) || 0;
    if (qty <= 0) continue;

    const r = await adjustStockCas(item.id, qty, { allowNegative: true });
    if (r.reason === 'NOT_FOUND') {
      console.warn(`[stock] restock: producto no encontrado: id=${item.id}, name=${item.name}`);
    } else if (!r.ok) {
      console.error(`[stock] restock falló id=${item.id}: ${r.reason}`);
    }
  }
}
