// Enlaces wa.me PRE-RELLENADOS para avisar al cliente con un solo toque
// (el admin pulsa y se abre WhatsApp con el mensaje y el destinatario ya
// puestos). No es envío automático: WhatsApp sólo permite mensajes
// proactivos vía la Cloud API con plantillas aprobadas por Meta. Esto es
// el término medio sin esa infraestructura.

// Normaliza el teléfono a formato internacional español. Devuelve null si
// no hay un teléfono utilizable.
function waPhoneDigits(order) {
  let digits = String(order?.phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0034')) digits = digits.slice(2);
  // Teléfono español sin prefijo: 9 dígitos empezando por 6/7/8/9 → +34.
  if (digits.length === 9 && /^[6789]/.test(digits)) digits = '34' + digits;
  if (digits.length < 11) return null; // no parece un internacional válido
  return digits;
}

export function buildRefundWhatsappLink(order, reason, refundType, amount = null) {
  const digits = waPhoneDigits(order);
  if (!digits) return null;

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

// Aviso de "pedido listo para recoger", incluyendo el código de recogida
// como comprobante. Devuelve null si no hay teléfono utilizable.
export function buildPickupReadyWhatsappLink(order, code) {
  const digits = waPhoneDigits(order);
  if (!digits) return null;

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
