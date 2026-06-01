// =====================================================================
// Datos identificativos de la empresa (compartido por documentos legales)
// =====================================================================
// Fuente única de verdad para razón social, NIF, contacto, etc.
// Cualquier cambio aquí se propaga automáticamente a:
//   - Términos y Condiciones
//   - Política de Privacidad
//   - (en el futuro) Aviso Legal, Política de Devoluciones, Envíos
// =====================================================================

export const COMPANY = {
  name: 'QIANG GUO, S.L.',
  nif: 'B86126638',
  address: 'Paseo del Sol nº 1, 28880 Meco (Madrid), España',
  phone: '+34 918 782 602',
  // Direcciones de correo especializadas (todas en el dominio propio
  // hipera.es, verificado en Resend para envíos transaccionales).
  // Pueden apuntar a la misma bandeja al inicio; están segregadas por
  // imagen pública y por cumplimiento RGPD/LGDCU.
  emailGeneral: 'info@hipera.es',
  emailPrivacy: 'privacidad@hipera.es',
  emailComplaints: 'reclamaciones@hipera.es',
  // Remitente operativo de las confirmaciones de pedido y otros
  // mensajes transaccionales (LSSI Art. 27). NO sirve como buzón de
  // entrada para reclamaciones — eso es emailComplaints. Coherencia
  // obligatoria con RESEND_FROM_EMAIL en variables de Railway.
  emailOrders: 'pedidos@hipera.es',
  // Dominio definitivo (registrado en Cloudflare desde 2026-05-25).
  // El dominio anterior https://hipera-shop.vercel.app permanece
  // como alias técnico del despliegue de Vercel pero NO debe usarse
  // como URL canónica en documentación legal ni en SEO.
  website: 'https://hipera.es',
  hours: 'Lunes a Domingo, 09:00 – 22:00',
  activity:
    'Comercio minorista de alimentación, bazar y servicios de reparación de dispositivos móviles',
  // Datos de inscripción registral (facilitados por el titular, 2026-06-02).
  // Consultable en https://www.registradores.org con CIF B86126638.
  registry:
    'Registro Mercantil de Madrid, Tomo 28499, Folio 144, Sección 8, Hoja M-513074, Inscripción 1ª',
};
