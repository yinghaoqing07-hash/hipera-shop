// =====================================================================
// Facturación electrónica — groundwork para VeriFactu (fiskaly)
// =====================================================================
// Este módulo NO emite facturas todavía. Prepara las piezas que el
// proveedor certificado (fiskaly, SIGN ES / VeriFactu) necesitará:
//
//   1) computeTaxBreakdown(...)  → desglose de IVA del pedido (base +
//      cuota por tipo), a partir de precios CON IVA INCLUIDO (PVP de
//      retail español). Función PURA, sin BD, fácil de testear.
//   2) nextInvoiceNumber(...)    → número correlativo y sin saltos,
//      delega en la función SQL next_invoice_number (atómica).
//   3) buildVerifactuPayload(...) → normaliza los datos del pedido al
//      formato que enviaremos al proveedor. Sirve también para detectar
//      qué datos faltan ANTES de contratar la API.
//   4) issueInvoiceWithProvider(...) → STUB. Lanza error hasta que se
//      integre fiskaly. Mantiene aislado todo lo específico del proveedor.
//
// Marco legal: RD 1007/2023 y Orden HAC/1177/2024 (VeriFactu). El IVA en
// España aplica tipos 4 % (superreducido), 10 % (reducido) y 21 %
// (general). Ver supabase_migration_orders_invoicing.sql y
// docs/VERIFACTU_READINESS.md.
// =====================================================================

// Datos fiscales del emisor. Se definen aquí (no se importan de
// src/config/company.js) porque el backend se despliega de forma
// independiente del frontend (Railway) y no incluye la carpeta src/.
// ⚠️ Mantener SINCRONIZADO con src/config/company.js (misma fuente: el
// titular). El ticket de server.js ya replica estos datos por el mismo motivo.
export const COMPANY = {
  name: 'QIANG GUO, S.L.',
  nif: 'B86126638',
  address: 'Paseo del Sol nº 1, 28880 Meco (Madrid), España',
};

// Tipos de IVA admitidos en España (coherente con el CHECK de products.tax_rate).
export const IVA_RATES = [4, 10, 21];

// Tipo de IVA por defecto que se asume para los gastos de envío mientras
// no se confirme con la gestoría. El envío de un pedido sigue, por regla
// general, el criterio de "gasto accesorio" y suele tributar al tipo
// general (21 %); en cestas con varios tipos el criterio puede variar.
// ⚠️ CONFIRMAR CON GESTORÍA (ver readiness §preguntas).
export const DEFAULT_SHIPPING_TAX_RATE = 21;

const toCents = (n) => Math.round((Number(n) || 0) * 100);
const fromCents = (c) => Math.round(c) / 100;

/**
 * Desglose de IVA de un pedido a partir de precios CON IVA INCLUIDO.
 *
 * @param {object} order
 * @param {Array}  order.items     cada item: { price, quantity, tax_rate, isGift }
 *                                 price = PVP unitario con IVA incluido.
 *                                 tax_rate = 4 | 10 | 21 | null (sin clasificar).
 * @param {number} [order.discount=0]  descuento total aplicado (€, con IVA incl.)
 * @param {number} [order.shipping=0]  gastos de envío (€, con IVA incl.)
 * @param {object} [opts]
 * @param {number} [opts.shippingTaxRate=DEFAULT_SHIPPING_TAX_RATE]
 *
 * @returns {{
 *   breakdown: Array<{rate:number, base:number, cuota:number, total:number}>,
 *   totals: {base:number, cuota:number, total:number},
 *   hasUnclassified: boolean,
 *   unclassifiedTotal: number
 * }}
 *
 * Reconciliación: la suma de (base + cuota) de todas las líneas (incluido
 * envío y descontado el descuento prorrateado) es igual al total cobrado.
 */
