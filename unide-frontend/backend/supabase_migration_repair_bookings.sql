-- =====================================================================
-- Migración: tabla repair_bookings (solicitudes de cita de reparación)
-- =====================================================================
-- Almacena las solicitudes de cita que el cliente envía desde la página
-- /repair. NO es una agenda con franjas reservables: es una "solicitud"
-- que la tienda confirma después (por WhatsApp/teléfono). Por eso los
-- campos de fecha/hora son preferencias gruesas (día + franja), no slots.
--
-- El backend escribe con la service-role key (bypassea RLS), igual que
-- con orders/products. No se exponen políticas RLS públicas: la lectura
-- siempre pasa por endpoints /api/admin/* autenticados.
--
-- Ejecutar una vez en el SQL Editor de Supabase.
-- =====================================================================

create table if not exists public.repair_bookings (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  -- Dispositivo (puede venir preseleccionado desde el catálogo o escrito
  -- a mano si el cliente eligió "No encuentro mi modelo").
  brand          text default '',
  model          text default '',
  repair_type    text default '',          -- 'pantalla' | 'bateria' | 'otro'
  -- Contacto del cliente (obligatorio para poder confirmar la cita).
  customer_name  text not null,
  phone          text not null,
  -- Preferencia de cita (gruesa): día + franja. La tienda concreta luego.
  preferred_day  text default '',          -- 'Hoy' | 'Mañana'
  preferred_slot text default '',          -- 'Mañana' | 'Tarde'
  note           text default '',
  -- Estado del flujo de atención (lo gestiona la tienda en el panel).
  status         text not null default 'Nueva',  -- Nueva | Contactado | Agendada | Completada | Cancelada
  -- Si el cliente estaba logueado, vinculamos su cuenta (opcional).
  user_id        uuid
);

-- Índices para el panel de administración (listar recientes, filtrar por
-- estado) y para el anti-abuso por teléfono (conteo en ventana de 24 h).
create index if not exists repair_bookings_created_at_idx on public.repair_bookings (created_at desc);
create index if not exists repair_bookings_status_idx     on public.repair_bookings (status);
create index if not exists repair_bookings_phone_idx       on public.repair_bookings (phone);

-- RLS activado sin políticas públicas: solo la service-role key (backend)
-- puede leer/escribir. El frontend nunca accede directamente a la tabla.
alter table public.repair_bookings enable row level security;
