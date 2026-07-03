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
import 'dotenv/config';
import * as Sentry from '@sentry/node';

export const SENTRY_ENABLED = !!process.env.SENTRY_DSN;
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
// código a Sentry.
export function reportError(err, context) {
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

// Manejador de errores de Sentry: captura cualquier excepción que SÍ se
// propague por Express (rutas sin try/catch propio o errores lanzados por
// middleware). Debe registrarse DESPUÉS de todas las rutas.
export function attachSentryErrorHandler(app) {
  if (SENTRY_ENABLED) {
    Sentry.setupExpressErrorHandler(app);
  }
}