export function computeTaxBreakdown(order, opts = {}) {
  const shippingTaxRate = opts.shippingTaxRate ?? DEFAULT_SHIPPING_TAX_RATE;
  const items = Array.isArray(order?.items) ? order.items : [];

  // 1) Agrupar el importe (con IVA incl.) por tipo de IVA. Los regalos y
  //    las líneas inválidas no facturan. Las líneas sin tax_rate válido se
  //    acumulan en un bucket "sin clasificar".
  const inclByRate = new Map(); // rate(number) -> céntimos
  let unclassifiedCents = 0;

  for (const it of items) {
    if (it?.isGift) continue;
    const price = Number(it?.price);
    const qty = Number(it?.quantity) || 0;
    if (!Number.isFinite(price) || price <= 0 || qty <= 0) continue;

    const lineCents = toCents(price) * qty;
    const rate = Number(it?.tax_rate);
    if (IVA_RATES.includes(rate)) {
      inclByRate.set(rate, (inclByRate.get(rate) || 0) + lineCents);
    } else {
      unclassifiedCents += lineCents;
    }
  }

  // 2) Prorratear el descuento proporcionalmente sobre el importe de cada
  //    tipo (el descuento de un cupón reduce base y cuota a la vez).
  const subtotalCents = [...inclByRate.values()].reduce((a, b) => a + b, 0) + unclassifiedCents;
  const discountCents = Math.min(toCents(order?.discount), subtotalCents);

  if (discountCents > 0 && subtotalCents > 0) {
    const netTarget = subtotalCents - discountCents;
    // Repartir netTarget proporcionalmente; el remanente por redondeo se
    // asigna al tipo con mayor importe para que la suma cuadre al céntimo.
    const entries = [...inclByRate.entries()];
    let assigned = 0;
    let maxIdx = -1, maxVal = -1;
    entries.forEach(([rate, cents], i) => {
      const net = Math.round((cents * netTarget) / subtotalCents);
      inclByRate.set(rate, net);
      assigned += net;
      if (cents > maxVal) { maxVal = cents; maxIdx = i; }
    });
    // El bucket sin clasificar también se reduce proporcionalmente.
    const netUnclassified = Math.round((unclassifiedCents * netTarget) / subtotalCents);
    assigned += netUnclassified;
    unclassifiedCents = netUnclassified;
    // Ajuste de cuadre (remanente) sobre el tipo de mayor importe.
    const remainder = netTarget - assigned;
    if (remainder !== 0 && maxIdx >= 0) {
      const [rate] = entries[maxIdx];
      inclByRate.set(rate, (inclByRate.get(rate) || 0) + remainder);
    } else if (remainder !== 0) {
      unclassifiedCents += remainder;
    }
  }

  // 3) Añadir el envío como una línea más, a su propio tipo.
  const shippingCents = toCents(order?.shipping);
  if (shippingCents > 0) {
    if (IVA_RATES.includes(Number(shippingTaxRate))) {
      const r = Number(shippingTaxRate);
      inclByRate.set(r, (inclByRate.get(r) || 0) + shippingCents);
    } else {
      unclassifiedCents += shippingCents;
    }
  }

  // 4) Calcular base imponible y cuota por tipo. Precio CON IVA incluido:
  //    base = incl * 100 / (100 + rate);  cuota = incl - base.
  const breakdown = [];
  let totalBaseCents = 0, totalCuotaCents = 0, totalCents = 0;

  for (const rate of IVA_RATES) {
    const inclCents = inclByRate.get(rate) || 0;
    if (inclCents <= 0) continue;
    const baseCents = Math.round((inclCents * 100) / (100 + rate));
    const cuotaCents = inclCents - baseCents;
    breakdown.push({
      rate,
      base: fromCents(baseCents),
      cuota: fromCents(cuotaCents),
      total: fromCents(inclCents),
    });
    totalBaseCents += baseCents;
    totalCuotaCents += cuotaCents;
    totalCents += inclCents;
  }

  // El importe sin clasificar se suma al total para que el documento cuadre,
  // pero NO se reparte en base/cuota: hasUnclassified avisa de que faltan
  // tipos de IVA por asignar a algún producto.
  totalCents += unclassifiedCents;

  return {
    breakdown,
    totals: {
      base: fromCents(totalBaseCents),
      cuota: fromCents(totalCuotaCents),
      total: fromCents(totalCents),
    },
    hasUnclassified: unclassifiedCents > 0,
    unclassifiedTotal: fromCents(unclassifiedCents),
  };
}

