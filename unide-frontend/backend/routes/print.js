// =====================================================================
// Impresión automática de tickets (agente de la tienda)
// =====================================================================
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { authenticatePrintAgent } from '../middleware/auth.js';

const router = Router();

// Campos que el ticket necesita. Devolvemos solo lo imprescindible para
// el ticket (no el email del cliente, etc.). stripe_payment_intent +
// payment_method + status permiten al agente decidir la etiqueta de
// "estado de pago" (PAGADO vs COBRAR AL ENTREGAR).
const PRINT_ORDER_FIELDS =
  'id, created_at, confirmed_at, delivery_method, items, total, address, phone, note, payment_method, status, stripe_payment_intent, coupon_code, discount, invoice_full_number, invoice_issued_at, tax_breakdown, verifactu_qr';

// GET /api/print/pending — cola de impresión.
// Devuelve pedidos confirmados (confirmed_at no nulo) y aún no impresos
// (printed_at nulo), del más antiguo al más nuevo (se imprimen en orden
// de llegada). El agente los procesa uno a uno y luego llama a
// /api/print/mark por cada uno.
router.get('/api/print/pending', authenticatePrintAgent, async (req, res) => {
  try {
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 50 ? limitRaw : 10;
    const { data, error } = await supabase
      .from('orders')
      .select(PRINT_ORDER_FIELDS)
      .not('confirmed_at', 'is', null)
      .is('printed_at', null)
      .order('confirmed_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    res.json({ orders: data || [], count: (data || []).length });
  } catch (error) {
    console.error('[print] pending error:', error?.message || error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/print/mark — marca un pedido como impreso.
// Idempotente: solo escribe printed_at si aún es nulo (evita pisar la
// marca si llegan dos confirmaciones). Body: { order_id }.
router.post('/api/print/mark', authenticatePrintAgent, async (req, res) => {
  try {
    const orderId = req.body?.order_id;
    if (!orderId) return res.status(400).json({ error: 'Falta order_id.' });
    const { data, error } = await supabase
      .from('orders')
      .update({ printed_at: new Date().toISOString() })
      .eq('id', orderId)
      .is('printed_at', null)
      .select('id, printed_at');
    if (error) throw error;
    // data vacío = ya estaba marcado (otro intento). Lo tratamos como OK
    // idempotente para que el agente no reintente en bucle.
    res.json({ ok: true, already_printed: (data || []).length === 0 });
  } catch (error) {
    console.error('[print] mark error:', error?.message || error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
