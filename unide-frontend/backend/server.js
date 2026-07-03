// 'dotenv/config' PRIMERO: los imports se evalúan en orden, así que esto
// garantiza que process.env ya está cargado cuando el resto de módulos
// (lib/supabase.js, lib/monitoring.js, ...) leen variables de entorno.
import 'dotenv/config';
import express from 'express';
import { reportError, attachSentryErrorHandler } from './lib/monitoring.js';
import { supabase } from './lib/supabase.js';
import {
  authenticateUser,
  authenticateAdmin,
  isAdminUser,
  getVerifiedUserId,
} from './middleware/auth.js';
import {
  apiLimiter,
  orderHourlyLimiter,
  orderDailyLimiter,
} from './middleware/rateLimits.js';
import { verifyTurnstileToken } from './services/turnstile.js';
import { autoPrintTicket, generatePickupCode, resolvePickupCode } from './services/ticket.js';
import { adjustStockCas, deductStockForItems, restockItems } from './services/stock.js';
import { snapshotItemTaxRates, prepareOrderForInvoice } from './services/orderTax.js';
import { buildRefundWhatsappLink, buildPickupReadyWhatsappLink } from './services/whatsapp.js';
import { isSpanishPhoneOk } from './services/phone.js';
import { orderContainsAlcohol } from './services/alcohol.js';
import catalogRoutes from './routes/catalog.js';
import repairBookingRoutes from './routes/repairBookings.js';
import printRoutes from './routes/print.js';
import adminCatalogRoutes from './routes/adminCatalog.js';
import adminImageRoutes from './routes/adminImages.js';
import { sendOrderConfirmationEmail, sendRefundEmail, sendPickupReadyEmail } from './services/email.js';

import {
  getStripe,
  buildCheckoutLineItems,
  resolveStripePaymentLabel,
} from './services/stripe.js';
import {
  evaluateCoupon,
  computeSubtotal,
  couponErrorMessage,
} from './services/coupons.js';
import { createFiskalyService, isFiskalyEnabled } from './services/fiskaly.js';
import { createLocalInvoiceService, isLocalInvoicingEnabled } from './services/localInvoicing.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy (needed for Railway/reverse proxy setups)
app.set('trust proxy', true);

// CORS: whitelist explícita de orígenes permitidos.
// - https://www.hipera.es — dominio CANÓNICO real servido (el apex 307→www)
// - https://hipera.es — apex (redirige a www, se permite por si acaso)
// - https://hipera-shop.vercel.app — alias técnico del deploy de Vercel
// - *.vercel.app — previews de PR/branch generados automáticamente por Vercel
// Cualquier otro Origin recibe el dominio canónico (sin credenciales válidas
// para la petición, pero la respuesta no expone datos).
const CORS_ALLOW_HEADERS = 'Content-Type, Authorization, Accept';
const CORS_ALLOWED_ORIGINS = new Set([
  'https://www.hipera.es',
  'https://hipera.es',
  'https://hipera-shop.vercel.app',
]);
const isAllowedOrigin = (origin) =>
  CORS_ALLOWED_ORIGINS.has(origin) ||
  /^https:\/\/[a-z0-9-]+-[a-z0-9]+-[a-z0-9]+\.vercel\.app$/.test(origin);

app.use((req, res, next) => {
  const raw = (req.headers.origin || '').trim();
  const validOrigin = raw && isAllowedOrigin(raw) ? raw : 'https://hipera.es';
  res.setHeader('Access-Control-Allow-Origin', validOrigin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }
  next();
});

// Cliente de Supabase compartido: ver lib/supabase.js

// =====================================================================
// fiskaly SIGN ES — facturación VeriFactu (dormant sin FISKALY_*)
// =====================================================================
// La factura simplificada se emite EN EL MOMENTO DEL COBRO efectivo:
//   - Stripe con cargo inmediato (Bizum/tarjeta auto) → webhook 'paid'
//   - Tarjeta con retención → al capturar desde el panel
//   - Contra reembolso / pago en tienda → al marcar 'Entregado'
// Siempre best-effort: una caída de fiskaly NUNCA bloquea el pedido; el
// estado queda en 'error' y se reintenta desde el panel
// (POST /api/admin/orders/:id/invoice).
const fiskaly = createFiskalyService({ supabase, reportError, prepareOrderForInvoice });
const localInvoicing = createLocalInvoiceService({ supabase, reportError, prepareOrderForInvoice });

function issueInvoiceBestEffort(orderId, trigger) {
  const issuerName = isFiskalyEnabled() ? 'fiskaly' : 'invoice-local';
  const issuer = isFiskalyEnabled() ? fiskaly : (isLocalInvoicingEnabled() ? localInvoicing : null);
  if (!issuer) return Promise.resolve({ ok: false, skipped: 'disabled' });
  return issuer.issueInvoiceForOrder(orderId).catch((e) => {
    reportError(e, `[${issuerName}] emisión falló (${trigger}) pedido ${orderId}`);
    return { ok: false, error: e?.message || String(e) };
  });
}

// Health check (for Railway/Vercel monitoring + debugging env issues)
app.get('/api/health', async (_req, res) => {
  const hasUrl = !!process.env.SUPABASE_URL;
  const hasKey = !!process.env.SUPABASE_SERVICE_KEY;
  try {
    // Lightweight sanity check: attempt a simple query.
    // If env vars are missing or network/DNS fails, this will throw.
    const { error } = await supabase.from('products').select('id').limit(1);
    if (error) throw error;
    return res.json({ ok: true, supabase: { hasUrl, hasServiceKey: hasKey } });
  } catch (e) {
    const msg = e?.message || String(e);
    const cause = e?.cause?.message || e?.cause?.code || null;
    return res.status(500).json({ ok: false, supabase: { hasUrl, hasServiceKey: hasKey }, error: msg, cause });
  }
});

// 添加响应头防止CORB
app.use((req, res, next) => {
  res.header('X-Content-Type-Options', 'nosniff');
  next();
});

// =====================================================================
// Stripe Webhook — DEBE registrarse ANTES de express.json()
// =====================================================================
// La verificación de firma de Stripe (stripe.webhooks.constructEvent)
// requiere el cuerpo de la petición SIN PARSEAR (raw Buffer). Si
// express.json() lo parsea primero, la firma deja de coincidir y todos
// los webhooks fallan con 400. Por eso esta ruta usa express.raw() y se
// registra aquí, antes del parser JSON global.
//
// El handler debe responder 2xx rápido. Separamos:
//   - Crítico (actualizar pedido a pagado): si falla, devolvemos 500 y
//     Stripe reintenta (no perdemos la confirmación de pago).
//   - Best-effort (email, impresión): se capturan internamente; su fallo
//     NO provoca reintentos en bucle (el pago ya está confirmado).
//
// URL a configurar en el panel de Stripe (Developers → Webhooks):
//   https://hipera-shop-production.up.railway.app/api/stripe/webhook
// Apuntamos directo a Railway (no a hipera.es) para que el proxy de
// Vercel no toque el cuerpo y rompa la firma.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = getStripe();
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !whSecret) {
    console.warn('[stripe] webhook recibido pero Stripe no está configurado (falta key o webhook secret)');
    return res.status(503).send('Stripe not configured');
  }

  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, whSecret);
  } catch (err) {
    console.error('[stripe] firma de webhook inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      // Puede lanzar si la actualización crítica en BD falla → 500 →
      // Stripe reintenta. Email/impresión son best-effort internamente.
      await handleStripeCheckoutCompleted(event.data.object);
    } else if (event.type === 'checkout.session.expired') {
      await handleStripeCheckoutExpired(event.data.object);
    } else if (event.type === 'payment_intent.canceled') {
      // Autorización de tarjeta cancelada/caducada (a los ~7 días si no se
      // captura) → cancelamos el pedido y reponemos el stock reservado.
      await handleStripePaymentIntentCanceled(event.data.object);
    } else if (event.type === 'charge.refunded') {
      // Reembolso total → cancela el pedido y repone stock (idempotente).
      await handleStripeChargeRefunded(event.data.object);
    }
    // Otros eventos: los aceptamos con 200 sin procesar.
    return res.json({ received: true });
  } catch (e) {
    // Fallo crítico: el pago se confirmó en Stripe pero no pudimos
    // reflejarlo en BD (pedido pagado pero no registrado / sin stock
    // descontado). Es el error más caro de no enterarse → a Sentry.
    reportError(e, '[stripe] error crítico procesando webhook');
    // 500 → Stripe reintentará el evento (no perdemos la confirmación).
    return res.status(500).json({ error: 'internal' });
  }
});

app.use(express.json());

// Rate limiting global (ver middleware/rateLimits.js).
app.use('/api/', apiLimiter);

// Limiters específicos de pedidos y citas: middleware/rateLimits.js

// Turnstile: ver services/turnstile.js

// Autenticación (JWT admin + agente de impresión): ver middleware/auth.js

