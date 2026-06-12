import express from 'express';
import * as Sentry from '@sentry/node';
import dotenv from 'dotenv';
import FormData from 'form-data';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { Blob } from 'buffer';
import sharp from 'sharp';
import { jsPDF } from 'jspdf'; // named import: el default es un objeto, no el constructor (rompe `new jsPDF`)
import QRCode from 'qrcode';
import printer from 'pdf-to-printer';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { platform } from 'os';
import { randomInt } from 'crypto';
import { sendOrderConfirmationEmail, sendRefundEmail, sendPickupReadyEmail, pickupCode, sendRepairBookingNotification } from './services/email.js';

// Código de recogida ALEATORIO de 6 dígitos (independiente del id del
// pedido). Se almacena en orders.pickup_code para pedidos de recogida en
// tienda. Es el comprobante que el cliente presenta en el mostrador.
// Para pedidos antiguos sin este valor, el código cae al cálculo
// determinista pickupCode(id) como fallback (ver email.js).
const generatePickupCode = () => String(randomInt(0, 1000000)).padStart(6, '0');

// Devuelve el código de recogida efectivo de un pedido: el aleatorio
// almacenado si existe, o el determinista a partir del id como fallback
// (compatibilidad con pedidos previos a la columna pickup_code).
const resolvePickupCode = (order) => order?.pickup_code || pickupCode(order?.id);
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

dotenv.config();

// =====================================================================
// Sentry — monitorización de errores (opcional, gated por env)
// =====================================================================
// Sólo se activa si SENTRY_DSN está definido en el entorno; sin DSN es un
// no-op total (no se envía nada, no añade latencia). Configurado como
// monitor de errores PURO: tracesSampleRate 0 (sin trazas de rendimiento,
// que es lo que abulta la factura) y sendDefaultPii false (no adjuntamos
// IP ni datos del cliente). Objetivo: enterarse de las caídas que más
// cuestan en una tienda de una persona —proceso muerto, fallo silencioso
// del webhook de Stripe— aunque ocurran de madrugada.
const SENTRY_ENABLED = !!process.env.SENTRY_DSN;
if (SENTRY_ENABLED) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
  console.log('[Sentry] monitorización de errores activada');
}

// reportError — registra en consola y, si Sentry está activo, lo envía.
// Centraliza el patrón para los catch críticos sin acoplar el resto del
// código a Sentry (función hoisted → usable en los handlers de más abajo).
function reportError(err, context) {
  if (context) console.error(context, err?.message || err);
  else console.error(err?.message || err);
  if (SENTRY_ENABLED) {
    Sentry.captureException(err, context ? { extra: { context } } : undefined);
  }
}

// Red de seguridad a nivel de proceso: una excepción no capturada o una
// promesa rechazada sin manejar tumban el servidor en Railway. Las
// reportamos antes de salir para enterarnos del porqué.
process.on('uncaughtException', (err) => {
  reportError(err, '[fatal] uncaughtException');
  if (SENTRY_ENABLED) Sentry.flush(2000).finally(() => process.exit(1));
  else process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  reportError(reason, '[fatal] unhandledRejection');
});

const app = express();
const PORT = process.env.PORT || 3001;

// 生成 80mm 热敏小票 PDF（用于自动打印）
const generateTicketPDF = async (order) => {
  const isService = order.items?.some(i => i.isService);
  const companyData = {
    name: "QIANG GUO SL",
    address: "Paseo del Sol 1, 28880 Meco",
    nif: "B86126638",
    phone: "+34 918 782 602"
  };

  // 生成二维码 - 包含可访问的URL链接
  // 构建订单查询URL（前端地址 + 订单ID）
  const frontendUrl = process.env.FRONTEND_URL || 'https://hipera.es';
  const orderQueryUrl = `${frontendUrl}/?order=${order.id}`;
  const qrCodeUrl = await QRCode.toDataURL(orderQueryUrl, {
    errorCorrectionLevel: 'H', // 高纠错级别，确保打印后仍可扫描
    type: 'image/png',
    quality: 1.0,
    margin: 2,
    width: 300, // 增加分辨率，确保打印清晰
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    }
  });

  // 创建 80mm 宽度的小票（约 226px = 80mm at 72 DPI）
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [80, 200] // 80mm 宽度，高度自动调整
  });

  const centerX = 40; // 80mm / 2
  let y = 5;

  // Header
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(companyData.name, centerX, y, { align: 'center' });
  y += 5;
  
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(companyData.address, centerX, y, { align: 'center' });
  y += 4;
  doc.text(`NIF: ${companyData.nif}`, centerX, y, { align: 'center' });
  y += 4;
  doc.text(`Tel: ${companyData.phone}`, centerX, y, { align: 'center' });
  y += 6;

  // Divider
  doc.setLineWidth(0.5);
  doc.line(5, y, 75, y);
  y += 5;

  // Order Info
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(isService ? "RESGUARDO REPARACION" : "JUSTIFICANTE DE PEDIDO", centerX, y, { align: 'center' });
  y += 5;
  
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(`Pedido: ${order.id.slice(0, 8).toUpperCase()}`, centerX, y, { align: 'center' });
  y += 4;
  doc.text(`Fecha: ${new Date(order.created_at).toLocaleDateString('es-ES')}`, centerX, y, { align: 'center' });
  y += 4;
  doc.text(`Hora: ${new Date(order.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`, centerX, y, { align: 'center' });
  y += 6;

  // Client Info
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("CLIENTE:", 5, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.text(order.address || "Cliente General", 5, y, { maxWidth: 70 });
  y += 4;
  doc.text(order.phone || "", 5, y);
  y += 6;

  // Divider
  doc.line(5, y, 75, y);
  y += 5;

  // Items Table
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("ARTICULO", 5, y);
  doc.text("CANT", 50, y);
  doc.text("TOTAL", 65, y);
  y += 4;
  doc.line(5, y, 75, y);
  y += 3;

  doc.setFont("helvetica", "normal");
  order.items?.forEach(item => {
    const itemTotal = (item.price * item.quantity).toFixed(2);
    const itemName = item.name.length > 25 ? item.name.substring(0, 22) + '...' : item.name;
    doc.text(itemName, 5, y, { maxWidth: 43 });
    const nameHeight = doc.getTextDimensions(itemName, { maxWidth: 43 }).h;
    doc.text(`${item.quantity}x`, 50, y);
    doc.text(`€${itemTotal}`, 65, y);
    y += Math.max(nameHeight + 1, 4);
  });

  y += 3;
  doc.line(5, y, 75, y);
  y += 4;

  // Total
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(`TOTAL: €${order.total?.toFixed(2) || '0.00'}`, centerX, y, { align: 'center' });
  y += 5;
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.text(`Precios con impuestos incluidos si corresponde.`, centerX, y, { align: 'center' });
  y += 4;
  doc.text(`No valido como factura fiscal.`, centerX, y, { align: 'center' });
  y += 5;

  // Payment Method
  doc.setFontSize(8);
  doc.text(`Pago: ${order.payment_method?.toUpperCase() || 'Efectivo/Bizum'}`, centerX, y, { align: 'center' });
  y += 6;

  // Aviso de COBRO PENDIENTE: los pedidos de pago en tienda / contra
  // reembolso aún NO están pagados (status "Pendiente de Pago"). Se
  // destaca para que el personal cobre antes de entregar la mercancía.
  const isUnpaidCounter = order.status === 'Pendiente de Pago'
    || /contra\s*reembolso/i.test(order.payment_method || '');
  if (isUnpaidCounter) {
    doc.setLineWidth(0.8);
    doc.rect(5, y - 1, 70, 13);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("PENDIENTE DE COBRO", centerX, y + 3, { align: 'center' });
    doc.setFontSize(11);
    doc.text(`COBRAR: €${order.total?.toFixed(2) || '0.00'}`, centerX, y + 9, { align: 'center' });
    doc.setLineWidth(0.5);
    y += 16;
    doc.setFont("helvetica", "normal");
  }

  // Código de recogida (solo pedidos de recogida en tienda). Destacado
  // para que el personal de mostrador lo compare con el que enseña el
  // cliente (mismo número que recibe por email/WhatsApp).
  if (order.delivery_method === 'store_pickup') {
    doc.line(5, y, 75, y);
    y += 5;
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("RECOGIDA EN TIENDA", centerX, y, { align: 'center' });
    y += 4;
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.text("Codigo de recogida:", centerX, y, { align: 'center' });
    y += 6;
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(resolvePickupCode(order), centerX, y, { align: 'center' });
    y += 6;
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    doc.text("Verificar: pedir tel./nombre del cliente", centerX, y, { align: 'center' });
    y += 5;
    doc.line(5, y, 75, y);
    y += 5;
  }

  // Warranty Note (for services)
  if (isService) {
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.text("GARANTIA DE REPARACION: 6 MESES", centerX, y, { align: 'center' });
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.text("Imprescindible presentar este ticket", centerX, y, { align: 'center' });
    y += 6;
  }

  // QR Code - 确保足够大且清晰
  // 在80mm宽度的小票上，二维码应该至少30mm x 30mm才能清晰扫描
  const qrSize = 30; // 30mm x 30mm
  const qrX = (80 - qrSize) / 2; // 居中
  doc.addImage(qrCodeUrl, 'PNG', qrX, y, qrSize, qrSize);
  y += qrSize + 5;

  // Footer
  doc.setFontSize(8);
  doc.text("¡Gracias por su visita!", centerX, y, { align: 'center' });

  return doc;
};

