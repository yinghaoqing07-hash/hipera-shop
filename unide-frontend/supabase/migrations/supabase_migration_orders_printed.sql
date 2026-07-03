-- =====================================================================
-- Migración: orders.printed_at  (impresión automática de tickets)
-- =====================================================================
-- El agente de impresión de la tienda (PC Win10 con la Xprinter XP-80T)
-- consulta el backend cada pocos segundos y imprime los pedidos que:
--     confirmed_at IS NOT NULL   (ya confirmados / pagados)
--   AND printed_at  IS NULL      (todavía no impresos)
--
-- printed_at marca CUÁNDO se imprimió el ticket. Sirve como antídoto
-- principal contra la doble impresión: una vez impreso y marcado, el
-- pedido deja de aparecer en /api/print/pending. (El agente además
-- guarda un registro local como segunda barrera.)
--
-- ⚠️ BACKFILL OBLIGATORIO:
--   Marcamos TODOS los pedidos existentes como ya impresos (printed_at =
--   now()). Sin esto, la primera vez que arranque el agente imprimiría
--   de golpe TODO el histórico de pedidos. A partir de la migración solo
--   se imprimen los pedidos que se confirmen DESPUÉS.
--
-- Ejecutar en Supabase → SQL Editor.
-- =====================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS printed_at timestamptz;

-- Backfill: todo lo anterior a esta migración se considera "ya impreso"
-- para que el agente no saque el histórico al arrancar por primera vez.
UPDATE orders
  SET printed_at = now()
  WHERE printed_at IS NULL;

-- Índice parcial para la cola de impresión: el agente busca pedidos
-- confirmados y aún no impresos. Es un índice pequeño (solo filas con
-- printed_at NULL, que normalmente serán muy pocas: las pendientes de
-- imprimir) y de alta selectividad.
CREATE INDEX IF NOT EXISTS idx_orders_print_queue
  ON orders (confirmed_at)
  WHERE printed_at IS NULL AND confirmed_at IS NOT NULL;