// ========== PUBLIC ROUTES (Frontend) ==========
// Catálogo público (productos/categorías/servicios): routes/catalog.js
app.use(catalogRoutes);

// Citas de reparación (pública + gestión admin): routes/repairBookings.js
app.use(repairBookingRoutes);

// Create order (public - but should validate)
// =====================================================================
// Modalidades de entrega aceptadas — alineado con la columna
// orders.delivery_method (CHECK constraint en supabase_migration_orders_
// delivery_method.sql). Cualquier valor fuera de esta lista se normaliza
// a 'home_delivery' para evitar 400s por front antiguo o por inputs
// inesperados; esto preserva la compatibilidad hacia atrás con los
// payloads que el frontend enviaba antes de existir el selector.
// =====================================================================
const VALID_DELIVERY_METHODS = ['home_delivery', 'store_pickup'];

// Validación de teléfono español: services/phone.js

// =====================================================================
// Estados que se consideran "no completados" a efectos de anti-abuso.
// Si el cliente acumula varios pedidos en estos estados con el mismo
// teléfono en 24 h, el siguiente se rechaza con 429.
//
// "Procesando": pedido aceptado (Bizum verificado o por verificar) y
// pendiente de preparación o entrega/recogida.
// "Pendiente de Pago": contra reembolso que aún no se ha cobrado.
//
// "Entregado" y "Cancelado" NO cuentan: el primero porque el cliente
// ya cumplió su parte; el segundo porque ya está cerrado (cancelar es
// una salida válida del flujo).
// =====================================================================
const UNCOMPLETED_ORDER_STATUSES = ['Procesando', 'Pendiente de Pago'];

// Inserta la fila del pedido tolerando que la columna age_confirmed_at
// aún no exista (migración supabase_migration_orders_age_confirmation.sql
// pendiente de ejecutar): en ese caso reintenta sin el campo para no
// bloquear ventas entre el deploy y la migración.
async function insertOrderRow(row) {
  let { data, error } = await supabase.from('orders').insert([row]).select().single();
  if (error && row.age_confirmed_at && /age_confirmed_at/i.test(error.message || '')) {
    console.warn('[orders] columna age_confirmed_at ausente; ejecutar la migración. Insertando sin ella.');
    const { age_confirmed_at: _omit, ...rest } = row;
    ({ data, error } = await supabase.from('orders').insert([rest]).select().single());
  }
  return { data, error };
}
const MAX_UNCOMPLETED_PER_PHONE_24H = 2;

// =====================================================================
// Cupones — uso único por cliente (necesita BD)
// =====================================================================
// Un cupón con oncePerCustomer se considera "ya usado" si existe otro
// pedido del mismo usuario (o, si es invitado, del mismo teléfono) con
// el mismo coupon_code y un estado que NO sea 'Esperando pago' (checkout
// Stripe abandonado, no consumió nada) ni 'Cancelado' (pedido anulado).
// Tolerante a fallos: ante un error de BD devolvemos false (fail-open),
// preferimos permitir un descuento legítimo a bloquear la compra por un
// glitch puntual de Supabase.
async function couponAlreadyUsed(code, { user_id, phone }) {
  try {
    let q = supabase.from('orders').select('id, status').eq('coupon_code', code);
    if (user_id) q = q.eq('user_id', user_id);
    else if (phone) q = q.eq('phone', phone);
    else return false; // sin forma de identificar al cliente
    const { data, error } = await q;
    if (error) {
      console.warn('[coupon] used check error:', error.message);
      return false;
    }
    const consumed = ['Esperando pago', 'Cancelado'];
    return (data || []).some((o) => !consumed.includes(o.status));
  } catch (e) {
    console.warn('[coupon] used check unexpected:', e?.message || e);
    return false;
  }
}

// getVerifiedUserId: ver middleware/auth.js

// Resuelve el cupón para un pedido: validación pura + uso único (BD).
// Devuelve { ok, code, discount } o { ok:false, reason, ... }.
async function resolveCouponForOrder(rawCode, items, { user_id, phone }) {
  const subtotal = computeSubtotal(items);
  const evald = evaluateCoupon(rawCode, subtotal);
  if (!evald.ok) return evald;
  // Cupones que exigen cuenta: si no hay user_id (verificado), rechazar.
  if (evald.coupon.requiresAccount && !user_id) {
    return { ok: false, reason: 'LOGIN_REQUIRED', code: evald.code };
  }
  if (evald.coupon.oncePerCustomer) {
    const used = await couponAlreadyUsed(evald.code, { user_id, phone });
    if (used) return { ok: false, reason: 'ALREADY_USED', code: evald.code };
  }
  return {
    ok: true,
    code: evald.code,
    discount: evald.discount,
    type: evald.coupon.type,
    value: evald.coupon.value,
    minSubtotal: evald.coupon.minSubtotal,
  };
}

// Stock (adjustStockCas / deductStockForItems / restockItems): services/stock.js

// IVA congelado por línea (snapshot/backfill): services/orderTax.js

// =====================================================================
// Handlers de webhook de Stripe
// =====================================================================
// (Declarados como function → hoisted, usables por la ruta de webhook
// que se registró más arriba, antes de express.json().)

// checkout.session.completed → confirma el pago de un pedido.
// Idempotente: si el pedido ya está 'Procesando'/'Entregado' no
// re-procesa (Stripe puede reenviar el evento). Lanza sólo en fallos
// críticos de BD para que Stripe reintente.
async function handleStripeCheckoutCompleted(session) {
  const orderId = session.metadata?.order_id;
  if (!orderId) {
    console.error('[stripe] sesión sin metadata.order_id:', session.id);
    return; // no podemos reconciliar; no tiene sentido reintentar
  }

  const { data: order, error: fErr } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (fErr || !order) {
    console.error('[stripe] pedido no encontrado para sesión:', orderId, fErr?.message);
    return; // pedido inexistente: reintentar no ayuda
  }

  // Idempotencia: ya procesado/autorizado (Stripe puede reenviar el evento).
  if (order.status === 'Autorizado' || order.status === 'Procesando' || order.status === 'Entregado') {
    console.log('[stripe] pedido ya procesado (idempotente):', orderId, order.status);
    return;
  }

  // Determinar el estado real del PaymentIntent para distinguir:
  //   - requires_capture → tarjeta AUTORIZADA (retención), aún sin cobrar.
  //     El pedido entra como "Autorizado" y se cobra luego desde el panel.
  //   - succeeded → cobro inmediato (Bizum, o tarjeta en captura automática).
  const stripe = getStripe();
  const piIdStr = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : (session.payment_intent?.id || null);

  let pi = null;
  let paymentLabel = 'Stripe';
  try {
    if (stripe && piIdStr) {
      pi = await stripe.paymentIntents.retrieve(piIdStr, { expand: ['latest_charge'] });
      const type = pi?.latest_charge?.payment_method_details?.type;
      paymentLabel = type ? resolveStripePaymentLabel(type) : paymentLabel;
    }
  } catch (e) {
    console.warn('[stripe] no se pudo resolver el PaymentIntent:', e?.message);
  }

  const isAuthorizedOnly = pi?.status === 'requires_capture';
  const isPaid = session.payment_status === 'paid' || pi?.status === 'succeeded';

  if (!isAuthorizedOnly && !isPaid) {
    // Pago en curso/incompleto (p.ej. método asíncrono pendiente). No
    // procesamos todavía; un evento posterior lo confirmará.
    console.log('[stripe] sesión completada sin pago ni autorización capturable:', session.id, 'payment_status=', session.payment_status, 'pi=', pi?.status);
    return;
  }

  // Para autorizaciones de tarjeta aún no hay charge: etiquetamos como
  // tarjeta (la captura manual sólo aplica a 'card').
  if (isAuthorizedOnly && paymentLabel === 'Stripe') {
    paymentLabel = 'Tarjeta (Stripe)';
  }

  const newStatus = isAuthorizedOnly ? 'Autorizado' : 'Procesando';

  // CRÍTICO: persistir el estado con un CLAIM ATÓMICO. El UPDATE sólo se
  // aplica si el pedido sigue 'Esperando pago' (.eq('status', ...)). Así,
  // si Stripe reenvía el evento o llegan dos en paralelo, sólo UNA
  // ejecución gana el claim y descuenta stock — el resto afecta 0 filas y
  // sale sin tocar el inventario. Si falla, lanzamos → webhook 500 →
  // Stripe reintenta.
  const { data: claimed, error: uErr } = await supabase
    .from('orders')
    .update({
      status: newStatus,
      payment_method: paymentLabel,
      stripe_payment_intent: piIdStr,
      confirmed_at: new Date().toISOString(), // dispara la alerta de nuevos pedidos AHORA
    })
    .eq('id', orderId)
    .eq('status', 'Esperando pago')
    .select();
  if (uErr) {
    throw new Error('No se pudo actualizar el pedido: ' + uErr.message);
  }
  if (!claimed || claimed.length === 0) {
    // Otra ejecución (reintento/evento paralelo) ya transicionó el pedido,
    // o caducó a 'Cancelado'. No descontamos stock por segunda vez.
    console.log('[stripe] pedido ya reclamado/transicionado por otra vía (idempotente):', orderId);
    return;
  }

  // Descontar (reservar) stock ya en la autorización, para no sobrevender
  // entre que se autoriza y se cobra. Si luego se cancela/caduca la
  // autorización, el stock se repone (ver cancelación / payment_intent.canceled).
  try {
    const { issues } = await deductStockForItems(order.items || []);
    if (issues.length) {
      console.warn('[stripe] STOCK INSUFICIENTE tras autorización/pago (revisar manualmente) pedido', orderId, JSON.stringify(issues));
    }
  } catch (e) {
    console.error('[stripe] error al descontar stock:', e?.message);
  }

  // Objeto del pedido para email/impresión.
  let fulfilledOrder = { ...order, status: newStatus, payment_method: paymentLabel };

  // Factura al mover dinero de verdad. En modo local esperamos la BD
  // para que el ticket/PDF ya puedan mostrar numero y desglose; con
  // fiskaly lo dejamos best-effort para no alargar el webhook.
  if (!isAuthorizedOnly) {
    if (isFiskalyEnabled()) {
      issueInvoiceBestEffort(orderId, 'stripe pago confirmado');
    } else {
      const invoiceResult = await issueInvoiceBestEffort(orderId, 'stripe pago confirmado');
      if (invoiceResult?.order) fulfilledOrder = { ...fulfilledOrder, ...invoiceResult.order };
    }
  }

  // Email de confirmación (best-effort).
  if (order.customer_email) {
    sendOrderConfirmationEmail(fulfilledOrder, order.customer_email).catch((err) => {
      console.error('[stripe][email] fallo (no bloquea):', err?.message || err);
    });
  }

  // Impresión automática del ticket (best-effort).
  if (process.env.AUTO_PRINT_ENABLED !== 'false') {
    autoPrintTicket(fulfilledOrder).catch((err) => {
      console.error('[stripe][print] fallo (no bloquea):', err?.message || err);
    });
  }

  console.log('[stripe] pedido', isAuthorizedOnly ? 'AUTORIZADO (pendiente de cobro)' : 'confirmado y procesado', ':', orderId, '·', paymentLabel);
}

