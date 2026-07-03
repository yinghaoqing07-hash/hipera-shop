// =====================================================================
// Citas de reparación — solicitud pública + gestión (admin)
// =====================================================================
// El cliente envía marca/modelo/tipo + nombre + teléfono + preferencia
// de día/franja. Se guarda como "Nueva" y se avisa a la tienda por email
// (best-effort). NO reserva un hueco real: la tienda confirma después.
import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { authenticateAdmin, getVerifiedUserId } from '../middleware/auth.js';
import { repairBookingLimiter } from '../middleware/rateLimits.js';
import { isSpanishPhoneOk } from '../services/phone.js';
import { sendRepairBookingNotification } from '../services/email.js';

const router = Router();

const REPAIR_TYPES = ['pantalla', 'bateria', 'otro'];
// Cómo nos hace llegar el móvil: en tienda (gratis) o recogida a
// domicilio en Meco (5€, gratis con pedido del súper de 25€+).
const REPAIR_HANDOVERS = ['tienda', 'domicilio'];
const MAX_OPEN_BOOKINGS_PER_PHONE_24H = 3;

router.post('/api/repair-bookings', repairBookingLimiter, async (req, res) => {
  try {
    const b = req.body || {};
    const customer_name = String(b.customer_name || b.name || '').trim().slice(0, 80);
    const phoneRaw = String(b.phone || '').trim();
    if (!customer_name) {
      return res.status(400).json({ error: 'Indica tu nombre para poder confirmarte la cita.' });
    }
    if (!isSpanishPhoneOk(phoneRaw)) {
      return res.status(400).json({ error: 'El teléfono no parece válido. Revisa que sean 9 dígitos (móvil o fijo español).' });
    }
    const phone = phoneRaw.replace(/[\s.\-()]/g, '').replace(/^\+?(0034|34)/, '');

    // Email obligatorio: el presupuesto y la hora propuesta se responden
    // por email, así que sin él la solicitud no sirve de nada.
    const email = String(b.email || '').trim().slice(0, 120);
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'Indica un email válido: ahí te enviaremos el precio y la hora propuesta.' });
    }

    const repair_type = REPAIR_TYPES.includes(b.repair_type) ? b.repair_type : 'otro';
    const brand = String(b.brand || '').trim().slice(0, 60);
    const model = String(b.model || '').trim().slice(0, 60);
    const note = String(b.note || '').trim().slice(0, 500);

    const handover = REPAIR_HANDOVERS.includes(b.handover) ? b.handover : 'tienda';
    let address = String(b.address || '').trim().slice(0, 200);
    if (handover === 'domicilio' && !address) {
      return res.status(400).json({ error: 'Indica tu dirección en Meco para la recogida a domicilio.' });
    }
    if (handover === 'tienda') address = '';

    const user_id = await getVerifiedUserId(req);

    // Anti-abuso por teléfono: máximo de citas abiertas en 24 h.
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recent, error: countErr } = await supabase
        .from('repair_bookings')
        .select('id, status')
        .eq('phone', phone)
        .gte('created_at', since);
      const open = (recent || []).filter(r => !['Completada', 'Cancelada'].includes(r.status));
      if (!countErr && open.length >= MAX_OPEN_BOOKINGS_PER_PHONE_24H) {
        return res.status(429).json({
          error: 'Ya tienes varias solicitudes de cita recientes. Te contactaremos; si es urgente, llámanos.',
          code: 'RATE_LIMIT_PHONE',
        });
      }
    } catch (e) {
      // fail-open: no bloqueamos una cita legítima por un glitch de BD
      console.warn('[repair-bookings] check teléfono falló (continúo):', e?.message || e);
    }

    const payload = { brand, model, repair_type, customer_name, phone, email, note, handover, address, status: 'Nueva' };
    if (user_id) payload.user_id = user_id;

    const { data, error } = await supabase
      .from('repair_bookings')
      .insert([payload])
      .select()
      .single();
    if (error) throw error;

    // Aviso a la tienda (best-effort, no bloquea la respuesta al cliente).
    sendRepairBookingNotification(data).catch((err) =>
      console.warn('[repair-bookings] aviso a tienda falló:', err?.message || err)
    );

    res.json({ ok: true, booking: { id: data.id, status: data.status } });
  } catch (error) {
    console.error('[repair-bookings] error:', error?.message || error);
    res.status(500).json({ error: error.message });
  }
});

// ---- Gestión (admin) ----

router.get('/api/admin/repair-bookings', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('repair_bookings')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const REPAIR_BOOKING_STATUSES = ['Nueva', 'Contactado', 'Agendada', 'Completada', 'Cancelada'];

router.patch('/api/admin/repair-bookings/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!REPAIR_BOOKING_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Estado no válido. Use uno de: ${REPAIR_BOOKING_STATUSES.join(', ')}.` });
    }
    const { data, error } = await supabase
      .from('repair_bookings')
      .update({ status })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