// 自动打印 ticket
const autoPrintTicket = async (order) => {
  try {
    // 生成 PDF
    const doc = await generateTicketPDF(order);
    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
    
    // 保存到临时文件
    const tempPath = join(tmpdir(), `ticket_${order.id.slice(0, 8)}_${Date.now()}.pdf`);
    await writeFile(tempPath, pdfBuffer);

    // pdf-to-printer 主要支持 Windows，其他平台可能需要不同方案
    const isWindows = platform() === 'win32';
    
    if (isWindows) {
      // Windows: 尝试自动打印
      const printerName = process.env.PRINTER_NAME || undefined;
      try {
        await printer.print(tempPath, {
          printer: printerName,
          pages: '1',
        });
        console.log(`✅ Ticket impreso automáticamente para pedido ${order.id.slice(0, 8)}`);
        // 打印成功后，可以选择删除临时文件
        // await unlink(tempPath);
      } catch (printError) {
        console.warn(`⚠️ No se pudo imprimir automáticamente: ${printError.message}`);
        console.log(`📄 PDF guardado en: ${tempPath} (puede imprimirse manualmente)`);
      }
    } else {
      // Linux/Mac: 保存PDF，可以手动打印或配置CUPS
      console.log(`📄 Ticket PDF generado para pedido ${order.id.slice(0, 8)}`);
      console.log(`📁 Ubicación: ${tempPath}`);
      console.log(`💡 En Linux/Mac, puede usar: lp ${tempPath} o configurar CUPS`);
    }
    
    return { success: true, pdfPath: tempPath };
  } catch (error) {
    console.error('Error al generar/imprimir ticket:', error);
    return { success: false, error: error.message };
  }
};

// Trust proxy (needed for Railway/reverse proxy setups)
app.set('trust proxy', true);

// CORS: valid header values only (Chrome rejects invalid tokens in Allow-Headers).
// El dominio canónico desde 2026-05-25 es https://hipera.es (Cloudflare DNS +
// Vercel Domains). El alias técnico https://hipera-shop.vercel.app sigue activo
// y se acepta como origen para no romper despliegues de preview ni accesos
// directos al deploy de Vercel.
const CORS_ALLOW_ORIGIN = 'https://hipera.es';
const CORS_ALLOW_HEADERS = 'Content-Type, Authorization, Accept';