// checkout.session.expired → la sesión caducó sin pagar. Cancelamos el
// pedido SOLO si sigue 'Esperando pago' (nunca pisamos un pedido que ya
// se confirmó por otra vía).
async function handleStripeCheckoutExpired(session) {
  const orderId = session.metadata?.order_id;
  if (!orderId) return;

  const { data: order } = await supabase
    .from('orders')
    .select('id, status')
    .eq('id', orderId)
    .single();
  if (!order) return;

  if (order.status === 'Esperando pago') {
    await supabase.from('orders').update({ status: 'Cancelado' }).eq('id', orderId);
    console.log('[stripe] sesión caducada → pedido cancelado:', orderId);
  }
}

// payment_intent.canceled → la AUTORIZACIÓN de tarjeta se canceló (manual,
// desde el panel) o CADUCÓ (Stripe la libera automáticamente a los ~7 días
// si no se captura). Si el pedido sigue "Autorizado", lo cancelamos y
// reponemos el stock reservado. Idempotente: si ya no está "Autorizado"
// (p.ej. ya lo canceló el endpoint del panel) no hace nada.
async function handleStripePaymentIntentCanceled(pi) {
  const orderId = pi?.metadata?.order_id;
  if (!orderId) return;

  const { data: order } = await supabase
    .from('orders')
    .select('id, status, items')
    .eq('id', orderId)
    .single();
  if (!order) return;

  // Claim atómico: sólo reponemos stock si ESTA ejecución es la que
  // transiciona Autorizado → Cancelado (evita doble reposición si el
  // panel ya canceló o si el evento se reenvía).
  const { data: claimed } = await supabase
    .from('orders')
    .update({ status: 'Cancelado' })
    .eq('id', orderId)
    .eq('status', 'Autorizado')
    .select();
  if (claimed && claimed.length === 1) {
    try {
      await restockItems(order.items || []);
    } catch (e) {
      console.error('[stripe] error al reponer stock tras autorización cancelada:', e?.message);
    }
    console.log('[stripe] autorización cancelada/caducada → pedido cancelado + stock repuesto:', orderId);
  }
}

// charge.refunded → reembolso en Stripe. SOLO actuamos en reembolso
// TOTAL (charge.refunded === true): marcamos el pedido 'Cancelado' y
// reponemos el stock. En reembolso PARCIAL no podemos saber qué
// artículos se devolvieron, así que se deja para gestión manual.
// Idempotente: si el pedido ya está 'Cancelado' no repone stock dos
// veces (Stripe puede reenviar el evento).
async function handleStripeChargeRefunded(charge) {
  if (!charge.refunded) {
    console.log('[stripe] reembolso parcial (gestión manual), charge:', charge.id);
    return;
  }

  const piId = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id;
  if (!piId) {
    console.warn('[stripe] charge.refunded sin payment_intent:', charge.id);
    return;
  }

  const { data: order, error: fErr } = await supabase
    .from('orders')
    .select('*')
    .eq('stripe_payment_intent', piId)
    .single();

  if (fErr || !order) {
    console.warn('[stripe] reembolso: pedido no encontrado para PI', piId, fErr?.message);
    return; // no reconciliable; reintentar no ayuda
  }

  // Idempotencia: ya cancelado → no reponer stock otra vez.
  if (order.status === 'Cancelado') {
    console.log('[stripe] reembolso: pedido ya cancelado (idempotente):', order.id);
    return;
  }

  // Claim atómico: marcamos Cancelado SÓLO si aún no lo está
  // (.neq('status','Cancelado')) y reponemos stock únicamente si esta
  // ejecución ganó el claim. Cierra la carrera con el reembolso del panel
  // (que también repone) y los reenvíos del evento → exactamente UNA
  // reposición.
  const { data: claimed, error: uErr } = await supabase
    .from('orders')
    .update({ status: 'Cancelado' })
    .eq('id', order.id)
    .neq('status', 'Cancelado')
    .select();
  if (uErr) {
    throw new Error('No se pudo cancelar el pedido reembolsado: ' + uErr.message);
  }
  if (!claimed || claimed.length === 0) {
    console.log('[stripe] reembolso: pedido ya cancelado por otra vía (idempotente):', order.id);
    return;
  }

  try {
    await restockItems(order.items || []);
  } catch (e) {
    console.error('[stripe] error al reponer stock (pedido reembolsado):', e?.message);
  }

  console.log('[stripe] pedido reembolsado → cancelado y stock repuesto:', order.id);
}

// =====================================================================
// POST /api/coupon/validate — previsualización del cupón en el checkout
// =====================================================================
// El frontend llama aquí cuando el cliente pulsa "Aplicar" para dar
// feedback inmediato (descuento o motivo de rechazo) ANTES de pagar.
// La validación autoritativa se repite al crear el pedido (POST /orders
// y /checkout/stripe-session), así que aquí no hay riesgo aunque alguien
// llame al endpoint directamente.
app.post('/api/coupon/validate', async (req, res) => {
  try {
    const { code, items, phone } = req.body || {};

    // Identidad: si viene sesión válida, mandan el user_id del token; si
    // no, caemos al teléfono (cliente invitado con tarjeta/Bizum).
    let userId = null;
    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (bearer) {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser(bearer);
        if (authUser) userId = authUser.id;
      } catch { /* sesión inválida: seguimos como invitado */ }
    }

    const result = await resolveCouponForOrder(code, items, { user_id: userId, phone });
    if (!result.ok) {
      return res.json({
        valid: false,
        reason: result.reason,
        message: couponErrorMessage(result.reason, result),
      });
    }
    return res.json({
      valid: true,
      code: result.code,
      discount: result.discount,
      type: result.type,
      value: result.value,
      minSubtotal: result.minSubtotal,
    });
  } catch (e) {
    console.error('[coupon] validate error:', e?.message || e);
    return res.status(500).json({ valid: false, message: 'No se pudo validar el cupón.' });
  }
});

