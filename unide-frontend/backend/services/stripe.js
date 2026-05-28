// =====================================================================
// Stripe — pasarela de pago (Checkout hosted)
// =====================================================================
// Módulo aislado para la integración con Stripe. El servidor crea
// sesiones de Checkout (página alojada por Stripe, PCI-compliant: la
// tarjeta nunca toca nuestros servidores) y verifica los webhooks de
// confirmación de pago.
//
// Variables de entorno (Railway → Variables):
//   STRIPE_SECRET_KEY      — sk_test_... en pruebas, sk_live_... en prod
//   STRIPE_WEBHOOK_SECRET  — whsec_... del endpoint de webhook
//
// Comportamiento sin configurar:
//   Si STRIPE_SECRET_KEY no está, getStripe() devuelve null y las rutas
//   de pago con tarjeta responden 503 (el resto del sitio sigue
//   funcionando con Bizum manual / contra reembolso). Esto permite
//   desarrollar y desplegar sin claves hasta que estén listas.
//
// Flujo de dos fases (ver server.js):
//   1. POST /api/checkout/stripe-session → crea pedido "Esperando pago"
//      (SIN descontar stock) y una sesión de Checkout. Devuelve la URL.
//   2. Webhook checkout.session.completed → marca el pedido "Procesando",
//      descuenta stock, envía email y dispara impresión. El webhook es
//      la ÚNICA fuente de verdad del pago (la success_url NO se usa
//      como prueba: el cliente podría falsificarla).
// =====================================================================

import Stripe from 'stripe';

let _stripe = null;

/**
 * Cliente Stripe perezoso. Devuelve null si STRIPE_SECRET_KEY no está
 * configurada (modo "Stripe deshabilitado", el resto del sitio sigue).
 */
export function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  // No fijamos apiVersion: usamos la versión que trae la librería
  // instalada (pinned por el paquete), evitando desajustes silenciosos.
  _stripe = new Stripe(key);
  return _stripe;
}

export const isStripeConfigured = () => !!process.env.STRIPE_SECRET_KEY;

// Aviso de arranque si Stripe no está configurado en producción.
if (process.env.NODE_ENV === 'production' && !process.env.STRIPE_SECRET_KEY) {
  console.warn(
    '[Stripe] ⚠️ STRIPE_SECRET_KEY no configurada. El pago con tarjeta ' +
    'devolverá 503. Configura STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET ' +
    'en las variables de entorno (ver README_BACKEND_SETUP.md).'
  );
}

/**
 * Construye las line_items de la sesión de Checkout a partir del
 * carrito, GARANTIZANDO que el importe cobrado coincide exactamente
 * con `total` (que ya incluye gastos de envío).
 *
 * Estrategia:
 *   - Cada producto facturable (precio > 0, no regalo) se lista como
 *     una línea propia (transparencia en el recibo de Stripe).
 *   - Los regalos (price 0 / isGift) NO se incluyen: Stripe no admite
 *     líneas de importe 0 en modo payment de forma fiable, y además
 *     no forman parte de `total`.
 *   - El residuo `total - suma(items)` se añade como "Gastos de envío"
 *     si es positivo. Así el cargo cuadra al céntimo con `total`.
 *   - Si el residuo es negativo (descuento a nivel pedido) o no hay
 *     items facturables, caemos a una sola línea "Pedido HIPERA" con
 *     el total exacto. Robustez > detalle en ese caso límite.
 *
 * @returns {{ line_items: Array, fallback: boolean }}
 */
export function buildCheckoutLineItems(items, total) {
  const totalCents = Math.round(Number(total) * 100);
  const lineItems = [];
  let itemsCents = 0;

  for (const it of items || []) {
    const price = Number(it?.price);
    if (it?.isGift || price === 0) continue;
    const qty = Number(it?.quantity) || 0;
    const unit = Math.round(price * 100);
    if (qty <= 0 || unit <= 0) continue;
    lineItems.push({
      quantity: qty,
      price_data: {
        currency: 'eur',
        unit_amount: unit,
        product_data: { name: String(it?.name || 'Producto').slice(0, 250) },
      },
    });
    itemsCents += unit * qty;
  }

  const shippingCents = totalCents - itemsCents;

  if (lineItems.length === 0 || shippingCents < 0) {
    // Caso límite: sin items facturables o descuento a nivel pedido.
    // Garantizamos que el cargo == total con una única línea.
    return {
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: totalCents,
          product_data: { name: 'Pedido HIPERA' },
        },
      }],
      fallback: true,
    };
  }

  if (shippingCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: shippingCents,
        product_data: { name: 'Gastos de envío' },
      },
    });
  }

  return { line_items: lineItems, fallback: false };
}

/**
 * Traduce el tipo de método de pago de Stripe a una etiqueta legible
 * en español para guardar en orders.payment_method y mostrar en el
 * panel de administración.
 *
 * Nota: Apple Pay / Google Pay normalmente se reportan como 'card'
 * (con card.wallet.type), así que la mayoría caerá en 'Tarjeta (Stripe)'.
 * El sufijo "(Stripe)" distingue visualmente los pagos prepagados y
 * confirmados de Stripe del Bizum manual histórico (que no lleva
 * stripe_payment_intent).
 */
export function resolveStripePaymentLabel(type) {
  switch (type) {
    case 'card': return 'Tarjeta (Stripe)';
    case 'bizum': return 'Bizum (Stripe)';
    case 'apple_pay': return 'Apple Pay';
    case 'google_pay': return 'Google Pay';
    default: return type ? `Stripe (${type})` : 'Stripe';
  }
}
