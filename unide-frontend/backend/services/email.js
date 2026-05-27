// =====================================================================
// Email transactional — confirmación de pedido (Resend)
// =====================================================================
// Módulo defensivo: si RESEND_API_KEY no está configurada o si el
// envío falla por cualquier razón, NO se propaga el error. El pedido
// del cliente siempre se completa con éxito en la base de datos; el
// email es una mejora best-effort y su ausencia se registra en logs
// para diagnóstico.
//
// Variables de entorno requeridas (Railway → Variables):
//   RESEND_API_KEY        — API key de https://resend.com/api-keys
//   RESEND_FROM_EMAIL     — remitente, p.ej. "HIPERA <pedidos@hipera.es>"
//                           Requiere haber verificado el dominio en Resend
//                           (DNS SPF + DKIM + MX) — instrucciones en
//                           README_BACKEND_SETUP.md.
//
// Variables opcionales:
//   RESEND_REPLY_TO       — email para respuestas (default = FROM)
//   FRONTEND_URL          — base para enlaces "Ver estado del pedido"
//                           (ya usado por CORS; reutilizamos)
//
// Cumplimiento legal (LSSI Art. 27.2 y RGPD Art. 5.1.a):
//   Estos emails son comunicaciones transaccionales de confirmación de
//   contrato, NO comerciales. No requieren consentimiento previo
//   (opt-in) y se basan en el interés legítimo del responsable +
//   ejecución contractual (Art. 6.1.b RGPD).
// =====================================================================

import { Resend } from 'resend';

let _client = null;

const getClient = () => {
  if (_client) return _client;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  _client = new Resend(key);
  return _client;
};

const FROM_DEFAULT = 'HIPERA <pedidos@hipera.es>';
const FRONTEND_DEFAULT = 'https://hipera.es';

// Aviso de arranque si Resend no está configurada en producción.
if (process.env.NODE_ENV === 'production' && !process.env.RESEND_API_KEY) {
  console.warn(
    '[Email] ⚠️ RESEND_API_KEY no configurada. Los pedidos se ' +
    'crearán correctamente pero NO se enviará confirmación al cliente. ' +
    'Configura RESEND_API_KEY y RESEND_FROM_EMAIL en las variables de ' +
    'entorno del servidor (instrucciones en README_BACKEND_SETUP.md).'
  );
}

// --- Helpers ---

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const formatEUR = (n) => {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0,00 €';
  return num.toFixed(2).replace('.', ',') + ' €';
};

const formatDate = (iso) => {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-ES', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso || '';
  }
};

const shortId = (id) => String(id || '').slice(0, 8).toUpperCase();

// =====================================================================
// Helpers de horario operativo (espejo del cálculo en src/App.jsx)
// =====================================================================
// Los valores 9 y 22 DEBEN coincidir con STORE_OPEN_HOUR/STORE_CLOSE_HOUR
// en src/App.jsx, y con openingHoursSpecification del JSON-LD en
// index.html. Si cambian, actualizar los tres sitios.
//
// Usamos Intl con timeZone: 'Europe/Madrid' para que la decisión sea
// correcta aunque el servidor esté en otra zona (Railway por defecto
// es UTC). Esto es relevante porque un pedido creado a las 22:30 hora
// española sigue siendo "fuera de horario" aunque el `created_at` en
// UTC dé 20:30.
// =====================================================================
const EMAIL_STORE_OPEN_HOUR = 9;
const EMAIL_STORE_CLOSE_HOUR = 22;