app.post('/api/orders', orderHourlyLimiter, orderDailyLimiter, async (req, res) => {
  try {
    let {
      user_id,
      address,
      phone,
      note,
      total,
      status,
      payment_method,
      items,
      customer_email,
      delivery_method,
      turnstile_token,
      coupon_code,
      age_confirmed,
    } = req.body;

    // =================================================================
    // Anti-abuso 0: Cloudflare Turnstile (captcha invisible)
    // =================================================================
    // Se verifica ANTES que cualquier otra cosa porque es el filtro
    // más barato (~50 ms) y rechaza bots automatizados de raíz, antes
    // de tocar Supabase. En modo dev (sin TURNSTILE_SECRET_KEY) la
    // función verifyTurnstileToken devuelve { ok: true, skipped: true }
    // y no impacta al flujo.
    const turnstileResult = await verifyTurnstileToken(
      turnstile_token,
      req.ip
    );
    if (!turnstileResult.ok) {
      console.warn('[anti-abuse] turnstile failed:', turnstileResult.error, 'ip:', req.ip);
      return res.status(403).json({
        error: 'Verificación de seguridad fallida. Recarga la página e inténtalo otra vez.',
        code: 'TURNSTILE_FAILED',
      });
    }

    // Resolución del método de entrega. El default 'home_delivery'
    // garantiza el comportamiento histórico para clientes antiguos que
    // no envíen el campo (la columna de DB también tiene el mismo
    // default por la migración).
    const resolvedDeliveryMethod = VALID_DELIVERY_METHODS.includes(delivery_method)
      ? delivery_method
      : 'home_delivery';
    const isStorePickup = resolvedDeliveryMethod === 'store_pickup';

    // Validate required fields. La dirección sólo es obligatoria para
    // envío a domicilio; en recogida en tienda no tiene sentido pedir
    // direccion postal del cliente (la entrega ocurre en el local).
    if (!phone || !total || !items) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!isSpanishPhoneOk(phone)) {
      return res.status(400).json({ error: 'Teléfono no válido. Introduce un número español de 9 cifras.' });
    }
    if (!isStorePickup && !address) {
      return res.status(400).json({ error: 'La dirección de entrega es obligatoria para envío a domicilio.' });
    }

    // =================================================================
    // Anti-abuso 1: login obligatorio para métodos sin pago anticipado
    // =================================================================
    // Bizum exige al cliente transferir antes de que el comercio
    // prepare nada (fricción real → poco atractivo para spam). Por el
    // contrario:
    //   • Contra reembolso: el cliente nunca paga si no se presenta o
    //     no recoge. Para abuso masivo es ideal.
    //   • Store pickup: si nadie recoge, el comercio carga con la
    //     merma de los perecederos preparados.
    //
    // Mitigación: exigir cuenta autenticada para estas dos combinaciones.
    // El coste de crear cuentas en cadena (email único, captcha del
    // proveedor de auth) ya filtra el grueso del abuso oportunista.
    // Un atacante motivado todavía puede crear cuentas, pero deja
    // huella (email/uid) para baneo posterior.
    const isContraReembolso = (payment_method || '').toLowerCase().includes('contra');
    const needsAuth = isContraReembolso || isStorePickup;

    if (needsAuth) {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!token) {
        return res.status(401).json({
          error: 'Para esta forma de entrega o pago necesitas iniciar sesión.',
          code: 'AUTH_REQUIRED',
        });
      }
      const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !authUser) {
        return res.status(401).json({
          error: 'Tu sesión ha caducado. Vuelve a iniciar sesión y reintenta.',
          code: 'AUTH_INVALID',
        });
      }
      // Forzamos user_id al del token, ignorando lo que viniera en el
      // body (defensa contra suplantación: aunque el atacante pase
      // user_id falsificado, prevalece el del JWT).
      user_id = authUser.id;
    }

    // =================================================================
    // Anti-abuso 2: límite por teléfono en 24 h
    // =================================================================
    // Independientemente del IP (que el atacante puede rotar con
    // proxies / móvil), si el mismo teléfono ya tiene
    // MAX_UNCOMPLETED_PER_PHONE_24H pedidos sin finalizar, frenamos.
    // Esto cubre el escenario "alguien crea cuentas para saltarse el
    // login obligatorio pero usa siempre el mismo número de teléfono".
    //
    // Tolerante a fallos: si la consulta falla, NO bloqueamos al cliente
    // (preferimos permitir un pedido legítimo que colgar la web por un
    // glitch de Supabase). Solo se bloquea si la consulta tiene éxito
    // y devuelve recuentos superiores al umbral.
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recentSamePhone, error: countErr } = await supabase
        .from('orders')
        .select('id, status')
        .eq('phone', phone)
        .in('status', UNCOMPLETED_ORDER_STATUSES)
        // Los pedidos ya cobrados por Stripe (stripe_payment_intent no
        // nulo) NO cuentan: están pagados, no son riesgo de impago/no-show
        // aunque su status sea 'Procesando'. Sin esto, el propio cliente
        // se autobloquearía tras 2 compras legítimas con tarjeta.
        .is('stripe_payment_intent', null)
        .gte('created_at', since);
      if (!countErr && (recentSamePhone || []).length >= MAX_UNCOMPLETED_PER_PHONE_24H) {
        return res.status(429).json({
          error: 'Tienes pedidos pendientes con este teléfono. Espera a completarlos o contacta con la tienda.',
          code: 'PHONE_PENDING_LIMIT',
        });
      }
      if (countErr) {
        // No tumbamos el pedido, pero dejamos huella para diagnóstico
        // si vemos picos de abuso que pasan el filtro.
        console.warn('[anti-abuse] phone count error:', countErr.message);
      }
    } catch (e) {
      console.warn('[anti-abuse] phone check unexpected:', e?.message || e);
    }

    // =================================================================
    // Venta de alcohol: declaración de mayoría de edad (+18)
    // =================================================================
    // Ley 5/2002 de la Comunidad de Madrid + T&C §2.2: prohibida la
    // venta de bebidas alcohólicas a menores, también a distancia. La
    // detección es autoritativa (catálogo real, no los campos del
    // carrito). Si hay alcohol y el cliente no marcó la casilla,
    // rechazamos con un código que el frontend traduce a su checkbox.
    let ageConfirmedAt = null;
    const hasAlcohol = await orderContainsAlcohol(items);
    if (hasAlcohol) {
      if (age_confirmed !== true) {
        return res.status(400).json({
          error: 'Tu pedido incluye bebidas alcohólicas. Debes confirmar que eres mayor de 18 años para continuar.',
          code: 'AGE_CONFIRMATION_REQUIRED',
        });
      }
      ageConfirmedAt = new Date().toISOString();
    }

    // Para recogida en tienda, normalizamos address a una etiqueta
    // estable que aclara dónde se recoge el pedido. Así los registros
    // antiguos del back-office (tickets PDF, listados) muestran texto
    // legible en lugar de cadena vacía o null. Mantenemos la información
    // dentro de la columna address para no duplicar la lógica de
    // renderizado en cada consumidor del registro.
    const finalAddress = isStorePickup
      ? 'Recogida en tienda — Paseo del Sol 1, 28880 Meco (Madrid)'
      : address;

    // =================================================================
    // Cupón de descuento (validación autoritativa en el servidor)
    // =================================================================
    // `total` recibido = importe SIN descuento (subtotal + envío), igual
    // que siempre. Si hay cupón válido recalculamos el descuento aquí
    // (nunca confiamos en un descuento enviado por el cliente) y el
    // pedido se guarda con el total YA descontado.
    let appliedCoupon = null;
    let discount = 0;
    if (coupon_code) {
      // Identidad verificada por token (no el user_id del body) para que
      // las reglas de cupón (requiresAccount, uso único) no se puedan
      // falsificar pasando un user_id inventado. El frontend (apiClient)
      // adjunta el Bearer token cuando hay sesión, así que un usuario
      // registrado siempre llega identificado aquí.
      const couponUserId = await getVerifiedUserId(req);
      const couponResult = await resolveCouponForOrder(coupon_code, items, { user_id: couponUserId, phone });
      if (!couponResult.ok) {
        return res.status(400).json({
          error: couponErrorMessage(couponResult.reason, couponResult),
          code: 'COUPON_INVALID',
        });
      }
      appliedCoupon = couponResult.code;
      discount = couponResult.discount;
    }
    const finalTotal = Math.max(0, Math.round((Number(total) - discount) * 100) / 100);

    // Normalización defensiva del email (tolerante a typos comunes de
    // mayúsculas/espacios sin romper el pedido si la cadena viene mal).
    const normalizedEmail = typeof customer_email === 'string'
      ? customer_email.trim().toLowerCase()
      : null;
    const hasValidEmail = normalizedEmail && normalizedEmail.includes('@');

    // Deduct stock for products (skip services and gift items).
    // Descuento ATÓMICO (compare-and-swap) para evitar sobreventa cuando
    // dos clientes compran la última unidad casi a la vez.
    for (const item of items) {
      if (item.isService) continue;
      if (item.isGift) continue; // 礼品不扣库存，由后台单独管理

      const qty = Number(item.quantity) || 0;
      if (qty <= 0) continue;

      const r = await adjustStockCas(item.id, -qty, { allowNegative: false });
      if (r.reason === 'NOT_FOUND') {
        console.warn(`[Orders] Product not found: id=${item.id}, name=${item.name}`);
        continue; // 找不到商品时跳过，不阻塞下单
      }
      if (r.reason === 'INSUFFICIENT') {
        console.warn(`[Orders] Insufficient stock: id=${item.id}, name=${item.name}, stock=${r.stock}, requested=${qty}`);
        return res.status(400).json({ error: `Stock insuficiente para "${item.name}". Disponible: ${r.stock}, solicitado: ${qty}.` });
      }
      if (!r.ok) {
        console.error(`[Orders] no se pudo reservar stock (concurrencia) id=${item.id}: ${r.reason}`);
        return res.status(409).json({ error: `No se pudo reservar "${item.name}" por mucha concurrencia. Vuelve a intentarlo.` });
      }
    }

    // Congelar el IVA vigente de cada producto dentro del propio pedido
    // (ver snapshotItemTaxRates) para poder emitir después la factura
    // VeriFactu con el desglose correcto aunque el catálogo cambie luego.
    const itemsForOrder = await snapshotItemTaxRates(items);

    // Create order
    // confirmed_at = now: estos pedidos (efectivo/COD/Bizum manual) son
    // accionables al instante, así que deben disparar la alerta del Admin
    // de inmediato (comportamiento previo a Stripe). Sólo el flujo Stripe
    // ('Esperando pago') deja confirmed_at en NULL hasta cobrar.
    const nowIso = new Date().toISOString();
    const { data, error } = await insertOrderRow({
      user_id: user_id || null,
      address: finalAddress,
      phone,
      note,
      total: finalTotal,
      status: status || 'Procesando',
      payment_method: payment_method || 'Pendiente',
      items: itemsForOrder,
      customer_email: hasValidEmail ? normalizedEmail : null,
      delivery_method: resolvedDeliveryMethod,
      ...(resolvedDeliveryMethod === 'store_pickup' ? { pickup_code: generatePickupCode() } : {}),
      ...(ageConfirmedAt ? { age_confirmed_at: ageConfirmedAt } : {}),
      coupon_code: appliedCoupon,
      discount,
      created_at: nowIso,
      confirmed_at: nowIso
    });

    if (error) throw error;

    const shouldInvoiceNow =
      data.status !== 'Pendiente de Pago' &&
      data.status !== 'Esperando pago' &&
      data.status !== 'Autorizado' &&
      !/contra\s*reembolso/i.test(data.payment_method || '');

    let orderForAftercare = data;
    if (shouldInvoiceNow) {
      if (isFiskalyEnabled()) {
        issueInvoiceBestEffort(data.id, 'pedido creado con cobro manual');
      } else {
        const invoiceResult = await issueInvoiceBestEffort(data.id, 'pedido creado con cobro manual');
        if (invoiceResult?.order) orderForAftercare = invoiceResult.order;
      }
    }

    // 自动打印 ticket（异步执行，不阻塞响应）
    if (process.env.AUTO_PRINT_ENABLED !== 'false') {
      autoPrintTicket(orderForAftercare).catch(err => {
        console.error('Error en auto-impresión:', err);
      });
    }

    // Confirmación por email (asíncrono, best-effort — nunca bloquea ni
    // falla la creación del pedido aunque Resend caiga, el dominio no
    // esté verificado, o el cliente no haya facilitado un email válido).
    if (hasValidEmail) {
      sendOrderConfirmationEmail(orderForAftercare, normalizedEmail).catch((err) => {
        console.error('[Email] Excepción inesperada (no propagada):', err?.message || err);
      });
    } else {
      console.warn(`[Email] Pedido ${orderForAftercare?.id?.slice?.(0, 8) || '?'} sin customer_email válido — skip envío`);
    }

    res.json(orderForAftercare);
  } catch (error) {
    // Pedido que no llegó a guardarse = venta perdida → lo reportamos.
    reportError(error, '[orders] error creando pedido');
    res.status(500).json({ error: error.message });
  }
});

