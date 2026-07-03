// =====================================================================
// Tarifas operativas de envío — single source of truth
// =====================================================================
// Estos valores DEBEN COINCIDIR EXACTAMENTE con los publicados en la
// Política de Envíos §4.1 (tarifa única) y §4.3 (umbral gratuito). El
// histórico previo cobraba 4,50 € con umbral 50 € en el código, pero
// la documentación legal (T&C §7, Política de Envíos, Política de
// Devoluciones §5.5, FaqSection) ya establecía 4,99 € / 40 €. La
// inconsistencia se corrigió el 2026-05-25 alineando el código a la
// documentación.
//
// Cualquier modificación futura requiere actualización síncrona en:
//   - PoliticaEnvios.jsx §4.1 (tarifa) y §4.3 (umbral)
//   - PoliticaDevoluciones.jsx §5.5 (matriz reembolso de envío)
//   - FaqSection (respuesta "¿Cuánto cuesta el envío?")
//   - SHIPPING_VERSION en config/legal.js (bump al cambiar valores)
// =====================================================================
export const SHIPPING_FEE_STANDARD = 4.99;
export const FREE_SHIPPING_THRESHOLD = 40;
export const DELIVERY_AREA_LABEL = 'Meco (28880)';
export const DELIVERY_ALLOWED_TERMS = ['meco', '28880'];

export function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function isAddressInDeliveryArea(address) {
  const normalized = normalizeText(address);
  return DELIVERY_ALLOWED_TERMS.some(term => normalized.includes(term));
}
