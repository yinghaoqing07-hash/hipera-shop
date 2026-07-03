// =====================================================================
// WhatsApp — canal de contacto principal del comercio
// =====================================================================
// Número único usado en accesos rápidos, módulo de confianza y entrada
// de reparación. Mantener sincronizado con los enlaces wa.me de la
// página /repair. `waLink` codifica el mensaje predefinido para abrir
// el chat con un texto ya escrito (reduce fricción del cliente).
export const WHATSAPP_NUMBER = '34612466034';
export const waLink = (text) =>
  `https://wa.me/${WHATSAPP_NUMBER}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