// =====================================================================
// POST /api/checkout/stripe-session — inicia un pago con Stripe
// =====================================================================
// Fase 1 del flujo de pago con tarjeta/Bizum por Stripe:
//   - Corre las mismas defensas anti-abuso que POST /api/orders
//     (turnstile + rate limit por IP + límite por teléfono).
//   - Crea el pedido en estado 'Esperando pago' SIN descontar stock.
//   - Crea una sesión de Checkout (página alojada por Stripe) con las
//     line_items del carrito y metadata.order_id.
//   - Devuelve { url } para que el frontend redirija a Stripe.
//
// La confirmación del pago llega DESPUÉS por webhook (fase 2). NO se
// confía en la success_url como prueba de pago.
//
// A diferencia de contra_reembolso/store_pickup, aquí NO exigimos login:
// el pago es anticipado (la tarjeta se cobra antes de preparar nada),
// así que el riesgo de abuso por impago es nulo. Si hay sesión, la
// vinculamos igualmente (user_id) para el historial del cliente.
app.post('/api/checkout/stripe-session', orderHourlyLimiter, orderDailyLimiter, async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({
        error: 'El pago con tarjeta no está disponible temporalmente. Prueba con Bizum o contacta con la tienda.',
        code: 'STRIPE_DISABLED',
      });
    }

    let {
      user_id,
      address,
      phone,
      note,
      total,
      items,
      customer_email,
      delivery_method,
      turnstile_token,
      coupon_code,
      age_confirmed,
    } = req.body;

    // Anti-abuso 0: Turnstile (permisivo si no hay secret configurado).
    const turnstileResult = await verifyTurnstileToken(turnstile_token, req.ip);
    if (!turnstileResult.ok) {
      console.warn('[stripe] turnstile failed:', turnstileResult.error, 'ip:', req.ip);
      return res.status(403).json({
        error: 'Verificación de seguridad fallida. Recarga la página e inténtalo otra vez.',
        code: 'TURNSTILE_FAILED',
      });
    }

    const resolvedDeliveryMethod = VALID_DELIVERY_METHODS.includes(delivery_method)
      ? delivery_method
      : 'home_delivery';
    const isStorePickup = resolvedDeliveryMethod === 'store_pickup';

    // Validación de campos.
    if (!phone || !total || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Faltan datos del pedido.' });
    }
    if (!isSpanishPhoneOk(phone)) {
      return res.status(400).json({ error: 'Teléfono no válido. Introduce un número español de 9 cifras.' });
    }
    if (!isStorePickup && !address) {
      return res.status(400).json({ error: 'La dirección de entrega es obligatoria para envío a domicilio.' });
    }

    const totalCents = Math.round(Number(total) * 100);
    if (!Number.isFinite(totalCents) || totalCents <= 0) {
      return res.status(400).json({ error: 'Importe del pedido inválido.' });
    }

    // Email obligatorio: Stripe lo usa para el recibo y nosotros para la
    // confirmación transaccional.
    const normalizedEmail = typeof customer_email === 'string'
      ? customer_email.trim().toLowerCase()
      : null;
    const hasValidEmail = normalizedEmail && normalizedEmail.includes('@');
    if (!hasValidEmail) {
      return res.status(400).json({
        error: 'Necesitamos un email válido para el pago y la confirmación.',
        code: 'EMAIL_REQUIRED',
      });
    }

    // Si viene sesión válida, vinculamos user_id (prevalece sobre el body).
    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (bearer) {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser(bearer);
        if (authUser) user_id = authUser.id;
      } catch { /* sesión inválida: seguimos como invitado */ }
    }

    // Anti-abuso 2: límite por teléfono (NO contamos 'Esperando pago':
    // un checkout Stripe abandonado es inofensivo, sin stock descontado).
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recentSamePhone, error: countErr } = await supabase
        .from('orders')
        .select('id')
        .eq('phone', phone)
        .in('status', UNCOMPLETED_ORDER_STATUSES)
        // Excluir pedidos ya cobrados por Stripe (pagados, sin riesgo):
        // de lo contrario 2 compras con tarjeta bloquearían la tercera.
        .is('stripe_payment_intent', null)
        .gte('created_at', since);
      if (!countErr && (recentSamePhone || []).length >= MAX_UNCOMPLETED_PER_PHONE_24H) {
        return res.status(429).json({
          error: 'Tienes pedidos pendientes con este teléfono. Espera a completarlos o contacta con la tienda.',
          code: 'PHONE_PENDING_LIMIT',
        });
      }
    } catch (e) {
      console.warn('[stripe] phone check:', e?.message || e);
    }

    // =================================================================
    // Venta de alcohol: declaración de mayoría de edad (+18)
    // =================================================================
    // Ley 5/2002 de la Comunidad de Madrid + T&C §2.2: prohibida la
    // venta de bebidas alcohólicas a menores, también a distancia. La
    // detección es autoritativa (catálogo real, no los campos del
    // carrito). Si hay alcohol y el cliente no marcó la casilla,
    // rechazamos con un código que el frontend traduce a su checkbox.
    let ageConfirmedAt = null;
    const hasAlcohol = await orderContainsAlcohol(items);
    if (hasAlcohol) {
      if (age_confirmed !== true) {
        return res.status(400).json({
          error: 'Tu pedido incluye bebidas alcohólicas. Debes confirmar que eres mayor de 18 años para continuar.',
          code: 'AGE_CONFIRMATION_REQUIRED',
        });
      }
      ageConfirmedAt = new Date().toISOString();
    }

    const finalAddress = isStorePickup
      ? 'Recogida en tienda — Paseo del Sol 1, 28880 Meco (Madrid)'
      : address;

    // Cupón de descuento (validación autoritativa en el servidor). `total`
    // recibido = importe SIN descuento; recalculamos el descuento aquí y
    // cobramos/guardamos el total ya descontado.
    let appliedCoupon = null;
    let discount = 0;
    if (coupon_code) {
      // Identidad verificada por token (ver nota en POST /api/orders).
      const couponUserId = await getVerifiedUserId(req);
      const couponResult = await resolveCouponForOrder(coupon_code, items, { user_id: couponUserId, phone });
      if (!couponResult.ok) {
        return res.status(400).json({
          error: couponErrorMessage(couponResult.reason, couponResult),
          code: 'COUPON_INVALID',
        });
      }
      appliedCoupon = couponResult.code;
      discount = couponResult.discount;
    }
    const finalTotal = Math.max(0, Math.round((Number(total) - discount) * 100) / 100);

    // Congelar el IVA vigente de cada producto (ver snapshotItemTaxRates),
    // igual que en POST /api/orders: la factura VeriFactu se emitirá a
    // partir de este snapshot, no releyendo el catálogo.
    const itemsForOrder = await snapshotItemTaxRates(items);

    // 1) Crear el pedido en 'Esperando pago' (sin descontar stock).
    const { data: order, error: insErr } = await insertOrderRow({
      user_id: user_id || null,
      address: finalAddress,
      phone,
      note,
      total: finalTotal,
      status: 'Esperando pago',
      payment_method: 'Tarjeta (Stripe)', // provisional; el webhook lo afina al método real
      items: itemsForOrder,
      customer_email: normalizedEmail,
      delivery_method: resolvedDeliveryMethod,
      ...(resolvedDeliveryMethod === 'store_pickup' ? { pickup_code: generatePickupCode() } : {}),
      ...(ageConfirmedAt ? { age_confirmed_at: ageConfirmedAt } : {}),
      coupon_code: appliedCoupon,
      discount,
      created_at: new Date().toISOString(),
    });
    if (insErr) throw insErr;

    // 2) Construir line_items (cuadran exactamente con el total final, ya
    //    con el descuento del cupón aplicado).
    const { line_items } = buildCheckoutLineItems(items, finalTotal);

    // 3) Crear la sesión de Checkout. Fijamos payment_method_types a
    //    ['card', 'bizum'] para mostrar SOLO los métodos que queremos y
    //    evitar que Stripe liste en modo dinámico métodos de otros
    //    países (MB WAY, Satispay, Bancontact, EPS...). 'card' incluye
    //    automáticamente Apple Pay y Google Pay en los dispositivos/
    //    navegadores compatibles. Bizum requiere EUR y cliente en España.
    const frontendUrl = process.env.FRONTEND_URL || 'https://hipera.es';
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'bizum'],
      // Captura manual SÓLO para tarjeta: al pagar se AUTORIZA (retiene) el
      // importe pero no se cobra; el cobro real se hace después desde el
      // panel ("Cobrar") cuando confirmamos stock/preparamos el pedido.
      // Bizum NO admite captura manual, así que se mantiene en captura
      // automática (cobro inmediato) gracias al override por método de pago.
      // ⚠️ La autorización de tarjeta caduca a los ~7 días: hay que cobrar
      //    antes o el banco libera la retención.
      payment_method_options: {
        card: { capture_method: 'manual' },
      },
      line_items,
      locale: 'es',
      customer_email: normalizedEmail,
      client_reference_id: order.id,
      metadata: { order_id: order.id },
      payment_intent_data: { metadata: { order_id: order.id } },
      success_url: `${frontendUrl}/?pago=ok&pedido=${order.id}`,
      cancel_url: `${frontendUrl}/?pago=cancelado&pedido=${order.id}`,
      // Caduca en 1 h (entre el mínimo de 30 min y el máximo de 24 h).
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    });

    // 4) Guardar el session_id en el pedido (reconciliación / depuración).
    await supabase
      .from('orders')
      .update({ stripe_session_id: session.id })
      .eq('id', order.id);

    return res.json({ url: session.url, order_id: order.id });
  } catch (error) {
    reportError(error, '[stripe] error creando sesión de checkout');
    return res.status(500).json({
      error: 'No se pudo iniciar el pago. Inténtalo de nuevo en unos segundos.',
      code: 'STRIPE_SESSION_FAILED',
    });
  }
});

