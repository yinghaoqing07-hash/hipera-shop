// =====================================================================
// fiskaly SIGN ES — emisión de facturas VeriFactu (RD 1007/2023)
// =====================================================================
// Capa de PROVEEDOR sobre el groundwork de services/invoicing.js (que
// aporta los datos del emisor, la numeración atómica y el formato del
// número). Este módulo habla con la API SIGN ES de fiskaly y emite la
// factura simplificada (ticket) de cada pedido pagado.
//
// DORMANT por diseño: sin las variables FISKALY_* es un no-op total,
// igual que Sentry — el flujo de pedidos no cambia en nada.
//
// Entorno (backend/.env o Railway):
//   FISKALY_API_KEY        clave de API (TEST o LIVE, según dashboard)
//   FISKALY_API_SECRET     secreto de la API key
//   FISKALY_CLIENT_ID      uuid del client device (creado por
//                          scripts/fiskaly-setup.js, una vez por entorno)
//   FISKALY_BASE_URL       opcional; por defecto el entorno de TEST:
//                          https://test.es.sign.fiskaly.com/api/v1
//   FISKALY_SERIES_PREFIX  opcional; serie de facturas web (def. 'WEB')
//
// Numeración (coherente con invoicing.js / invoice_counters):
//   BD:      invoice_series='WEB', invoice_number=123,
//            invoice_full_number='WEB-2026-000123'
//   fiskaly: series='WEB-2026', number='123'  (el año va en la serie
//            porque el contador se reinicia cada año y AEAT exige
//            unicidad de serie+número)
//
// Flujo por pedido (issueInvoiceForOrder):
//   1) CLAIM atómico de orders.verifactu_status ('none'/'error' →
//      'pending') para que triggers paralelos no emitan dos veces.
//   2) Número correlativo SIN huecos (next_invoice_number, SQL atómica),
//      PERSISTIDO antes de llamar a fiskaly: si la llamada falla, el
//      reintento reutiliza número e invoice_id (PUT idempotente).
//   3) PUT /clients/{client}/invoices/{order.id} con la factura
//      SIMPLIFIED (desglose desde el tax_rate congelado por
//      snapshotItemTaxRates en cada línea).
//   4) Persistir: verifactu_status='issued', URL de validación AEAT
//      (QR), id del proveedor y tax_breakdown.
//
// Pendiente para una fase posterior (documentado, no bloqueante):
//   - Factura RECTIFICATIVA al reembolsar (charge.refunded / panel).
//   - Factura COMPLETA bajo demanda (cliente con NIF, billing_*).
// =====================================================================

import {
  nextInvoiceNumber,
  formatInvoiceNumber,
  DEFAULT_SHIPPING_TAX_RATE,
} from './invoicing.js';

const DEFAULT_BASE_URL = 'https://test.es.sign.fiskaly.com/api/v1';

// IVA aplicado cuando una línea no trae tax_rate congelado (producto sin
// revisar o servicio). El 21 % es el tipo general: equivocarse "hacia
// arriba" nunca infra-declara IVA. No debería ocurrir tras la revisión
// completa del catálogo previa al lanzamiento.
const FALLBACK_VAT_RATE = 21;

// Límite legal genérico de la factura simplificada (400 € IVA incluido).
// El comercio al por menor puede llegar a 3.000 € (RD 1619/2012 art. 4.2);
// exception_unidentified le indica a fiskaly que no aplique el tope de 400.
const SIMPLIFIED_LIMIT_CENTS = 40000;

export function isFiskalyEnabled() {
  return !!(
    process.env.FISKALY_API_KEY &&
    process.env.FISKALY_API_SECRET &&
    process.env.FISKALY_CLIENT_ID
  );
}