/**
 * Siguiente número de factura correlativo y sin saltos para (serie, año).
 * Delega en la función SQL atómica next_invoice_number. Devuelve un entero.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{series?:string, year?:number}} [opts]
 */
export async function nextInvoiceNumber(supabase, opts = {}) {
  const series = opts.series || 'A';
  const year = opts.year || new Date().getFullYear();
  const { data, error } = await supabase.rpc('next_invoice_number', {
    p_series: series,
    p_year: year,
  });
  if (error) {
    throw new Error(`No se pudo obtener el número de factura: ${error.message}`);
  }
  return { series, year, number: data };
}

/** Formatea el número completo de factura, p. ej. "A-2026-000123". */
export function formatInvoiceNumber(series, year, number) {
  return `${series}-${year}-${String(number).padStart(6, '0')}`;
}

/**
 * Construye el payload normalizado que se enviará al proveedor VeriFactu.
 * Aún NO se envía a ningún sitio: sirve para (a) tener el mapeo de datos
 * listo y (b) detectar campos que faltan ANTES de integrar la API.
 *
 * @param {object} order
 * @param {object} [opts]  { series, year, number, isFullInvoice }
 * @returns {{ payload:object, missing:string[] }}
 */
export function buildVerifactuPayload(order, opts = {}) {
  const tax = computeTaxBreakdown(order, opts);
  const series = opts.series || order?.invoice_series || 'A';
  const year = opts.year || (order?.invoice_issued_at
    ? new Date(order.invoice_issued_at).getFullYear()
    : new Date().getFullYear());
  const number = opts.number ?? order?.invoice_number ?? null;

  // factura completa (nominal) requiere datos fiscales del destinatario.
  const isFullInvoice = Boolean(opts.isFullInvoice || order?.billing_nif);

  const payload = {
    issuer: {
      name: COMPANY.name,
      nif: COMPANY.nif,
      address: COMPANY.address,
    },
    invoice: {
      series,
      number,
      fullNumber: number != null ? formatInvoiceNumber(series, year, number) : null,
      // factura simplificada (ticket) vs completa (nominal con NIF cliente)
      type: isFullInvoice ? 'F1' : 'F2',
      issuedAt: order?.invoice_issued_at || new Date().toISOString(),
    },
    recipient: isFullInvoice
      ? {
          name: order?.billing_name || null,
          nif: order?.billing_nif || null,
          address: order?.billing_address || null,
        }
      : null,
    taxBreakdown: tax.breakdown,
    totals: tax.totals,
  };

  // Detección de datos que faltan para una emisión válida.
  const missing = [];
  if (number == null) missing.push('invoice.number');
  if (tax.hasUnclassified) missing.push('tax_rate de algún producto (hay importe sin clasificar)');
  if (isFullInvoice) {
    if (!payload.recipient.name) missing.push('billing_name');
    if (!payload.recipient.nif) missing.push('billing_nif');
  }

  return { payload, missing };
}

/**
 * STUB del proveedor VeriFactu. Cuando se contrate fiskaly, aquí se hará
 * la llamada HTTP a su API (SIGN ES) con el payload de buildVerifactuPayload
 * y se devolverá { id, hash, qr } para guardarlos en el pedido.
 *
 * Mantener TODO lo específico de fiskaly dentro de esta función para que el
 * resto del backend no dependa del proveedor.
 */
// eslint-disable-next-line no-unused-vars
export async function issueInvoiceWithProvider(payload) {
  throw new Error(
    'Proveedor VeriFactu (fiskaly) aún no configurado. ' +
    'Implementar la llamada a la API en services/invoicing.js → issueInvoiceWithProvider.'
  );
}