function getMadridHM(dateIso) {
  try {
    const d = new Date(dateIso);
    if (Number.isNaN(d.getTime())) return null;
    const fmt = new Intl.DateTimeFormat('es-ES', {
      timeZone: 'Europe/Madrid',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const hh = parts.find(p => p.type === 'hour')?.value || '00';
    const mm = parts.find(p => p.type === 'minute')?.value || '00';
    return { hour: parseInt(hh, 10), minute: parseInt(mm, 10) };
  } catch {
    return null;
  }
}

// True si la fecha del pedido cae FUERA del horario operativo
// (antes de las 09:00 o desde las 22:00 inclusive). Para fechas
// no parseables devuelve false: preferimos NO mostrar el aviso a
// mostrarlo erróneamente.
function isAfterHoursISO(dateIso) {
  const hm = getMadridHM(dateIso);
  if (!hm) return false;
  const minuteOfDay = hm.hour * 60 + hm.minute;
  const openMin = EMAIL_STORE_OPEN_HOUR * 60;
  const closeMin = EMAIL_STORE_CLOSE_HOUR * 60;
  return minuteOfDay < openMin || minuteOfDay >= closeMin;
}

// --- Templates ---

const renderItemsHtml = (items = []) => items
  .map((it) => {
    const name = escapeHtml(it?.name || 'Producto');
    const qty = Number(it?.quantity) || 0;
    const price = Number(it?.price) || 0;
    const subtotal = qty * price;
    const tags = [];
    if (it?.isGift) tags.push('<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:11px;padding:2px 6px;border-radius:4px;margin-left:6px;">REGALO</span>');
    if (it?.isService) tags.push('<span style="display:inline-block;background:#dbeafe;color:#1e40af;font-size:11px;padding:2px 6px;border-radius:4px;margin-left:6px;">SERVICIO</span>');
    return `
      <tr>
        <td style="padding:10px 6px;border-bottom:1px solid #f1f5f9;color:#0f172a;font-size:14px;">${name}${tags.join('')}</td>
        <td style="padding:10px 6px;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:14px;text-align:center;">×${qty}</td>
        <td style="padding:10px 6px;border-bottom:1px solid #f1f5f9;color:#0f172a;font-size:14px;text-align:right;white-space:nowrap;">${formatEUR(subtotal)}</td>
      </tr>`;
  })
  .join('');

const renderItemsText = (items = []) => items
  .map((it) => {
    const name = it?.name || 'Producto';
    const qty = Number(it?.quantity) || 0;
    const price = Number(it?.price) || 0;
    const tags = [];
    if (it?.isGift) tags.push('[REGALO]');
    if (it?.isService) tags.push('[SERVICIO]');
    const flag = tags.length ? ' ' + tags.join(' ') : '';
    return `  - ${name}${flag} × ${qty} = ${formatEUR(qty * price)}`;
  })
  .join('\n');

const renderOrderHtml = (order, frontendUrl) => {
  const id = shortId(order.id);
  // IMPORTANTE: el parámetro DEBE ser ?order= (no ?orderId=). El frontend
  // (src/App.jsx) sólo escucha urlParams.get('order'), y el QR de la
  // factura PDF también usa este nombre. Si se rompe la coherencia, el
  // enlace del email cae a la home en lugar de abrir el seguimiento.
  const trackingUrl = `${frontendUrl}/?order=${encodeURIComponent(order.id)}`;
  const statusBadge = order.status === 'Pendiente de Pago'
    ? '<span style="display:inline-block;background:#ffedd5;color:#9a3412;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;">Pendiente de pago</span>'
    : '<span style="display:inline-block;background:#dcfce7;color:#166534;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;">En preparación</span>';

  // Bloque "Datos de entrega" adaptado a la modalidad: envío a
  // domicilio muestra la dirección del cliente, recogida en tienda
  // muestra dirección de HIPERA y aclara que avisaremos cuando esté
  // listo. La compatibilidad hacia atrás está garantizada: si
  // delivery_method es null/undefined (datos previos a la migración)
  // se interpreta como envío a domicilio.
  const isStorePickup = order.delivery_method === 'store_pickup';
  const deliveryHeading = isStorePickup ? 'Recogida en tienda' : 'Datos de envío';

  // Aviso de "pedido fuera de horario": si created_at cae fuera de
  // 09:00–22:00 Madrid, el cliente debe saber que su pedido NO se
  // procesará al instante. Sin este bloque, alguien que pide a las
  // 03:00 espera entrega "en un par de horas" según la Política de
  // Envíos, lo cual genera quejas legítimas.
  const afterHoursBlock = isAfterHoursISO(order.created_at)
    ? `<div style="font-size:13px;color:#92400e;background:#fef3c7;border:1px solid #fde68a;padding:12px 14px;border-radius:10px;margin:0 0 16px 0;line-height:1.55;">
        <strong>Pedido fuera de horario.</strong> Ahora mismo estamos cerrados;
        empezaremos a preparar tu pedido cuando abramos
        (Lunes a Domingo de 09:00 a 22:00, hora peninsular).
       </div>`
    : '';
  const deliveryBlock = isStorePickup
    ? `<div style="font-size:14px;color:#0f172a;line-height:1.6;margin-bottom:8px;">
        <strong>HIPERA</strong><br/>
        Paseo del Sol 1, 28880 Meco (Madrid)<br/>
        <span style="color:#64748b;">Tel.</span> +34 918 782 602<br/>
        <span style="color:#64748b;">Horario:</span> Lunes a Domingo, 09:00 – 22:00
       </div>
       <div style="font-size:13px;color:#475569;background:#ecfeff;border:1px solid #cffafe;padding:10px 12px;border-radius:8px;margin-bottom:16px;">
         Te avisaremos por email o teléfono en cuanto tu pedido esté listo para recoger. Trae este correo (o el número de pedido <strong>#${id}</strong>) para identificarte.
       </div>`
    : `<div style="font-size:14px;color:#0f172a;line-height:1.6;margin-bottom:16px;">
        ${escapeHtml(order.address || '—')}<br/>
        <span style="color:#64748b;">Tel.</span> ${escapeHtml(order.phone || '—')}
       </div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Confirmación de pedido</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;">
    <tr><td align="center" style="padding:24px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">

        <tr><td style="background:#dc2626;padding:24px 28px;">
          <div style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.02em;">HIPERA</div>
          <div style="color:#fecaca;font-size:13px;margin-top:2px;">Alimentación · Bazar · Reparación móvil</div>
        </td></tr>

        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 4px 0;font-size:22px;font-weight:700;color:#0f172a;">¡Pedido confirmado!</h1>
          <p style="margin:0 0 20px 0;font-size:14px;color:#64748b;">Gracias por confiar en HIPERA. Hemos recibido tu pedido y lo estamos preparando.</p>

          ${afterHoursBlock}

          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;background:#f8fafc;border-radius:12px;padding:16px;">
            <tr>
              <td style="padding:12px 16px;">
                <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Nº de pedido</div>
                <div style="font-size:18px;font-weight:700;color:#0f172a;margin-top:2px;">#${id}</div>
                <div style="font-size:12px;color:#64748b;margin-top:6px;">${escapeHtml(formatDate(order.created_at))}</div>
                <div style="margin-top:10px;">${statusBadge}</div>
              </td>
            </tr>
          </table>

          <div style="font-size:13px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 8px 0;">Productos</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;border-top:1px solid #e2e8f0;">
            ${renderItemsHtml(order.items)}
            <tr>
              <td colspan="2" style="padding:14px 6px 0 6px;text-align:right;font-size:14px;font-weight:700;color:#0f172a;">Total</td>
              <td style="padding:14px 6px 0 6px;text-align:right;font-size:18px;font-weight:800;color:#dc2626;white-space:nowrap;">${formatEUR(order.total)}</td>
            </tr>
          </table>

          <div style="font-size:13px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.04em;margin:16px 0 8px 0;">${deliveryHeading}</div>
          ${deliveryBlock}

          ${order.payment_method ? `
          <div style="font-size:13px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.04em;margin:16px 0 8px 0;">Forma de pago</div>
          <div style="font-size:14px;color:#0f172a;margin-bottom:16px;">${escapeHtml(order.payment_method)}</div>
          ` : ''}

          ${order.note ? `
          <div style="font-size:13px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.04em;margin:16px 0 8px 0;">Nota</div>
          <div style="font-size:14px;color:#475569;background:#fef9c3;padding:10px 12px;border-radius:8px;margin-bottom:16px;">${escapeHtml(order.note)}</div>
          ` : ''}

          <div style="margin:24px 0 12px 0;text-align:center;">
            <a href="${trackingUrl}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:14px 28px;border-radius:12px;">Ver estado del pedido</a>
          </div>

          <p style="margin:24px 0 0 0;font-size:12px;color:#94a3b8;line-height:1.6;">
            Si tienes cualquier duda, responde a este email o contáctanos por WhatsApp.
            Para reclamaciones, devoluciones o cambios consulta nuestra
            <a href="${frontendUrl}/?legal=devoluciones" style="color:#64748b;">Política de Devoluciones</a>
            (14 días naturales conforme al Art. 102 RDLeg 1/2007).
          </p>
        </td></tr>

        <tr><td style="background:#f8fafc;padding:18px 28px;border-top:1px solid #e2e8f0;">
          <div style="font-size:12px;color:#94a3b8;line-height:1.6;">
            HIPERA · Paseo del Sol 1, 28880 Meco, Madrid<br/>
            Este correo se envía como confirmación de tu pedido (LSSI-CE Art. 27).
            No es publicidad ni requiere acción salvo lo indicado.
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
};

const renderOrderText = (order, frontendUrl) => {
  const id = shortId(order.id);
  // Misma coherencia que renderOrderHtml: ?order= (no ?orderId=).
  const trackingUrl = `${frontendUrl}/?order=${encodeURIComponent(order.id)}`;
  const lines = [
    '¡Pedido confirmado!',
    '',
    `Nº de pedido: #${id}`,
    `Fecha: ${formatDate(order.created_at)}`,
    `Estado: ${order.status || 'Procesando'}`,
    '',
  ];
  if (isAfterHoursISO(order.created_at)) {
    lines.push(
      '** PEDIDO FUERA DE HORARIO **',
      'Ahora estamos cerrados; empezaremos a preparar tu pedido',
      'cuando abramos (L-D 09:00-22:00, hora peninsular).',
      '',
    );
  }
  lines.push(
    'PRODUCTOS',
    '--------',
    renderItemsText(order.items),
    '',
    `TOTAL: ${formatEUR(order.total)}`,
    '',
  );
  // Bloque de entrega adaptado al método. Misma lógica que la versión
  // HTML: store_pickup → instrucciones de recogida en HIPERA; en otro
  // caso (incluido datos antiguos sin delivery_method) → datos de envío.
  if (order.delivery_method === 'store_pickup') {
    lines.push(
      'RECOGIDA EN TIENDA',
      '------------------',
      'HIPERA · Paseo del Sol 1, 28880 Meco (Madrid)',
      'Tel.: +34 918 782 602',
      'Horario: Lunes a Domingo, 09:00 – 22:00',
      '',
      `Te avisaremos cuando esté listo para recoger. Trae el número de pedido #${id}.`,
      `Teléfono de contacto: ${order.phone || '—'}`,
    );
  } else {
    lines.push(
      'DATOS DE ENVÍO',
      '--------------',
      `Dirección: ${order.address || '—'}`,
      `Teléfono: ${order.phone || '—'}`,
    );
  }
  if (order.payment_method) lines.push(`Forma de pago: ${order.payment_method}`);
  if (order.note) lines.push('', `Nota: ${order.note}`);
  lines.push('', `Ver estado: ${trackingUrl}`, '');
  lines.push('---');
  lines.push('HIPERA · Paseo del Sol 1, 28880 Meco, Madrid');
  lines.push('Confirmación transaccional (LSSI-CE Art. 27).');
  return lines.join('\n');
};

// --- Public API ---

/**
 * Envía un email de confirmación de pedido. NO bloquea ni propaga
 * errores: si Resend falla, devuelve { error } y registra en logs.
 *
 * @param {Object} order Fila completa de la tabla orders.
 * @param {string} email Dirección del destinatario.
 * @returns {Promise<{id?:string, skipped?:boolean, error?:string}>}
 */
export async function sendOrderConfirmationEmail(order, email) {
  const client = getClient();
  if (!client) {
    return { skipped: true, reason: 'RESEND_API_KEY missing' };
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return { skipped: true, reason: 'invalid recipient email' };
  }
  if (!order || !order.id) {
    return { skipped: true, reason: 'invalid order object' };
  }

  const from = process.env.RESEND_FROM_EMAIL || FROM_DEFAULT;
  const replyTo = process.env.RESEND_REPLY_TO || undefined;
  const frontendUrl = (process.env.FRONTEND_URL || FRONTEND_DEFAULT).replace(/\/$/, '');

  try {
    const subject = `Pedido confirmado #${shortId(order.id)} · HIPERA`;
    const html = renderOrderHtml(order, frontendUrl);
    const text = renderOrderText(order, frontendUrl);

    const payload = { from, to: email, subject, html, text };
    if (replyTo) payload.reply_to = replyTo;

    const { data, error } = await client.emails.send(payload);
    if (error) {
      console.error('[Email] Resend error:', error?.message || error);
      return { error: error?.message || 'Resend error' };
    }
    console.log(`[Email] ✉️  Confirmación enviada — pedido=${shortId(order.id)} → ${email} (id=${data?.id || 'n/a'})`);
    return { id: data?.id };
  } catch (e) {
    console.error('[Email] Exception sending order confirmation:', e?.message || e);
    return { error: e?.message || 'unknown' };
  }
}