function baseUrl() {
  return (process.env.FISKALY_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

function seriesPrefix() {
  // La serie fiskaly admite ^[0-9A-Z_/\-\.]{1,20}$; saneamos por si acaso.
  const raw = (process.env.FISKALY_SERIES_PREFIX || 'WEB').toUpperCase();
  return raw.replace(/[^0-9A-Z_/\-.]/g, '').slice(0, 10) || 'WEB';
}

// ---------------------------------------------------------------------
// Autenticación: POST /auth con api_key/secret → bearer JWT con caducidad.
// Cacheamos el token y lo renovamos 60 s antes de expirar.
// ---------------------------------------------------------------------
let tokenCache = { bearer: null, expiresAt: 0 };

async function getBearer() {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.bearer && tokenCache.expiresAt - 60 > now) {
    return tokenCache.bearer;
  }
  const resp = await fetch(`${baseUrl()}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: {
        api_key: process.env.FISKALY_API_KEY,
        api_secret: process.env.FISKALY_API_SECRET,
      },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`[fiskaly] auth falló: HTTP ${resp.status} ${body.slice(0, 300)}`);
  }
  const data = await resp.json();
  const token = data?.content?.access_token;
  if (!token?.bearer) throw new Error('[fiskaly] auth sin access_token en la respuesta');
  tokenCache = { bearer: token.bearer, expiresAt: Number(token.expires_at) || 0 };
  return tokenCache.bearer;
}

// fetch autenticado contra SIGN ES. Reintenta UNA vez con token fresco si
// el cacheado fue revocado (401).
export async function fiskalyFetch(path, { method = 'GET', body } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const bearer = await getBearer();
    const resp = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (resp.status === 401 && attempt === 0) {
      tokenCache = { bearer: null, expiresAt: 0 };
      continue;
    }
    return resp;
  }
  throw new Error('[fiskaly] unreachable');
}

// ---------------------------------------------------------------------
// Construcción de la factura SIMPLIFIED a partir de un pedido
// ---------------------------------------------------------------------
// fiskaly necesita LÍNEAS (no solo el desglose agregado), así que aquí se
// reconstruyen las líneas del pedido con su IVA congelado. Aritmética en
// CÉNTIMOS para cuadrar AL CÉNTIMO con orders.total:
//   - Línea de producto: bruto = round(price*100)*qty (misma convención
//     que computeSubtotal y computeTaxBreakdown).
//   - El descuento del cupón se reparte entre las líneas de producto en
//     proporción a su importe (resto mayor: la suma de repartos es
//     EXACTAMENTE el descuento). El envío no se descuenta, coherente con
//     cómo se calculó el total al crear el pedido.
//   - El envío no existe como línea en el pedido: es total + descuento −
//     subtotal, y tributa a DEFAULT_SHIPPING_TAX_RATE (21 %).
//   - unit_amount (neto sin IVA) se deriva del bruto final de la línea
//     con 8 decimales: unit_amount × qty × (1+IVA) reproduce el bruto con
//     error < 0,000001 € (el descuento va "horneado" en el neto unitario).
//
// El desglose que devolvemos sale de ESTAS MISMAS líneas (no de
// computeTaxBreakdown) para que lo guardado coincida exactamente con lo
// que fiskaly registra en AEAT.
//
// Devuelve { content, breakdown }; lanza si el pedido no es facturable.
export function buildInvoiceContent(order, { series, number, strictTaxRates = false } = {}) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const totalCents = Math.round(Number(order?.total) * 100);
  if (!Number.isFinite(totalCents) || totalCents <= 0) {
    throw new Error(`pedido ${order?.id}: total no facturable (${order?.total})`);
  }

  // --- Líneas de producto (mismos filtros que computeSubtotal) ---
  const lines = [];
  for (const it of items) {
    if (it?.isGift) continue; // regalos: 0 € y no facturan
    const price = Number(it?.price);
    const qty = Number(it?.quantity) || 0;
    if (!Number.isFinite(price) || price <= 0 || qty <= 0) continue;
    const rawRate = Number(it?.tax_rate);
    const hasValidRate = [4, 10, 21].includes(rawRate);
    if (!hasValidRate && strictTaxRates && !it?.isService) {
      throw new Error(`pedido ${order?.id}: falta IVA en "${it?.name || 'Artículo'}"`);
    }
    const rate = hasValidRate ? rawRate : FALLBACK_VAT_RATE;
    lines.push({
      text: String(it?.name || 'Artículo').slice(0, 480),
      qty,
      grossCents: Math.round(price * 100) * qty,
      rate,
    });
  }
  if (lines.length === 0) {
    throw new Error(`pedido ${order?.id}: sin líneas facturables`);
  }

  const productGross = lines.reduce((s, l) => s + l.grossCents, 0);

  // --- Reparto del descuento entre líneas (resto mayor) ---
  const discountCents = Math.min(
    Math.max(Math.round(Number(order?.discount || 0) * 100), 0),
    productGross
  );
  if (discountCents > 0) {
    let assigned = 0;
    const shares = lines.map((l) => {
      const exact = (discountCents * l.grossCents) / productGross;
      const floor = Math.floor(exact);
      assigned += floor;
      return { floor, frac: exact - floor };
    });
    // Los céntimos restantes van a las fracciones más grandes.
    let remaining = discountCents - assigned;
    const byFrac = shares
      .map((s, i) => ({ i, frac: s.frac }))
      .sort((a, b) => b.frac - a.frac);
    for (const { i } of byFrac) {
      if (remaining <= 0) break;
      shares[i].floor += 1;
      remaining -= 1;
    }
    lines.forEach((l, i) => { l.grossCents -= shares[i].floor; });
  }

  // --- Envío: lo que el total no explica con productos y descuento ---
  const shippingCents = totalCents - (productGross - discountCents);
  if (shippingCents < 0) {
    // El total guardado no cuadra con items+descuento: datos inconsistentes.
    // Mejor abortar y revisar a mano que declarar un desglose inventado.
    throw new Error(
      `pedido ${order?.id}: total (${totalCents}) menor que items−descuento (${productGross - discountCents}); revisar a mano`
    );
  }
  if (shippingCents > 0) {
    lines.push({
      text: order?.delivery_method === 'store_pickup' ? 'Suplemento de pedido' : 'Envío a domicilio',
      qty: 1,
      grossCents: shippingCents,
      rate: DEFAULT_SHIPPING_TAX_RATE,
    });
  }

  // --- Líneas fiskaly + desglose por tipo (de las mismas líneas) ---
  const fkItems = lines
    .filter((l) => l.grossCents > 0)
    .map((l) => {
      const gross = l.grossCents / 100;
      const unitNet = gross / l.qty / (1 + l.rate / 100);
      return {
        text: l.text,
        quantity: String(l.qty),
        unit_amount: unitNet.toFixed(8),
        full_amount: gross.toFixed(2),
        system: {
          type: 'REGULAR',
          category: { type: 'VAT', rate: l.rate.toFixed(1) },
        },
      };
    });

  const byRate = new Map();
  for (const l of lines) {
    if (l.grossCents <= 0) continue;
    byRate.set(l.rate, (byRate.get(l.rate) || 0) + l.grossCents);
  }
  const breakdown = [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, grossCents]) => {
      const baseCents = Math.round((grossCents * 100) / (100 + rate));
      return {
        rate,
        base: baseCents / 100,
        cuota: (grossCents - baseCents) / 100,
        total: grossCents / 100,
      };
    });

  const shortId = String(order?.id || '').slice(0, 8).toUpperCase();
  const content = {
    type: 'SIMPLIFIED',
    series,
    number,
    text: `Venta HIPERA — pedido ${shortId}`,
    full_amount: (totalCents / 100).toFixed(2),
    items: fkItems,
    // Venta minorista: la simplificada puede superar 400 € (hasta 3.000 €).
    ...(totalCents > SIMPLIFIED_LIMIT_CENTS ? { exception_unidentified: true } : {}),
  };

  return { content, breakdown };
}

// ---------------------------------------------------------------------
// Servicio con dependencias inyectadas (supabase del server, reportError)
// ---------------------------------------------------------------------
export function createFiskalyService({ supabase, reportError }) {
  // Emite (o reintenta) la factura de un pedido. Idempotente y seguro
  // ante triggers concurrentes. `force` permite reintentar pedidos
  // atascados en 'pending' (p. ej. proceso muerto entre claim y respuesta).
  async function issueInvoiceForOrder(orderId, { force = false } = {}) {
    if (!isFiskalyEnabled()) return { ok: false, skipped: 'disabled' };

    const { data: order, error: fErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();
    if (fErr || !order) {
      throw new Error(`[fiskaly] pedido no encontrado: ${orderId} ${fErr?.message || ''}`);
    }
    if (order.status === 'Cancelado') return { ok: false, skipped: 'cancelado' };
    if (order.verifactu_status === 'issued') return { ok: true, already: true };
    if (!(Number(order.total) > 0)) return { ok: false, skipped: 'total_cero' };

    // 1) CLAIM atómico — solo una ejecución pasa de aquí.
    const claimable = force ? ['none', 'error', 'pending'] : ['none', 'error'];
    const { data: claimed, error: cErr } = await supabase
      .from('orders')
      .update({ verifactu_status: 'pending' })
      .eq('id', orderId)
      .in('verifactu_status', claimable)
      .select('id')
      .limit(1);
    if (cErr) throw new Error(`[fiskaly] claim falló: ${cErr.message}`);
    if (!claimed || claimed.length === 0) {
      return { ok: false, skipped: 'claimed_elsewhere' };
    }

    try {
      // 2) Numeración correlativa (reutiliza la asignada en reintentos).
      let series = order.invoice_series;
      let number = order.invoice_number;
      let year;
      if (series && Number.isFinite(Number(number)) && order.invoice_full_number) {
        // Reintento: el año vive en el número completo 'WEB-2026-000123'.
        const m = String(order.invoice_full_number).match(/-(\d{4})-\d+$/);
        year = m ? Number(m[1]) : new Date().getFullYear();
        number = Number(number);
      } else {
        year = new Date().getFullYear();
        const assigned = await nextInvoiceNumber(supabase, { series: seriesPrefix(), year });
        series = assigned.series;
        number = assigned.number;
        const fullNumber = formatInvoiceNumber(series, year, number);
        const { error: pErr } = await supabase
          .from('orders')
          .update({ invoice_series: series, invoice_number: number, invoice_full_number: fullNumber })
          .eq('id', orderId);
        if (pErr) throw new Error(`[fiskaly] no se pudo persistir el número: ${pErr.message}`);
      }

      // 3) Construir y emitir. La serie ante AEAT lleva el año porque el
      //    contador se reinicia cada año (unicidad de serie+número).
      const { content, breakdown } = buildInvoiceContent(order, {
        series: `${series}-${year}`,
        number: String(number),
      });

      let resp = await fiskalyFetch(`/clients/${process.env.FISKALY_CLIENT_ID}/invoices/${order.id}`, {
        method: 'PUT',
        body: { content },
      });

      // 409 = ya existe (un reintento de una emisión que SÍ llegó): la
      // recuperamos y la tratamos como éxito.
      if (resp.status === 409) {
        resp = await fiskalyFetch(`/clients/${process.env.FISKALY_CLIENT_ID}/invoices/${order.id}`);
      }
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`[fiskaly] createInvoice HTTP ${resp.status}: ${body.slice(0, 500)}`);
      }

      const data = await resp.json();
      const signed = data?.content;
      const registration = signed?.transmission?.registration || 'PENDING';

      // 4) Persistir el resultado. verifactu_qr = URL de validación AEAT
      //    (el QR imprimible se regenera a partir de ella con la librería
      //    qrcode ya presente en el backend).
      const { error: uErr } = await supabase
        .from('orders')
        .update({
          verifactu_status: 'issued',
          verifactu_id: signed?.id || order.id,
          verifactu_qr: signed?.compliance?.url || null,
          invoice_issued_at: new Date().toISOString(),
          tax_breakdown: { rates: breakdown, registration },
        })
        .eq('id', orderId);
      if (uErr) throw new Error(`[fiskaly] no se pudo guardar la emisión: ${uErr.message}`);

      console.log(`[fiskaly] factura emitida: pedido ${String(orderId).slice(0, 8)} → ${formatInvoiceNumber(series, year, number)} (registro: ${registration})`);
      return { ok: true, series, number, registration };
    } catch (e) {
      // Marca 'error' para que el reintento (admin) lo recoja.
      await supabase
        .from('orders')
        .update({ verifactu_status: 'error' })
        .eq('id', orderId)
        .then(() => {}, () => {});
      reportError(e, `[fiskaly] emisión falló para pedido ${orderId}`);
      return { ok: false, error: e?.message || String(e) };
    }
  }

  return { issueInvoiceForOrder };
}
