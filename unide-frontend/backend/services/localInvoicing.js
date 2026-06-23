// =====================================================================
// Facturacion local — primera version de factura simplificada
// =====================================================================
// Esta capa emite una factura simplificada SIN proveedor VeriFactu.
// Sirve para la fase previa a la conexion con fiskaly:
//   - asigna serie/numero correlativo en BD;
//   - calcula y guarda el desglose de IVA;
//   - deja el pedido preparado para PDF/ticket fiscal.
//
// Importante: NO marca verifactu_status='issued'. Ese campo queda
// reservado para cuando un proveedor VeriFactu fiscalice la factura.
// =====================================================================

import { nextInvoiceNumber, formatInvoiceNumber } from './invoicing.js';
import { buildInvoiceContent, isInvoiceValidationError } from './fiskaly.js';

const LOCAL_PENDING_MARK = '__LOCAL_INVOICE_PENDING__';

export function isLocalInvoicingEnabled() {
  return process.env.LOCAL_INVOICING_ENABLED !== 'false';
}

function seriesPrefix() {
  const raw = (
    process.env.LOCAL_INVOICE_SERIES_PREFIX ||
    process.env.FISKALY_SERIES_PREFIX ||
    'WEB'
  ).toUpperCase();
  return raw.replace(/[^0-9A-Z_/\-.]/g, '').slice(0, 10) || 'WEB';
}

function isPaidEnoughToInvoice(order) {
  const status = String(order?.status || '');
  const method = String(order?.payment_method || '');
  if (['Cancelado', 'Esperando pago', 'Autorizado', 'Pendiente de Pago'].includes(status)) {
    return false;
  }
  if (/contra\s*reembolso/i.test(method) && status !== 'Entregado') {
    return false;
  }
  return true;
}

async function fetchOrder(supabase, orderId) {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();
  if (error || !data) {
    throw new Error(`pedido no encontrado: ${orderId} ${error?.message || ''}`);
  }
  return data;
}

export function createLocalInvoiceService({ supabase, reportError = () => {} }) {
  async function issueInvoiceForOrder(orderId) {
    if (!isLocalInvoicingEnabled()) return { ok: false, skipped: 'local_disabled' };

    const order = await fetchOrder(supabase, orderId);
    if (order.invoice_full_number && order.invoice_number) {
      return { ok: true, already: true, provider: 'local', order };
    }
    if (!isPaidEnoughToInvoice(order)) {
      return { ok: false, skipped: 'not_paid_yet' };
    }
    if (!(Number(order.total) > 0)) {
      return { ok: false, skipped: 'total_cero' };
    }

    let claimed = false;
    try {
      // Validate first, before touching the invoice counter. Missing VAT
      // must not consume a fiscal number.
      const preview = buildInvoiceContent(order, {
        series: 'CHECK',
        number: '0',
        strictTaxRates: true,
      });

      // Claim the order before requesting the next fiscal number. This
      // avoids two concurrent triggers consuming two numbers for the same
      // order. The temporary mark is not considered a valid invoice
      // because invoice_issued_at remains empty.
      const { data: claimRows, error: claimErr } = await supabase
        .from('orders')
        .update({ invoice_full_number: LOCAL_PENDING_MARK })
        .eq('id', orderId)
        .is('invoice_number', null)
        .is('invoice_full_number', null)
        .select('id, invoice_full_number')
        .limit(1);
      if (claimErr) throw claimErr;
      if (!claimRows || claimRows.length === 0) {
        const latest = await fetchOrder(supabase, orderId);
        if (latest.invoice_full_number && latest.invoice_number) {
          return { ok: true, already: true, provider: 'local', order: latest };
        }
        return { ok: false, skipped: 'claimed_elsewhere' };
      }
      claimed = true;

      const year = new Date().getFullYear();
      const assigned = await nextInvoiceNumber(supabase, { series: seriesPrefix(), year });
      const fullNumber = formatInvoiceNumber(assigned.series, year, assigned.number);
      const breakdown = preview.breakdown;

      const issuedAt = new Date().toISOString();
      const taxBreakdown = {
        rates: breakdown,
        registration: 'LOCAL_SIMPLIFIED',
        provider: 'local',
        verifactu: false,
      };

      const { data: updated, error } = await supabase
        .from('orders')
        .update({
          invoice_series: assigned.series,
          invoice_number: assigned.number,
          invoice_full_number: fullNumber,
          invoice_issued_at: issuedAt,
          tax_breakdown: taxBreakdown,
        })
        .eq('id', orderId)
        .eq('invoice_full_number', LOCAL_PENDING_MARK)
        .select('*')
        .single();

      if (error) {
        // PGRST116 = 0 rows returned. Otra ejecucion pudo asignar la
        // factura entre nuestro SELECT y UPDATE; lo tratamos como
        // idempotencia, no como fallo fiscal.
        if (error.code === 'PGRST116') {
          const latest = await fetchOrder(supabase, orderId);
          if (latest.invoice_full_number && latest.invoice_number) {
            return { ok: true, already: true, provider: 'local', order: latest };
          }
        }
        throw error;
      }

      console.log(`[invoice-local] factura simplificada emitida: pedido ${String(orderId).slice(0, 8)} -> ${fullNumber}`);
      return {
        ok: true,
        provider: 'local',
        series: assigned.series,
        number: assigned.number,
        fullNumber,
        order: updated,
      };
    } catch (e) {
      if (claimed) {
        await supabase
          .from('orders')
          .update({ invoice_full_number: null })
          .eq('id', orderId)
          .eq('invoice_full_number', LOCAL_PENDING_MARK)
          .is('invoice_number', null)
          .then(() => {}, () => {});
      }
      if (isInvoiceValidationError(e)) {
        console.warn(`[invoice-local] factura no emitida por datos incompletos: ${e.message}`);
        return {
          ok: false,
          status: e.status || 422,
          code: e.code || 'INVOICE_VALIDATION_ERROR',
          error: e?.message || String(e),
          details: e.details || {},
        };
      }
      reportError(e, `[invoice-local] emision fallida para pedido ${orderId}`);
      return { ok: false, error: e?.message || String(e) };
    }
  }

  return { issueInvoiceForOrder };
}