app.use((req, res, next) => {
  const raw = (req.headers.origin || '').trim();
  const validOrigin = raw && raw !== 'null' && /^https?:\/\//.test(raw) ? raw : CORS_ALLOW_ORIGIN;
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

// Initialize Supabase with service role key (server-side only)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
const fiskaly = createFiskalyService({ supabase, reportError });

function issueInvoiceBestEffort(orderId, trigger) {
  if (!isFiskalyEnabled()) return;
  fiskaly.issueInvoiceForOrder(orderId).catch((e) => {
    reportError(e, `[fiskaly] emisión falló (${trigger}) pedido ${orderId}`);
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

// Rate limiting: skip OPTIONS + /api/health (keep-alive). Límite alto: proxy/Vercel agrupa IPs.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS' || req.path === '/health',
  validate: { trustProxy: false }
});
app.use('/api/', limiter);

// =====================================================================
// Anti-abuso: rate limits específicos para POST /api/orders
// =====================================================================
// El limiter global (500/15min) cubre tráfico normal de navegación
// (productos, banners, polling del admin). Para la creación de
// pedidos aplicamos límites mucho más estrictos porque cada pedido:
//   • Descuenta stock real (denial of inventory para clientes
//     legítimos si alguien spammea pedidos falsos).
//   • Reserva esfuerzo operativo del comercio (preparar, llamar,
//     atender la recogida o entrega).
//   • Puede involucrar productos perecederos cuya preparación
//     temprana se traduce en mermas.
//
// Dos ventanas en serie para cubrir tanto ráfagas cortas como
// volumen sostenido. Si una IP se pasa de cualquiera de las dos,
// los siguientes intentos reciben 429 con un mensaje explícito.
// El handler de respuesta personalizado evita que express-rate-limit
// devuelva el string genérico (que el frontend renderizaría como
// JSON malformado en el toast).
//
// IMPORTANTE: usamos `req.ip` derivado de `trust proxy = true`
// configurado arriba, así que la IP es la del cliente real, no la
// del proxy de Railway. Sin trust proxy, todas las peticiones
// vendrían del mismo IP del proxy y colapsaríamos todo el tráfico
// como si fuera un único atacante.
const orderHourlyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,                   // máx 5 pedidos por IP por hora
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  validate: { trustProxy: false },
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Demasiados pedidos desde esta IP en poco tiempo. Espera unos minutos e inténtalo de nuevo.',
      code: 'RATE_LIMIT_HOURLY',
    });
  },
});

const orderDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 h
  max: 12,                       // máx 12 pedidos por IP por día
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  validate: { trustProxy: false },
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Has alcanzado el límite diario de pedidos. Contacta con la tienda si necesitas más.',
      code: 'RATE_LIMIT_DAILY',
    });
  },
});

// Límite para solicitudes de cita de reparación (separado del de pedidos
// para no mezclar contadores). Anti-spam suave: una persona normal no
// pide más de unas pocas citas por hora.
const repairBookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  validate: { trustProxy: false },
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Demasiadas solicitudes de cita desde esta conexión. Espera unos minutos o llámanos.',
      code: 'RATE_LIMIT_HOURLY',
    });
  },
});

// =====================================================================
// Cloudflare Turnstile — verificación de token
// =====================================================================
// Captcha invisible que protege POST /api/orders de bots. El widget se
// monta en el checkout (src/components/TurnstileGate.jsx) y devuelve
// un token a Cloudflare. Aquí lo verificamos contra siteverify; si la
// respuesta no es success=true, rechazamos el pedido con 403.
//
// Comportamiento sin configurar:
//   Si TURNSTILE_SECRET_KEY no está definido, devolvemos true (modo
//   permisivo) para que el desarrollo local funcione sin claves. En
//   producción la variable debe estar presente o todos los pedidos
//   pasarán sin verificación. README_BACKEND_SETUP documenta cómo
//   obtener las claves desde dash.cloudflare.com/?to=/:account/turnstile.
//
// Test secret de Cloudflare (siempre acepta, NO usar en producción):
//   1x0000000000000000000000000000000AA
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY || '';
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function verifyTurnstileToken(token, remoteip) {
  if (!TURNSTILE_SECRET) {
    // Modo permisivo: no exigimos token si el backend no tiene secret.
    return { ok: true, skipped: true };
  }
  if (!token || typeof token !== 'string') {
    return { ok: false, error: 'missing-token' };
  }
  try {
    const params = new URLSearchParams();
    params.set('secret', TURNSTILE_SECRET);
    params.set('response', token);
    if (remoteip) params.set('remoteip', remoteip);
    const resp = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!resp.ok) {
      return { ok: false, error: `siteverify-http-${resp.status}` };
    }
    const data = await resp.json();
    if (data && data.success) return { ok: true };
    // Devolvemos los códigos de error de Cloudflare para diagnóstico.
    // Lista: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/#error-codes
    return { ok: false, error: (data['error-codes'] || []).join(',') || 'unknown' };
  } catch (e) {
    return { ok: false, error: `network: ${e?.message || e}` };
  }
}

// =====================================================================
// Authentication & authorization
// =====================================================================
// Historia previa: el middleware authenticateAdmin sólo verificaba que
// el JWT de Supabase fuera válido, pero NO comprobaba el rol del
// usuario. Combinado con /register público (main.jsx), cualquier
// persona podía crearse una cuenta, obtener un JWT y consumir todos
// los endpoints /api/admin/*. Esto se corrigió el 2026-05-25 añadiendo
// una whitelist de emails de administrador parametrizada por entorno.
//
// Configuración (variable obligatoria en producción):
//   ADMIN_EMAILS=email1@dominio.com,email2@dominio.com
//
// Sin la variable definida, NO se concede acceso administrativo a
// nadie (fail closed). El endpoint /api/me permite al frontend
// consultar si el usuario autenticado actual está en la whitelist
// (para mostrar/ocultar /admin) sin filtrar el listado completo.
// =====================================================================

const parseAdminEmails = () => {
  const raw = process.env.ADMIN_EMAILS || '';
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
};

const isAdminUser = (user) => {
  const list = parseAdminEmails();
  if (list.length === 0) return false;
  const email = (user?.email || '').trim().toLowerCase();
  if (!email) return false;
  return list.includes(email);
};

// Aviso de arranque si la whitelist está vacía en producción.
if (process.env.NODE_ENV === 'production' && parseAdminEmails().length === 0) {
  console.warn(
    '[Auth] ⚠️ ADMIN_EMAILS no está configurada. Todos los endpoints ' +
    '/api/admin/* y /admin del frontend devolverán 403. Configura ' +
    'ADMIN_EMAILS=email1,email2 en las variables de entorno del servidor ' +
    'antes de intentar acceder al panel.'
  );
}

