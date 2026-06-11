// =====================================================================
// analytics.js — carga diferida y gateada de Google Analytics 4 (GA4)
// =====================================================================
// GA4 sólo se carga cuando se cumplen DOS condiciones:
//   1) hay un measurement id en el build (VITE_GA4_ID, formato "G-XXXX"), y
//   2) el usuario ha dado consentimiento de 'analytics' en el banner de
//      cookies (RGPD).
// Sin ambas, todo este módulo es no-op (no se inyecta script ni se envían
// eventos). Seguimos el criterio del proyecto de NO inyectar NINGÚN script
// de tracking antes del consentimiento (por eso no usamos Consent Mode,
// que cargaría gtag.js de inmediato con consent 'denied').
//
// El "puente" que conecta el consentimiento con este módulo es el efecto
// de AnalyticsConsentBridge en App.jsx: llama a enableAnalytics() cuando
// hay consentimiento y disableAnalytics() cuando se revoca.
//
// Eventos de conversión expuestos (no-op si GA4 no está activo):
//   trackPurchase({ id, value, items })  → pedido completado
//   trackRepairLead()                    → solicitud de cita de reparación
// =====================================================================

const GA_ID = import.meta.env.VITE_GA4_ID;
let loaded = false;   // gtag.js ya inyectado en el DOM
let enabled = false;  // hay consentimiento → se envían eventos

// Shim canónico de gtag: empuja el objeto `arguments` a dataLayer, igual
// que el snippet oficial de Google. Función normal (no arrow) para tener
// acceso a `arguments`.
function gtag() {
  (window.dataLayer = window.dataLayer || []).push(arguments);
}

// Inyecta gtag.js una sola vez. Idempotente.
function injectScript() {
  if (loaded || !GA_ID) return;
  loaded = true;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
  gtag('js', new Date());
  gtag('config', GA_ID, { anonymize_ip: true });
}

// Activar cuando el usuario TENGA consentimiento de analytics.
export function enableAnalytics() {
  if (!GA_ID) return;
  enabled = true;
  // Si ya se había cargado y luego se revocó, reactivamos el opt-out global.
  window[`ga-disable-${GA_ID}`] = false;
  injectScript();
}

// Desactivar cuando el usuario REVOQUE el consentimiento. No se puede
// "descargar" gtag.js una vez inyectado, pero dejamos de enviar eventos y
// activamos el opt-out oficial a nivel de propiedad (window['ga-disable-ID']).
export function disableAnalytics() {
  enabled = false;
  if (GA_ID) window[`ga-disable-${GA_ID}`] = true;
}

function track(eventName, params) {
  if (!enabled || !GA_ID) return;
  gtag('event', eventName, params || {});
}

// Pedido completado. value en EUR; items opcional (formato GA4 e-commerce).
export function trackPurchase({ id, value, items } = {}) {
  track('purchase', {
    transaction_id: id || undefined,
    value: typeof value === 'number' ? value : undefined,
    currency: 'EUR',
    items: Array.isArray(items) ? items : undefined,
  });
}

// Solicitud de cita de reparación: es un lead (no una venta directa).
export function trackRepairLead() {
  track('generate_lead', { lead_type: 'repair_booking' });
}