// Identidad y permisos del usuario autenticado.
// Permite al frontend saber si la sesión actual tiene acceso a /admin
// sin exponer la whitelist completa de ADMIN_EMAILS.
app.get('/api/me', authenticateUser, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    isAdmin: isAdminUser(req.user),
  });
});

// Get order by ID (público — lookup por QR del ticket)
//
// Endpoint accesible sin autenticación porque está pensado para que el
// cliente que tiene el QR del ticket consulte el estado de su pedido.
// Por minimización de datos (RGPD Art. 5.1.c) NO se devuelven los
// campos personales `address`, `phone` y `user_id`: el cliente ya
// conoce esos datos (los introdujo él mismo) y, si la URL del pedido
// se compartiera o quedara en el historial del navegador, no se
// expondrían datos identificativos adicionales.
//
// Si el cliente necesita ver la dirección y el teléfono asociados al
// pedido, debe iniciar sesión y consultar GET /api/orders/user/:userId,
// que sí los devuelve completos por estar autenticado.
const PUBLIC_ORDER_FIELDS = [
  'id',
  'status',
  'total',
  'items',
  'payment_method',
  'delivery_method',
  'note',
  'created_at',
  'invoice_full_number',
  'invoice_issued_at',
  'tax_breakdown',
  'verifactu_qr',
].join(',');