// Validación de JWT (no exige rol). Usado por /api/me y compuesto por
// authenticateAdmin para añadir comprobación de whitelist.
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return res.status(401).json({ error: 'Token no enviado. Cierra sesión y vuelve a iniciar sesión en /login' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error) {
      console.warn('[Auth] getUser error:', error.message);
      return res.status(401).json({ error: 'Token inválido o expirado. Cierra sesión y vuelve a iniciar sesión' });
    }
    if (!user) {
      return res.status(401).json({ error: 'Sesión no válida. Vuelve a iniciar sesión' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.warn('[Auth] Exception:', err?.message);
    res.status(401).json({ error: 'Error de autenticación. Intenta cerrar sesión y volver a entrar' });
  }
};

// Validación de JWT + whitelist de email. Para endpoints administrativos.
const authenticateAdmin = (req, res, next) => {
  authenticateUser(req, res, (err) => {
    if (err) return next(err);
    if (!isAdminUser(req.user)) {
      console.warn(`[Auth] Acceso admin denegado para email=${req.user?.email || '(sin email)'}`);
      return res.status(403).json({
        error: 'Acceso denegado: la cuenta no tiene permisos de administrador.',
      });
    }
    next();
  });
};

// =====================================================================
// Autenticación del AGENTE DE IMPRESIÓN (PC de la tienda)
// =====================================================================
// El agente de impresión es un proceso headless en el PC de la tienda;
// NO puede hacer login interactivo (no hay JWT de Supabase). Se
// autentica con un token compartido en la cabecera X-Print-Token,
// comparado contra PRINT_AGENT_TOKEN del entorno (Railway).
//
// Por qué un token propio y no el JWT admin:
//   - El agente corre 24/7 sin persona delante; un JWT caduca.
//   - Mantiene el secreto del PC de la tienda acotado a SOLO imprimir
//     (no da acceso al panel admin ni a Supabase directamente).
//
// Sin PRINT_AGENT_TOKEN configurado → 503 (las rutas de impresión
// quedan deshabilitadas; el resto del backend sigue igual).
const authenticatePrintAgent = (req, res, next) => {
  const expected = process.env.PRINT_AGENT_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'Impresión no configurada (falta PRINT_AGENT_TOKEN).' });
  }
  const provided = req.headers['x-print-token'];
  if (!provided || provided !== expected) {
    console.warn('[print] token inválido o ausente desde IP', req.ip);
    return res.status(401).json({ error: 'Token de impresión inválido.' });
  }
  next();
};

// ========== PUBLIC ROUTES (Frontend) ==========

// Get products (public) - solo productos visibles en tienda
app.get('/api/products', async (req, res) => {
  try {
    const productFields = 'id,name,short_name,description,price,image,category,sub_category_id,stock,oferta,oferta_type,oferta_value,gift_product';
    let { data, error } = await supabase
      .from('products')
      .select(productFields)
      .or('visible.is.null,visible.eq.true')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });

    if (error && /short_name/i.test(error.message || '')) {
      console.warn('[GET /api/products] short_name no existe; usando fallback sin nombre corto.');
      const fallback = await supabase
        .from('products')
        .select(productFields.replace('short_name,', ''))
        .or('visible.is.null,visible.eq.true')
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true });
      data = (fallback.data || []).map((p) => ({ ...p, short_name: '' }));
      error = fallback.error;
    }
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    const msg = error?.message || String(error);
    const cause = error?.cause?.message || error?.cause?.code || null;
    console.error('[GET /api/products] Error:', msg, cause ? `cause=${cause}` : '');
    res.status(500).json({ error: msg, cause });
  }
});

// Get categories (public)
app.get('/api/categories', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get sub categories (public)
app.get('/api/sub-categories', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sub_categories')
      .select('*')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get repair services (public)
app.get('/api/repair-services', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('repair_services')
      .select('*')
      .order('id', { ascending: true });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================================
// Solicitud de cita de reparación (pública)
// =====================================================================
// El cliente envía marca/modelo/tipo + nombre + teléfono + preferencia
// de día/franja. Se guarda como "Nueva" y se avisa a la tienda por email
// (best-effort). NO reserva un hueco real: la tienda confirma después.
const REPAIR_TYPES = ['pantalla', 'bateria', 'otro'];
// Cómo nos hace llegar el móvil: en tienda (gratis) o recogida a
// domicilio en Meco (5€, gratis con pedido del súper de 25€+).
const REPAIR_HANDOVERS = ['tienda', 'domicilio'];
const MAX_OPEN_BOOKINGS_PER_PHONE_24H = 3;

app.post('/api/repair-bookings', repairBookingLimiter, async (req, res) => {
  try {
    const b = req.body || {};
    const customer_name = String(b.customer_name || b.name || '').trim().slice(0, 80);
    const phoneRaw = String(b.phone || '').trim();
    if (!customer_name) {
      return res.status(400).json({ error: 'Indica tu nombre para poder confirmarte la cita.' });
    }
    if (!isSpanishPhoneOk(phoneRaw)) {
      return res.status(400).json({ error: 'El teléfono no parece válido. Revisa que sean 9 dígitos (móvil o fijo español).' });
    }
    const phone = phoneRaw.replace(/[\s.\-()]/g, '').replace(/^\+?(0034|34)/, '');

    // Email obligatorio: el presupuesto y la hora propuesta se responden
    // por email, así que sin él la solicitud no sirve de nada.
    const email = String(b.email || '').trim().slice(0, 120);
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'Indica un email válido: ahí te enviaremos el precio y la hora propuesta.' });
    }

    const repair_type = REPAIR_TYPES.includes(b.repair_type) ? b.repair_type : 'otro';
    const brand = String(b.brand || '').trim().slice(0, 60);
    const model = String(b.model || '').trim().slice(0, 60);
    const note = String(b.note || '').trim().slice(0, 500);

    const handover = REPAIR_HANDOVERS.includes(b.handover) ? b.handover : 'tienda';
    let address = String(b.address || '').trim().slice(0, 200);
    if (handover === 'domicilio' && !address) {
      return res.status(400).json({ error: 'Indica tu dirección en Meco para la recogida a domicilio.' });
    }
    if (handover === 'tienda') address = '';

    const user_id = await getVerifiedUserId(req);

    // Anti-abuso por teléfono: máximo de citas abiertas en 24 h.
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recent, error: countErr } = await supabase
        .from('repair_bookings')
        .select('id, status')
        .eq('phone', phone)
        .gte('created_at', since);
      const open = (recent || []).filter(r => !['Completada', 'Cancelada'].includes(r.status));
      if (!countErr && open.length >= MAX_OPEN_BOOKINGS_PER_PHONE_24H) {
        return res.status(429).json({
          error: 'Ya tienes varias solicitudes de cita recientes. Te contactaremos; si es urgente, llámanos.',
          code: 'RATE_LIMIT_PHONE',
        });
      }
    } catch (e) {
      // fail-open: no bloqueamos una cita legítima por un glitch de BD
      console.warn('[repair-bookings] check teléfono falló (continúo):', e?.message || e);
    }

    const payload = { brand, model, repair_type, customer_name, phone, email, note, handover, address, status: 'Nueva' };
    if (user_id) payload.user_id = user_id;

    const { data, error } = await supabase
      .from('repair_bookings')
      .insert([payload])
      .select()
      .single();
    if (error) throw error;

    // Aviso a la tienda (best-effort, no bloquea la respuesta al cliente).
    sendRepairBookingNotification(data).catch((err) =>
      console.warn('[repair-bookings] aviso a tienda falló:', err?.message || err)
    );

    res.json({ ok: true, booking: { id: data.id, status: data.status } });
  } catch (error) {
    console.error('[repair-bookings] error:', error?.message || error);
    res.status(500).json({ error: error.message });
  }
});

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

