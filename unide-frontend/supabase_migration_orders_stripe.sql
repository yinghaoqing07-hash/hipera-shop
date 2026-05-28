-- =====================================================================
-- Migración: orders.stripe_session_id + orders.stripe_payment_intent
-- =====================================================================
-- Añade dos columnas para vincular un pedido con su pago en Stripe
-- (Checkout hosted). Soportan el flujo de pago en dos fases:
--
--   1. POST /api/checkout/stripe-session crea el pedido en estado
--      'Esperando pago' y guarda stripe_session_id (la sesión de
--      Checkout). En esta fase NO se descuenta stock.
--   2. El webhook checkout.session.completed marca el pedido como
--      'Procesando', guarda stripe_payment_intent (el PaymentIntent
--      cobrado) y descuenta stock + envía email + imprime.
--
-- Por qué dos columnas:
--   - stripe_session_id: permite reconciliar / depurar y evitar crear
--     sesiones duplicadas. Se escribe en la fase 1.
--   - stripe_payment_intent: es la prueba del cobro real. Su presencia
--     distingue un pedido pagado por Stripe de un Bizum manual (que no
--     la tiene). Se escribe en la fase 2 (webhook).
--
-- Ambas son NULLABLE: los pedidos existentes y los pagados por otros
-- métodos (Bizum manual, contra reembolso) quedan con NULL sin problema.
--
-- Estados nuevos introducidos en orders.status por este flujo:
--   'Esperando pago'  → sesión Stripe creada, pago aún no confirmado.
--                       NO cuenta para el límite anti-abuso por teléfono
--                       (un checkout abandonado es inofensivo: sin stock
--                       descontado). El webhook 'expired' lo pasa a
--                       'Cancelado'.
-- (Los estados existentes 'Procesando', 'Pendiente de Pago', 'Entregado',
--  'Cancelado' no cambian.)
--
-- Ejecutar en Supabase → SQL Editor.
-- =====================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS stripe_session_id text;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS stripe_payment_intent text;

-- Índice para la búsqueda por session_id en el webhook (idempotencia /
-- reconciliación). Pequeño y de alta selectividad, merece la pena.
CREATE INDEX IF NOT EXISTS idx_orders_stripe_session_id
  ON orders (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

-- =====================================================================
-- orders.confirmed_at — momento en que el pedido pasa a ser "real"
-- =====================================================================
-- La alerta de nuevos pedidos del Admin (GET /api/admin/orders/new)
-- necesita saber CUÁNDO un pedido se vuelve accionable (debe sonar el
-- aviso), que NO siempre coincide con created_at:
--
--   - Efectivo / contra reembolso / Bizum manual: accionable al crearse
--     → confirmed_at = created_at (suena al instante, como hasta ahora).
--   - Stripe (tarjeta/Bizum): el pedido se inserta como 'Esperando pago'
--     con confirmed_at = NULL (NO debe sonar). Cuando el webhook confirma
--     el cobro, se pone confirmed_at = now() → ENTONCES suena el aviso.
--
-- Sin esta columna, filtrar por created_at provocaría:
--   (a) beeps falsos por checkouts Stripe abandonados, o
--   (b) perder el beep del pago real (su created_at ya quedó fuera de la
--       ventana de polling cuando el webhook llega 1-2 min después).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- Backfill: los pedidos históricos se consideran confirmados al crearse.
UPDATE orders
  SET confirmed_at = created_at
  WHERE confirmed_at IS NULL
    AND status <> 'Esperando pago';

-- Índice para el polling de nuevos pedidos (confirmed_at > since).
CREATE INDEX IF NOT EXISTS idx_orders_confirmed_at
  ON orders (confirmed_at)
  WHERE confirmed_at IS NOT NULL;