app.get('/api/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    const { data, error } = await supabase
      .from('orders')
      .select(PUBLIC_ORDER_FIELDS)
      .eq('id', orderId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user orders (requires auth)
app.get('/api/orders/user/:userId', authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== ADMIN ROUTES (Protected) ==========

// Get all orders (admin only)
app.get('/api/admin/orders', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Polling ligero de pedidos posteriores a un timestamp.
// Diseñado para que el panel admin pueda preguntar "¿hay algo nuevo desde
// la última vez que miré?" cada 20-30s sin descargar todo el histórico.
//
// Query params:
//   ?since=ISO_TIMESTAMP   (obligatorio) sólo devuelve pedidos con
//                          created_at > since.
//   ?limit=N               (opcional, default 50) corta el resultado para
//                          casos patológicos en los que el admin no entra
//                          al panel durante días.
//
// Respuesta:
//   { orders: [...], count: <int>, server_time: <ISO> }
//
// El campo server_time es importante: el admin lo usa como `since` de la
// siguiente llamada, evitando el riesgo de pedir "todo lo posterior a mi
// reloj local" cuando el reloj del cliente y del servidor están
// desincronizados (zonas horarias, drift). Siempre nos basamos en el
// reloj autoritativo del backend.
app.get('/api/admin/orders/new', authenticateAdmin, async (req, res) => {
  try {
    const since = typeof req.query.since === 'string' ? req.query.since : null;
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;

    // Validación defensiva del parámetro `since`: si es inválido o falta,
    // devolvemos lista vacía + server_time. El frontend lo usará como
    // baseline para la siguiente petición sin reportar falsos positivos.
    const sinceMs = since ? Date.parse(since) : NaN;
    const serverTime = new Date().toISOString();
    if (!Number.isFinite(sinceMs)) {
      return res.json({ orders: [], count: 0, server_time: serverTime });
    }

    // Filtramos por confirmed_at (no created_at): un pedido suena cuando
    // se vuelve accionable. Para efectivo/COD/Bizum manual confirmed_at =
    // created_at (instantáneo); para Stripe es el momento del cobro. Así
    // evitamos beeps por checkouts abandonados y no perdemos pagos reales.
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .not('confirmed_at', 'is', null)
      .gt('confirmed_at', new Date(sinceMs).toISOString())
      .order('confirmed_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    res.json({
      orders: data || [],
      count: (data || []).length,
      server_time: serverTime,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cola de impresión del agente de la tienda: routes/print.js
app.use(printRoutes);

// Update order status (admin only)
app.patch('/api/admin/orders/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    // payment_method opcional: permite registrar cómo se cobró un pedido
    // de "pago en tienda" al entregarlo (efectivo / tarjeta TPV), útil
    // para la contabilidad y el CSV. Se acota a una etiqueta corta.
    const paymentMethod = typeof req.body?.payment_method === 'string'
      ? req.body.payment_method.trim().slice(0, 60)
      : null;

    // Si se cancela un pedido AUTORIZADO (retención de tarjeta sin cobrar),
    // liberamos la autorización en Stripe (no se cobra nada al cliente) y
    // reponemos el stock que habíamos reservado en la autorización.
    if (status === 'Cancelado') {
      const { data: prev } = await supabase
        .from('orders')
        .select('status, stripe_payment_intent, items')
        .eq('id', id)
        .single();
      if (prev && prev.status === 'Autorizado' && prev.stripe_payment_intent) {
        const stripe = getStripe();
        if (stripe) {
          try {
            const pi = await stripe.paymentIntents.retrieve(prev.stripe_payment_intent);
            if (pi.status === 'requires_capture') {
              await stripe.paymentIntents.cancel(prev.stripe_payment_intent);
              console.log('[stripe] autorización liberada al cancelar pedido:', id);
            }
          } catch (e) {
            console.warn('[stripe] no se pudo liberar la autorización al cancelar:', e?.message);
          }
        }
        try {
          await restockItems(prev.items || []);
        } catch (e) {
          console.error('[stock] error al reponer stock al cancelar autorizado:', e?.message);
        }
      }
    }

    const updateFields = { status };
    if (paymentMethod) updateFields.payment_method = paymentMethod;
    let { data, error } = await supabase
      .from('orders')
      .update(updateFields)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // 'Entregado' = cobro efectivo de contra reembolso / pago en tienda →
    // momento de la factura. Para pedidos Stripe ya facturados al cobrar,
    // el claim de verifactu_status lo convierte en no-op (idempotente).
    if (status === 'Entregado') {
      if (isFiskalyEnabled()) {
        issueInvoiceBestEffort(id, 'pedido entregado');
      } else {
        const invoiceResult = await issueInvoiceBestEffort(id, 'pedido entregado');
        if (invoiceResult?.order) data = invoiceResult.order;
      }
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/orders/:id/invoice — emite (o REINTENTA) la factura
// de un pedido. Si fiskaly esta configurado, emite VeriFactu. Si no, usa
// la primera version local de factura simplificada. Responde con el
// resultado de la emision y, cuando existe, el pedido actualizado.
app.post('/api/admin/orders/:id/invoice', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const force = req.body?.force === true;
    const issuer = isFiskalyEnabled() ? fiskaly : (isLocalInvoicingEnabled() ? localInvoicing : null);
    if (!issuer) {
      return res.status(503).json({ error: 'La facturación está desactivada (LOCAL_INVOICING_ENABLED=false y sin FISKALY_*)' });
    }
    const result = await issuer.issueInvoiceForOrder(id, { force });
    if (result.ok) return res.json(result);
    if (result.skipped) return res.status(409).json({ error: `No emitida: ${result.skipped}`, ...result });
    if (result.status && result.status >= 400 && result.status < 500) {
      return res.status(result.status).json({ error: result.error || 'No se puede emitir factura', ...result });
    }
    return res.status(500).json({ error: result.error || 'Emisión fallida', ...result });
  } catch (error) {
    reportError(error, '[invoice] reintento manual falló');
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/orders/:id/capture — cobra (captura) una autorización de
// tarjeta de un pedido "Autorizado". Hasta ahora sólo se había RETENIDO el
// importe; esto lo cobra de verdad y pasa el pedido a "Procesando".
app.post('/api/admin/orders/:id/capture', authenticateAdmin, async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: 'Stripe no está configurado' });

    const { id } = req.params;
    const { data: order, error: fErr } = await supabase
      .from('orders')
      .select('id, status, stripe_payment_intent')
      .eq('id', id)
      .single();
    if (fErr || !order) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (!order.stripe_payment_intent) {
      return res.status(400).json({ error: 'Este pedido no tiene un pago de Stripe que cobrar' });
    }

    const pi = await stripe.paymentIntents.retrieve(order.stripe_payment_intent);

    // Ya cobrado (p.ej. doble clic o reintento): sincronizamos el estado.
    if (pi.status === 'succeeded') {
      if (order.status === 'Autorizado') {
        await supabase.from('orders').update({ status: 'Procesando' }).eq('id', id);
      }
      if (isFiskalyEnabled()) {
        issueInvoiceBestEffort(id, 'captura ya realizada'); // idempotente si ya facturó
      } else {
        await issueInvoiceBestEffort(id, 'captura ya realizada');
      }
      return res.json({ ok: true, alreadyCaptured: true });
    }

    if (pi.status !== 'requires_capture') {
      return res.status(400).json({
        error: `No se puede cobrar: el pago está en estado "${pi.status}". Es posible que la autorización haya caducado (las retenciones de tarjeta caducan a los ~7 días).`,
      });
    }

    await stripe.paymentIntents.capture(order.stripe_payment_intent);
    let { data, error: uErr } = await supabase
      .from('orders')
      .update({ status: 'Procesando' })
      .eq('id', id)
      .select()
      .single();
    if (uErr) throw uErr;

    // El dinero acaba de moverse de verdad → momento de la factura.
    if (isFiskalyEnabled()) {
      issueInvoiceBestEffort(id, 'captura de autorización');
    } else {
      const invoiceResult = await issueInvoiceBestEffort(id, 'captura de autorización');
      if (invoiceResult?.order) data = invoiceResult.order;
    }

    console.log('[stripe] pago cobrado (capturado) para pedido:', id);
    return res.json({ ok: true, order: data });
  } catch (error) {
    console.error('[stripe] error capturando pago:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Error al cobrar el pedido' });
  }
});

// Enlaces wa.me pre-rellenados: services/whatsapp.js

// POST /api/admin/orders/:id/refund — reembolsa un pedido de Stripe.
//   • Reembolso TOTAL (por defecto): devuelve todo / libera la retención,
//     marca "Cancelado" y repone TODO el stock.
//   • Reembolso PARCIAL (body.partial + body.items): devuelve sólo los
//     artículos indicados, repone SÓLO ese stock y NO cambia el estado
//     del pedido (sigue válido salvo lo devuelto).
// En ambos casos envía email al cliente con el motivo y devuelve un enlace
// de WhatsApp pre-rellenado para avisar con un toque.
app.post('/api/admin/orders/:id/refund', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const reason = typeof req.body?.reason === 'string'
      ? req.body.reason.trim().slice(0, 500)
      : '';

    const { data: order, error: fErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();
    if (fErr || !order) return res.status(404).json({ error: 'Pedido no encontrado' });

    if (order.status === 'Cancelado') {
      return res.status(400).json({ error: 'Este pedido ya está cancelado' });
    }

    const stripe = getStripe();

    // ---- Reembolso PARCIAL (por artículos devueltos) ----
    const selItems = Array.isArray(req.body?.items) ? req.body.items : null;
    const isPartial = req.body?.partial === true && selItems && selItems.length > 0;
    if (isPartial) {
      if (!order.stripe_payment_intent) {
        return res.status(400).json({ error: 'Este pedido no tiene un pago online que reembolsar parcialmente' });
      }
      if (!stripe) return res.status(503).json({ error: 'Stripe no está configurado' });

      const orderItems = Array.isArray(order.items) ? order.items : [];
      let cents = 0;
      const refundedDetail = [];
      for (const sel of selItems) {
        const idx = Number(sel?.index);
        const qty = Math.floor(Number(sel?.quantity));
        if (!Number.isInteger(idx) || idx < 0 || idx >= orderItems.length) continue;
        if (!Number.isFinite(qty) || qty <= 0) continue;
        const item = orderItems[idx];
        const orderedQty = Math.floor(Number(item?.quantity) || 0);
        const useQty = Math.min(qty, orderedQty);
        if (useQty <= 0) continue;
        const price = Number(item?.price) || 0;
        cents += Math.round(price * useQty * 100);
        refundedDetail.push({ ...item, quantity: useQty });
      }
      if (cents <= 0 || refundedDetail.length === 0) {
        return res.status(400).json({ error: 'Selecciona al menos un artículo (con cantidad válida) a devolver' });
      }

      let pi;
      try {
        pi = await stripe.paymentIntents.retrieve(order.stripe_payment_intent, { expand: ['latest_charge'] });
      } catch (e) {
        return res.status(502).json({ error: 'No se pudo consultar el pago en Stripe: ' + (e?.message || '') });
      }
      if (pi.status !== 'succeeded') {
        return res.status(400).json({ error: 'El reembolso parcial sólo es posible en pedidos ya cobrados. Cobra primero el pedido o usa el reembolso total.' });
      }
      // Stripe es la fuente de verdad del importe reembolsable: evita
      // sobre-reembolsar aunque se hagan varias devoluciones parciales.
      const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
      const captured = Number(charge?.amount_captured ?? charge?.amount ?? pi.amount_received ?? 0);
      const already = Number(charge?.amount_refunded ?? 0);
      const refundable = captured - already;
      if (cents > refundable) {
        return res.status(400).json({
          error: `El importe a reembolsar (${(cents / 100).toFixed(2)} €) supera lo que queda por reembolsar (${(refundable / 100).toFixed(2)} €).`,
        });
      }

      try {
        await stripe.refunds.create({ payment_intent: order.stripe_payment_intent, amount: cents });
      } catch (e) {
        console.error('[stripe] error en reembolso parcial:', e?.message || e);
        return res.status(502).json({ error: 'Stripe rechazó el reembolso parcial: ' + (e?.message || '') });
      }
      console.log(`[stripe] reembolso PARCIAL emitido (panel): ${id} · ${(cents / 100).toFixed(2)} €`);

      // Reponer SÓLO los artículos devueltos. El estado del pedido NO
      // cambia (sigue válido salvo lo devuelto), así que charge.refunded
      // (parcial) tampoco lo cancela.
      try {
        await restockItems(refundedDetail);
      } catch (e) {
        console.error('[stock] error al reponer stock (reembolso parcial):', e?.message);
      }

      const amount = cents / 100;
      if (order.customer_email) {
        sendRefundEmail(order, order.customer_email, {
          reason, refundType: 'partial', refundedItems: refundedDetail, refundedAmount: amount,
        }).catch((err) => console.warn('[Email] fallo email reembolso parcial:', err?.message || err));
      }
      const waLink = buildRefundWhatsappLink(order, reason, 'partial', amount);
      return res.json({ ok: true, refundType: 'partial', amount, waLink, emailed: !!order.customer_email });
    }

    // ---- Reembolso TOTAL / liberación de retención ----
    let refundType = 'cancelled'; // por defecto: pedido sin pago online

    if (order.stripe_payment_intent) {
      if (!stripe) return res.status(503).json({ error: 'Stripe no está configurado' });
      try {
        const pi = await stripe.paymentIntents.retrieve(order.stripe_payment_intent);
        if (pi.status === 'requires_capture') {
          // Sólo autorizado, nunca cobrado → cancelar libera la retención.
          await stripe.paymentIntents.cancel(order.stripe_payment_intent);
          refundType = 'released';
          console.log('[stripe] retención liberada (reembolso desde panel):', id);
        } else if (pi.status === 'succeeded') {
          await stripe.refunds.create({ payment_intent: order.stripe_payment_intent });
          refundType = 'refunded';
          console.log('[stripe] reembolso total emitido (panel):', id);
        } else if (pi.status === 'canceled') {
          refundType = 'released'; // ya estaba liberado en Stripe
        } else {
          return res.status(400).json({
            error: `No se puede reembolsar: el pago está en estado "${pi.status}".`,
          });
        }
      } catch (e) {
        console.error('[stripe] error al reembolsar:', e?.message || e);
        return res.status(502).json({
          error: 'Stripe rechazó la operación: ' + (e?.message || 'error desconocido'),
        });
      }
    }

    // Marcar "Cancelado" con CLAIM ATÓMICO (.neq('status','Cancelado')):
    // reponemos stock SÓLO si esta petición es la que transiciona el
    // pedido. Si el webhook (charge.refunded / payment_intent.canceled) ya
    // lo canceló y repuso en la carrera, aquí afecta 0 filas y NO
    // reponemos otra vez.
    const { data: claimedRows, error: uErr } = await supabase
      .from('orders')
      .update({ status: 'Cancelado' })
      .eq('id', id)
      .neq('status', 'Cancelado')
      .select();
    if (uErr) throw uErr;
    const updated = (claimedRows && claimedRows[0]) || { ...order, status: 'Cancelado' };

    if (claimedRows && claimedRows.length === 1) {
      try {
        await restockItems(order.items || []);
      } catch (e) {
        console.error('[stock] error al reponer stock tras reembolso:', e?.message);
      }
    } else {
      console.log('[refund] pedido ya cancelado por webhook (no se repone stock de nuevo):', id);
    }

    // Email al cliente con el motivo + qué esperar del dinero (best-effort).
    if (order.customer_email) {
      sendRefundEmail(updated, order.customer_email, { reason, refundType }).catch((err) => {
        console.warn('[Email] fallo enviando email de reembolso:', err?.message || err);
      });
    }

    const waLink = buildRefundWhatsappLink(order, reason, refundType);
    return res.json({ ok: true, order: updated, refundType, waLink, emailed: !!order.customer_email });
  } catch (error) {
    console.error('[refund] error:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Error al reembolsar el pedido' });
  }
});

// POST /api/admin/orders/:id/notify-ready — avisa al cliente de que su
// pedido de RECOGIDA EN TIENDA está preparado. Marca el pedido como
// "Listo para recoger", envía email con el código de recogida (comprobante
// para identificarse en el mostrador) y devuelve un enlace de WhatsApp
// pre-rellenado para avisar con un toque.
app.post('/api/admin/orders/:id/notify-ready', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: order, error: fErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();
    if (fErr || !order) return res.status(404).json({ error: 'Pedido no encontrado' });

    if (order.delivery_method !== 'store_pickup') {
      return res.status(400).json({ error: 'Solo los pedidos de recogida en tienda se pueden marcar como listos' });
    }
    if (order.status === 'Cancelado') {
      return res.status(400).json({ error: 'Este pedido está cancelado' });
    }

    // Si por algún motivo un pedido de recogida no tiene código aún
    // (datos previos a la columna pickup_code), genera y persiste uno
    // aleatorio para que el aviso y el ticket sean coherentes en adelante.
    let code = order.pickup_code;
    if (!code) {
      code = generatePickupCode();
      const { error: codeErr } = await supabase.from('orders').update({ pickup_code: code }).eq('id', id);
      if (codeErr) { code = resolvePickupCode(order); } // fallback determinista si la columna no existe
      else { order.pickup_code = code; }
    }

    // Marca como "Listo para recoger" (salvo que ya esté entregado/cancelado).
    let updated = order;
    if (order.status !== 'Entregado') {
      const { data, error: uErr } = await supabase
        .from('orders')
        .update({ status: 'Listo para recoger' })
        .eq('id', id)
        .neq('status', 'Cancelado')
        .select()
        .single();
      if (!uErr && data) updated = data;
    }

    // Email best-effort con el código de recogida.
    let emailed = false;
    if (order.customer_email) {
      emailed = true;
      sendPickupReadyEmail(updated, order.customer_email, { code }).catch((err) => {
        console.warn('[Email] fallo enviando aviso "listo para recoger":', err?.message || err);
      });
    }

    const waLink = buildPickupReadyWhatsappLink(order, code);
    return res.json({ ok: true, order: updated, code, waLink, emailed });
  } catch (error) {
    console.error('[notify-ready] error:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Error al avisar al cliente' });
  }
});

// Gestión del catálogo (admin): routes/adminCatalog.js
app.use(adminCatalogRoutes);

// Herramientas de imagen del panel (IA): routes/adminImages.js
app.use(adminImageRoutes);

// Root route - API information
app.get('/', (req, res) => {
  res.json({
    message: 'HIPERA Backend API Server',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      public: {
        products: 'GET /api/products',
        categories: 'GET /api/categories',
        subCategories: 'GET /api/sub-categories',
        repairServices: 'GET /api/repair-services',
        createOrder: 'POST /api/orders'
      },
      admin: {
        orders: 'GET /api/admin/orders',
        getOrderById: 'GET /api/orders/:orderId (public)',
        updateOrder: 'PATCH /api/admin/orders/:id',
        products: 'POST /api/admin/products, PUT /api/admin/products/:id, DELETE /api/admin/products/:id',
        categories: 'POST /api/admin/categories, DELETE /api/admin/categories/:id',
        repairServices: 'POST /api/admin/repair-services, PUT /api/admin/repair-services/:id, DELETE /api/admin/repair-services/:id',
        removeBg: 'POST /api/admin/remove-bg',
        generateDescription: 'POST /api/admin/generate-description',
        centerProduct: 'POST /api/admin/center-product'
      }
    },
    note: 'All admin endpoints require authentication (Bearer token)'
  });
});

// El health check vive arriba (justo tras crear el cliente de Supabase):
// `GET /api/health` hace una consulta real a la BD y devuelve 500 si el
// entorno está roto, ideal para el monitor de uptime. Express usa la
// PRIMERA ruta registrada, así que aquí no se duplica.

// Manejador de errores de Sentry: captura cualquier excepción que SÍ se
// propague por Express (rutas sin try/catch propio o errores lanzados por
// middleware). Debe registrarse DESPUÉS de todas las rutas. Los handlers
// que ya capturan su propio error usan reportError() directamente.
attachSentryErrorHandler(app);

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
  console.log(`📡 API available at http://localhost:${PORT}/api`);
  console.log(`📖 API info at http://localhost:${PORT}/`);
});