// =====================================================================
// Validación de teléfono español (defensa servidor).
// El frontend ya valida, pero un cliente malicioso puede saltarse el JS
// y llamar a la API directamente. Normalizamos prefijo internacional
// opcional (+34 / 0034 / 34) y separadores, y exigimos 9 dígitos que
// empiecen por 6/7 (móvil) u 8/9 (fijo) — el rango válido en España.
// =====================================================================
function isSpanishPhoneOk(raw) {
  let p = String(raw || '').replace(/[\s.\-()]/g, '');
  p = p.replace(/^\+?(0034|34)/, '');
  return /^[6-9]\d{8}$/.test(p);
}

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

// Extrae el user_id VERIFICADO del JWT de la cabecera Authorization, o
// null si no hay sesión válida. No confía en el user_id del body (que un
// invitado podría falsificar). Se usa para reglas sensibles de cupón.
async function getVerifiedUserId(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    return user?.id || null;
  } catch {
    return null;
  }
}

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
async function adjustStockCas(productId, delta, { allowNegative = false } = {}) {
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

async function deductStockForItems(items) {
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
async function restockItems(items) {
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
async function snapshotItemTaxRates(items) {
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
  const fulfilledOrder = { ...order, status: newStatus, payment_method: paymentLabel };

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

  // Factura VeriFactu sólo si hubo COBRO real (Bizum / captura automática).
  // Las autorizaciones aún no cobradas facturan al capturar desde el panel.
  if (!isAuthorizedOnly) {
    issueInvoiceBestEffort(orderId, 'stripe pago confirmado');
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
    const { data, error } = await supabase
      .from('orders')
      .insert([{
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
        coupon_code: appliedCoupon,
        discount,
        created_at: nowIso,
        confirmed_at: nowIso
      }])
      .select()
      .single();

    if (error) throw error;

    // 自动打印 ticket（异步执行，不阻塞响应）
    if (process.env.AUTO_PRINT_ENABLED !== 'false') {
      autoPrintTicket(data).catch(err => {
        console.error('Error en auto-impresión:', err);
      });
    }

    // Confirmación por email (asíncrono, best-effort — nunca bloquea ni
    // falla la creación del pedido aunque Resend caiga, el dominio no
    // esté verificado, o el cliente no haya facilitado un email válido).
    if (hasValidEmail) {
      sendOrderConfirmationEmail(data, normalizedEmail).catch((err) => {
        console.error('[Email] Excepción inesperada (no propagada):', err?.message || err);
      });
    } else {
      console.warn(`[Email] Pedido ${data?.id?.slice?.(0, 8) || '?'} sin customer_email válido — skip envío`);
    }

    res.json(data);
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
    const { data: order, error: insErr } = await supabase
      .from('orders')
      .insert([{
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
        coupon_code: appliedCoupon,
        discount,
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();
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

// =====================================================================
// Impresión automática de tickets (agente de la tienda)
// =====================================================================
// Campos que el ticket necesita. Devolvemos solo lo imprescindible para
// el ticket (no el email del cliente, etc.). stripe_payment_intent +
// payment_method + status permiten al agente decidir la etiqueta de
// "estado de pago" (PAGADO vs COBRAR AL ENTREGAR).
const PRINT_ORDER_FIELDS =
  'id, created_at, confirmed_at, delivery_method, items, total, address, phone, note, payment_method, status, stripe_payment_intent, coupon_code, discount';

// GET /api/print/pending — cola de impresión.
// Devuelve pedidos confirmados (confirmed_at no nulo) y aún no impresos
// (printed_at nulo), del más antiguo al más nuevo (se imprimen en orden
// de llegada). El agente los procesa uno a uno y luego llama a
// /api/print/mark por cada uno.
app.get('/api/print/pending', authenticatePrintAgent, async (req, res) => {
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
app.post('/api/print/mark', authenticatePrintAgent, async (req, res) => {
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
    const { data, error } = await supabase
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
      issueInvoiceBestEffort(id, 'pedido entregado');
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/orders/:id/invoice — emite (o REINTENTA) la factura
// VeriFactu de un pedido. Pensado para el caso 'error' (fiskaly caído en
// el momento del cobro) o para forzar un 'pending' atascado con
// { force: true }. Responde con el resultado de la emisión.
app.post('/api/admin/orders/:id/invoice', authenticateAdmin, async (req, res) => {
  try {
    if (!isFiskalyEnabled()) {
      return res.status(503).json({ error: 'fiskaly no está configurado (faltan FISKALY_* en el entorno)' });
    }
    const { id } = req.params;
    const force = req.body?.force === true;
    const result = await fiskaly.issueInvoiceForOrder(id, { force });
    if (result.ok) return res.json(result);
    if (result.skipped) return res.status(409).json({ error: `No emitida: ${result.skipped}`, ...result });
    return res.status(500).json({ error: result.error || 'Emisión fallida', ...result });
  } catch (error) {
    reportError(error, '[fiskaly] reintento manual falló');
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
      issueInvoiceBestEffort(id, 'captura ya realizada'); // idempotente si ya facturó
      return res.json({ ok: true, alreadyCaptured: true });
    }

    if (pi.status !== 'requires_capture') {
      return res.status(400).json({
        error: `No se puede cobrar: el pago está en estado "${pi.status}". Es posible que la autorización haya caducado (las retenciones de tarjeta caducan a los ~7 días).`,
      });
    }

    await stripe.paymentIntents.capture(order.stripe_payment_intent);
    const { data, error: uErr } = await supabase
      .from('orders')
      .update({ status: 'Procesando' })
      .eq('id', id)
      .select()
      .single();
    if (uErr) throw uErr;

    // El dinero acaba de moverse de verdad → momento de la factura.
    issueInvoiceBestEffort(id, 'captura de autorización');

    console.log('[stripe] pago cobrado (capturado) para pedido:', id);
    return res.json({ ok: true, order: data });
  } catch (error) {
    console.error('[stripe] error capturando pago:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Error al cobrar el pedido' });
  }
});

// Construye un enlace wa.me PRE-RELLENADO para avisar al cliente del
// reembolso con un solo toque (el admin pulsa y se abre WhatsApp con el
// mensaje y el destinatario ya puestos). No es envío automático: WhatsApp
// sólo permite mensajes proactivos vía la Cloud API con plantillas
// aprobadas por Meta. Esto es el término medio sin esa infraestructura.
// Normaliza el teléfono a formato internacional español. Devuelve null si
// no hay un teléfono utilizable.
function buildRefundWhatsappLink(order, reason, refundType, amount = null) {
  let digits = String(order?.phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0034')) digits = digits.slice(2);
  // Teléfono español sin prefijo: 9 dígitos empezando por 6/7/8/9 → +34.
  if (digits.length === 9 && /^[6789]/.test(digits)) digits = '34' + digits;
  if (digits.length < 11) return null; // no parece un internacional válido

  const id = String(order?.id || '').slice(0, 8).toUpperCase();
  const amountStr = Number(amount || 0).toFixed(2).replace('.', ',') + ' €';
  const money = refundType === 'released'
    ? 'No te hemos cobrado nada; si veías una retención en tu tarjeta, desaparecerá sola en 1-7 días.'
    : refundType === 'partial'
      ? `Te hemos reembolsado ${amountStr} por los artículos devueltos; suele tardar 5-10 días hábiles en aparecer, según tu banco.`
      : refundType === 'refunded'
        ? 'Te hemos reembolsado el importe completo; suele tardar 5-10 días hábiles en aparecer, según tu banco.'
        : 'No se ha realizado ningún cobro online por este pedido.';
  const intro = refundType === 'partial'
    ? (reason ? `Hemos gestionado la devolución de parte de tu pedido. Motivo: ${reason}` : 'Hemos gestionado la devolución de parte de tu pedido.')
    : (reason ? `Hemos tenido que cancelarlo por este motivo: ${reason}` : 'Hemos tenido que cancelar tu pedido.');
  const lines = [
    `Hola, te escribimos de HIPERA por tu pedido #${id}.`,
    '',
    intro,
    '',
    money,
    '',
    'Disculpa las molestias. Si tienes cualquier duda, respóndenos por aquí.',
  ];
  return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join('\n'))}`;
}

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

// Construye un enlace wa.me PRE-RELLENADO para avisar al cliente de que su
// pedido de recogida está listo, incluyendo el código de recogida como
// comprobante. Mismo enfoque que buildRefundWhatsappLink (un solo toque,
// no es envío automático). Devuelve null si no hay teléfono utilizable.
function buildPickupReadyWhatsappLink(order, code) {
  let digits = String(order?.phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0034')) digits = digits.slice(2);
  if (digits.length === 9 && /^[6789]/.test(digits)) digits = '34' + digits;
  if (digits.length < 11) return null;

  const id = String(order?.id || '').slice(0, 8).toUpperCase();
  const lines = [
    `Hola, te escribimos de HIPERA. ¡Tu pedido #${id} ya está listo para recoger! 🛍️`,
    '',
    `Tu código de recogida es: ${code}`,
    'Enséñalo (o este mensaje) y di tu nombre en el mostrador para retirarlo.',
    '',
    'Estamos en Paseo del Sol 1, 28880 Meco (Madrid), de 09:00 a 22:00.',
    '¡Te esperamos!',
  ];
  return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join('\n'))}`;
}

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

// Get all products (admin only) - incluye los no visibles
app.get('/api/admin/products', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Product management (admin only)
app.post('/api/admin/products', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .insert([req.body])
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/products/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const payload = { ...req.body };
    if (payload.stock === 0) payload.visible = false;
    const { data, error } = await supabase
      .from('products')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/products/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/reorder/products', authenticateAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    for (let i = 0; i < ids.length; i++) {
      const { error } = await supabase.from('products').update({ sort_order: i }).eq('id', ids[i]);
      if (error) throw error;
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Category management (admin only)
app.post('/api/admin/categories', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('categories')
      .insert([req.body])
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/categories/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/reorder/categories', authenticateAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    for (let i = 0; i < ids.length; i++) {
      const { error } = await supabase.from('categories').update({ sort_order: i }).eq('id', ids[i]);
      if (error) throw error;
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sub-category management (admin only)
app.post('/api/admin/sub-categories', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sub_categories')
      .insert([req.body])
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/sub-categories/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('sub_categories')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/reorder/sub-categories', authenticateAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    for (let i = 0; i < ids.length; i++) {
      const { error } = await supabase.from('sub_categories').update({ sort_order: i }).eq('id', ids[i]);
      if (error) throw error;
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Repair service management (admin only). Solo marca, modelo, descripción; el resto se rellena por defecto.
app.post('/api/admin/repair-services', authenticateAdmin, async (req, res) => {
  try {
    const { brand, model, description } = req.body;
    const fallbackTitle = `${brand || ''} ${model || ''}`.trim() || 'Modelo';
    const payload = {
      brand: brand || '',
      model: model || '',
      description: description || 'Incluye limpieza interna + Cristal y Funda (o Cargador) de REGALO.',
      title: req.body.title != null ? req.body.title : fallbackTitle,
      repair_type: req.body.repair_type != null ? req.body.repair_type : '',
      price: req.body.price != null ? Number(req.body.price) : 0
    };
    const { data, error } = await supabase
      .from('repair_services')
      .insert([payload])
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/repair-services/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('repair_services')
      .update(req.body)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/repair-services/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('repair_services')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================================================================
// Citas de reparación — gestión (admin)
// =====================================================================
app.get('/api/admin/repair-bookings', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('repair_bookings')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const REPAIR_BOOKING_STATUSES = ['Nueva', 'Contactado', 'Agendada', 'Completada', 'Cancelada'];

app.patch('/api/admin/repair-bookings/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!REPAIR_BOOKING_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Estado no válido. Use uno de: ${REPAIR_BOOKING_STATUSES.join(', ')}.` });
    }
    const { data, error } = await supabase
      .from('repair_bookings')
      .update({ status })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// AI: 去背 → 支持 REMOVEBGAPI_KEY (removebgapi.com) 或 REMOVEBG_API_KEY (remove.bg)
app.post('/api/admin/remove-bg', authenticateAdmin, async (req, res) => {
  try {
    const { image_url } = req.body;
    if (!image_url || typeof image_url !== 'string') {
      return res.status(400).json({ error: 'image_url required' });
    }
    const removeBgApiKey = process.env.REMOVEBGAPI_KEY;
    const removeBgKey = process.env.REMOVEBG_API_KEY;
    if (!removeBgApiKey && !removeBgKey) {
      return res.status(503).json({ error: 'REMOVEBGAPI_KEY 或 REMOVEBG_API_KEY 需在 backend/.env 中配置' });
    }

    let imageBuffer;
    try {
      const imgResponse = await fetch(image_url);
      if (!imgResponse.ok) throw new Error('Failed to download image');
      imageBuffer = Buffer.from(await imgResponse.arrayBuffer());
    } catch (e) {
      return res.status(400).json({ error: '无法下载图片: ' + (e.message || image_url) });
    }

    let rb;
    if (removeBgApiKey) {
      const form = new FormData();
      form.append('image_file', imageBuffer, { filename: 'image.jpg', contentType: 'image/jpeg' });
      form.append('format', 'png');
      form.append('size', 'full');
      rb = await fetch('https://removebgapi.com/api/v1/remove', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${removeBgApiKey}`, ...form.getHeaders() },
        body: form
      });
    } else {
      // remove.bg: usar FormData nativo (Node 18+) con Blob - form-data pkg no funciona bien con fetch
      const NodeFormData = globalThis.FormData;
      const fd = new NodeFormData();
      const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
      fd.append('image_file', blob, 'image.jpg');
      fd.append('size', 'auto');
      fd.append('format', 'png');
      rb = await fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST',
        headers: { 'X-Api-Key': removeBgKey },
        body: fd
      });
    }

    if (!rb.ok) {
      const errText = await rb.text();
      let err;
      try { err = JSON.parse(errText); } catch { err = { errors: [{ detail: errText }] }; }
      let msg = err?.errors?.[0]?.detail || err?.errors?.[0]?.title || err?.message || rb.statusText;
      if (typeof msg !== 'string') {
        const e = err?.error;
        msg = (typeof e === 'string' ? e : e?.message) || errText || '去背失败';
      }
      msg = (msg && typeof msg === 'string' ? msg : errText) || '去背失败';
      return res.status(rb.status >= 400 && rb.status < 500 ? 400 : 502).json({ error: msg });
    }

    const buf = Buffer.from(await rb.arrayBuffer());
    const fileName = `removebg-${Date.now()}.png`;
    const { error: upErr } = await supabase.storage.from('products').upload(fileName, buf, { contentType: 'image/png', upsert: false });
    if (upErr) return res.status(500).json({ error: 'Upload failed: ' + upErr.message });

    const { data } = supabase.storage.from('products').getPublicUrl(fileName);
    res.json({ image_url: data.publicUrl });
  } catch (e) {
    res.status(500).json({ error: e.message || 'remove-bg error' });
  }
});

// AI: OpenAI Vision 提取商品信息（重量、数量、配料等）- 支持多张图片
app.post('/api/admin/generate-description', authenticateAdmin, async (req, res) => {
  try {
    const { image_urls, image_url } = req.body; // 支持新格式 image_urls 或旧格式 image_url
    const urls = image_urls || (image_url ? [image_url] : []);
    
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'image_urls (array) required' });
    }
    
    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });

    // 构建 content 数组：包含所有图片 + 文本提示
    const content = [
      ...urls.map(url => ({ type: 'image_url', image_url: { url } })),
      {
        type: 'text',
        text: `Analiza ${urls.length > 1 ? 'estas imágenes' : 'esta imagen'} de producto y extrae la siguiente información en formato JSON. Si hay múltiples imágenes, combina la información de todas ellas:

{
  "name": "nombre del producto tal como aparece (ej: Ramen Sabor Pollo, Fideos Instantáneos)",
  "brand": "marca del producto (ej: JML, Nissin) o null si no se ve",
  "weight": "peso en g o ml exactamente como en etiqueta (ej: '109g', '500g', '250ml') o null si no se ve",
  "quantity": "cantidad de unidades/piezas (ej: '2 unidades', '10 piezas') o null si no se ve",
  "ingredients": "lista completa de ingredientes si es visible, o null",
  "description": "descripción breve del producto en español (1-2 frases)",
  "specifications": "otras especificaciones visibles o null"
}

REGLAS:
- Analiza TODAS las imágenes y combina la información
- Solo extrae lo que REALMENTE ves; si no ves algo, usa null
- description siempre debe tener un valor
- name y brand deben ser el nombre y marca exactos del producto
- NO incluyas fecha de caducidad (expiration date / best before) en description, specifications ni en ningún otro campo. Omítela siempre aunque aparezca en la etiqueta.
- Responde SOLO con el JSON, sin texto adicional`
      }
    ];

    const payload = {
      model: 'gpt-4o',
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Eres un asistente que extrae información de productos desde imágenes. Responde SOLO en formato JSON válido.'
        },
        {
          role: 'user',
          content
        }
      ]
    };

    const oa = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!oa.ok) {
      const err = await oa.json().catch(() => ({}));
      const msg = err?.error?.message || oa.statusText;
      return res.status(oa.status >= 400 && oa.status < 500 ? 400 : 502).json({ error: msg || 'OpenAI failed' });
    }

    const data = await oa.json();
    const responseContent = data?.choices?.[0]?.message?.content?.trim() || '{}';
    
    try {
      const productInfo = JSON.parse(responseContent);
      
      // Producto nombre: NAME BRAND 109g (todo mayúsculas salvo peso)
      const namePart = (productInfo.name || '').trim().toUpperCase();
      const brandPart = (productInfo.brand || '').trim().toUpperCase();
      const weightPart = (productInfo.weight || '').trim();
      const productNameParts = [namePart, brandPart].filter(Boolean);
      if (weightPart) productNameParts.push(weightPart);
      const productName = productNameParts.join(' ') || null;

      let formattedDesc = productInfo.description || '';
      const parts = [];
      if (productInfo.weight) parts.push(`Peso: ${productInfo.weight}`);
      if (productInfo.quantity) parts.push(`Cantidad: ${productInfo.quantity}`);
      if (productInfo.specifications) parts.push(productInfo.specifications);
      if (productInfo.ingredients) parts.push(`Ingredientes: ${productInfo.ingredients}`);
      if (parts.length > 0) formattedDesc += '\n\n' + parts.join('\n');
      
      res.json({ 
        description: formattedDesc,
        productInfo: {
          productName,
          weight: productInfo.weight || null,
          quantity: productInfo.quantity || null,
          ingredients: productInfo.ingredients || null,
          specifications: productInfo.specifications || null
        }
      });
    } catch (parseErr) {
      // 如果JSON解析失败，返回原始内容作为description
      res.json({ description: responseContent, productInfo: null });
    }
  } catch (e) {
    res.status(500).json({ error: e.message || 'generate-description error' });
  }
});

// AI: 将商品居中到图片中心
app.post('/api/admin/center-product', authenticateAdmin, async (req, res) => {
  try {
    const { image_url } = req.body;
    if (!image_url || typeof image_url !== 'string') {
      return res.status(400).json({ error: 'image_url required' });
    }

    // 下载图片
    const imgResponse = await fetch(image_url);
    if (!imgResponse.ok) {
      return res.status(400).json({ error: 'Failed to download image from URL: ' + image_url });
    }
    const imageBuffer = Buffer.from(await imgResponse.arrayBuffer());

    // 使用 sharp 处理图片，先验证格式
    let image;
    try {
      // 先尝试直接创建 sharp 实例
      image = sharp(imageBuffer);
      // 验证图片格式 - 尝试获取 metadata
      const testMetadata = await image.metadata();
      if (!testMetadata.width || !testMetadata.height) {
        throw new Error('Invalid image dimensions');
      }
    } catch (formatError) {
      console.error('Image format error:', formatError.message, 'Image URL:', image_url);
      // 尝试强制转换为 PNG
      try {
        console.log('Attempting to convert image to PNG format...');
        image = sharp(imageBuffer, { failOnError: false }).png();
        const testMetadata = await image.metadata();
        if (!testMetadata.width || !testMetadata.height) {
          throw new Error('Conversion failed - invalid dimensions');
        }
        console.log('Successfully converted to PNG');
      } catch (convertError) {
        console.error('Conversion also failed:', convertError.message);
        return res.status(400).json({ 
          error: 'Unsupported image format or corrupted image. Please use JPEG, PNG, WebP, or GIF.',
          details: formatError.message,
          conversionError: convertError.message
        });
      }
    }

    const metadata = await image.metadata();
    const { width, height } = metadata;
    
    if (!width || !height) {
      return res.status(400).json({ error: 'Invalid image dimensions' });
    }

    // 确保图片有 alpha 通道并转换为 RGBA 格式
    const processedImage = image.ensureAlpha();
    
    // 获取图片的原始像素数据（RGBA）
    const { data, info } = await processedImage
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    // 确保 channels 是正确的（应该是 4 for RGBA）
    const actualChannels = info.channels || 4;
    
    if (!data || data.length === 0) {
      return res.status(400).json({ error: 'Failed to extract image pixel data' });
    }

    // 检测非透明区域的边界框
    let minX = width, minY = height, maxX = 0, maxY = 0;
    let hasContent = false;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * actualChannels;
        const alpha = actualChannels >= 4 ? data[idx + 3] : 255; // Alpha 通道（如果存在）
        
        // 如果像素不透明（alpha > 10），认为是内容
        if (alpha > 10) {
          hasContent = true;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    // 如果没有检测到内容，返回原图
    if (!hasContent || minX >= maxX || minY >= maxY) {
      // 如果检测失败，返回原图（转换为 PNG 以确保兼容性）
      const pngBuffer = await image.png().toBuffer();
      const fileName = `centered-${Date.now()}.png`;
      const { error: upErr } = await supabase.storage.from('products').upload(fileName, pngBuffer, { 
        contentType: 'image/png', 
        upsert: false 
      });
      if (upErr) return res.status(500).json({ error: 'Upload failed: ' + upErr.message });
      const { data: urlData } = supabase.storage.from('products').getPublicUrl(fileName);
      return res.json({ image_url: urlData.publicUrl, message: 'No content detected, original image returned' });
    }

    // 计算商品区域
    const contentWidth = maxX - minX + 1;
    const contentHeight = maxY - minY + 1;
    
    // 添加一些边距（10%）
    const padding = Math.max(contentWidth, contentHeight) * 0.1;
    const cropX = Math.max(0, minX - padding);
    const cropY = Math.max(0, minY - padding);
    const cropWidth = Math.min(width - cropX, maxX - cropX + padding * 2);
    const cropHeight = Math.min(height - cropY, maxY - cropY + padding * 2);

    // 裁剪商品区域（确保使用处理过的图片）
    const cropped = await processedImage
      .extract({ left: Math.floor(cropX), top: Math.floor(cropY), width: Math.floor(cropWidth), height: Math.floor(cropHeight) })
      .png()
      .toBuffer();

    // 创建新画布，将商品居中
    const canvasWidth = width; // 保持原图宽度
    const canvasHeight = height; // 保持原图高度
    
    const centered = await sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0 } // 透明背景
      }
    })
      .composite([{
        input: cropped,
        left: Math.floor((canvasWidth - Math.floor(cropWidth)) / 2),
        top: Math.floor((canvasHeight - Math.floor(cropHeight)) / 2)
      }])
      .png()
      .toBuffer();

    // 上传到 Supabase
    const fileName = `centered-${Date.now()}.png`;
    const { error: upErr } = await supabase.storage.from('products').upload(fileName, centered, { 
      contentType: 'image/png', 
      upsert: false 
    });
    
    if (upErr) return res.status(500).json({ error: 'Upload failed: ' + upErr.message });

    const { data: urlData } = supabase.storage.from('products').getPublicUrl(fileName);
    res.json({ image_url: urlData.publicUrl });
  } catch (e) {
    console.error('center-product error:', e);
    res.status(500).json({ error: e.message || 'center-product error' });
  }
});

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
if (SENTRY_ENABLED) {
  Sentry.setupExpressErrorHandler(app);
}

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
  console.log(`📡 API available at http://localhost:${PORT}/api`);
  console.log(`📖 API info at http://localhost:${PORT}/`);
});
