// Rate limits de la API. Ver comentarios de cada limiter para el porqué
// de los umbrales. IMPORTANTE: usan `req.ip` derivado de `trust proxy =
// true` (configurado en server.js), así que la IP es la del cliente real,
// no la del proxy de Railway.
import rateLimit from 'express-rate-limit';

// Limiter global: skip OPTIONS + /api/health (keep-alive). Límite alto:
// proxy/Vercel agrupa IPs.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS' || req.path === '/health',
  validate: { trustProxy: false }
});

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
export const orderHourlyLimiter = rateLimit({
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

export const orderDailyLimiter = rateLimit({
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
export const repairBookingLimiter = rateLimit({
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
