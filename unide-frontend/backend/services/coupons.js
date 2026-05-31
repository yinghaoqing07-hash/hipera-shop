// =====================================================================
// Cupones de promoción (campaña de lanzamiento)
// =====================================================================
// Sistema de cupones PROPIO (no Stripe Coupons), para que el descuento
// funcione con TODOS los métodos de pago (tarjeta/Bizum/contra reembolso),
// no solo con los que pasan por Stripe.
//
// El descuento se calcula y valida SIEMPRE aquí, en el servidor. El
// cliente solo manda el `coupon_code`; el backend recalcula el descuento
// sobre el subtotal real de los items y comprueba las reglas (activo,
// caducidad, mínimo, uso único). Así nadie puede falsificar un descuento
// mayor manipulando el frontend.
//
// La comprobación de "uso único por cliente" necesita la base de datos
// y vive en server.js (couponAlreadyUsed); aquí dejamos solo la lógica
// pura, sin dependencias, fácil de testear.
// =====================================================================

// ---------------------------------------------------------------------
// Catálogo de cupones. Para editarlo NO hace falta tocar más código:
// cambia los valores aquí y vuelve a desplegar.
//
//   type         : 'percent'  → descuento porcentual sobre el subtotal
//   value        : el porcentaje (10 = 10 %)
//   minSubtotal  : subtotal mínimo (en €) para poder aplicarlo
//   expiresAt    : fecha/hora límite ISO (con zona). null = sin caducidad
//   oncePerCustomer : true → un solo uso por usuario/teléfono
//   requiresAccount : true → solo clientes con sesión iniciada (evita
//                  que un invitado lo reutilice cambiando de teléfono)
//   active       : false → el cupón NO funciona (úsalo para tenerlo
//                  preparado y activarlo el día del lanzamiento)
//
// ⚠️ LANZAMIENTO: el día que salga la web, en BIENVENIDA10 pon
//    `active: true` y rellena `expiresAt` (p. ej. dos semanas después),
//    y vuelve a desplegar.
// ---------------------------------------------------------------------
export const COUPONS = {
  BIENVENIDA10: {
    type: 'percent',
    value: 10,
    minSubtotal: 30,
    expiresAt: '2026-08-30T23:59:59+02:00',        // ← p. ej. '2026-06-30T23:59:59+02:00'
    oncePerCustomer: true,
    requiresAccount: true, // solo usuarios registrados (uso único fiable)
    active: true,          // ← poner true el día del lanzamiento
  },
};

/** Normaliza el código tal y como lo guardamos/comparamos (MAYÚSCULAS, sin espacios). */
export function normalizeCouponCode(code) {
  return String(code || '').trim().toUpperCase();
}

/**
 * Subtotal facturable a partir de los items del carrito. Excluye regalos
 * (isGift) y líneas sin precio/cantidad válidos. Debe coincidir con el
 * subtotal que calcula el frontend (cart.reduce de price*quantity).
 */
export function computeSubtotal(items) {
  let cents = 0;
  for (const it of items || []) {
    if (it?.isGift) continue;
    const price = Number(it?.price);
    const qty = Number(it?.quantity) || 0;
    if (!Number.isFinite(price) || price <= 0 || qty <= 0) continue;
    cents += Math.round(price * 100) * qty;
  }
  return Math.round(cents) / 100;
}

/**
 * Validación PURA del cupón (sin base de datos): existencia, activo,
 * caducidad, mínimo y cálculo del descuento. La regla de "uso único"
 * se comprueba aparte (necesita BD).
 *
 * @returns {{ ok:boolean, code?:string, coupon?:object, discount?:number,
 *             reason?:string, minSubtotal?:number }}
 *   reason ∈ EMPTY | INVALID | EXPIRED | MIN_NOT_MET
 */
export function evaluateCoupon(rawCode, subtotal, now = new Date()) {
  const code = normalizeCouponCode(rawCode);
  if (!code) return { ok: false, reason: 'EMPTY' };

  const coupon = COUPONS[code];
  if (!coupon || !coupon.active) return { ok: false, reason: 'INVALID', code };

  if (coupon.expiresAt && now > new Date(coupon.expiresAt)) {
    return { ok: false, reason: 'EXPIRED', code };
  }

  const sub = Number(subtotal) || 0;
  if (sub < coupon.minSubtotal) {
    return { ok: false, reason: 'MIN_NOT_MET', code, minSubtotal: coupon.minSubtotal };
  }

  let discount = 0;
  if (coupon.type === 'percent') {
    // value % del subtotal, redondeado a céntimos. Mismo cálculo que el
    // frontend para que el importe mostrado y el cobrado coincidan.
    discount = Math.round(sub * coupon.value) / 100;
  }
  // Nunca descontar más que el propio subtotal.
  discount = Math.min(discount, sub);
  discount = Math.round(discount * 100) / 100;

  return { ok: true, code, coupon, discount };
}

/** Mensaje en español para cada motivo de rechazo (para mostrar al cliente). */
export function couponErrorMessage(reason, info = {}) {
  switch (reason) {
    case 'EXPIRED':
      return 'Este cupón ha caducado.';
    case 'MIN_NOT_MET':
      return `Este cupón requiere un mínimo de €${Number(info.minSubtotal || 0).toFixed(2)} en productos.`;
    case 'ALREADY_USED':
      return 'Ya has usado este cupón.';
    case 'LOGIN_REQUIRED':
      return 'Inicia sesión o crea una cuenta para usar este cupón.';
    case 'EMPTY':
      return 'Introduce un código de cupón.';
    case 'INVALID':
    default:
      return 'El código no es válido.';
  }
}
