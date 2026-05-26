-- =====================================================================
-- Migración: añadir columna delivery_method a orders
-- Fecha:     2026-05-27
-- =====================================================================
-- Click & Collect (recogida en tienda) se implementa como una segunda
-- modalidad de entrega además del envío a domicilio. Hasta hoy el
-- frontend asumía 100 % envío a domicilio (Política de Envíos §2.1
-- prometía recogida en tienda sin que existiera selector ni columna),
-- generando incoherencia entre la documentación legal y la UI real.
--
-- Esta migración:
--   - Añade la columna delivery_method (texto) con default
--     'home_delivery' para no romper inserts existentes.
--   - Restringe los valores admitidos al par actual mediante CHECK,
--     evitando que un payload malintencionado guarde basura.
--
-- Compatibilidad hacia atrás:
--   - Los registros existentes quedan con 'home_delivery' (el
--     comportamiento histórico).
--   - El frontend antiguo seguía enviando payloads sin delivery_method;
--     el default lo cubre. El nuevo frontend (commit que acompaña a
--     esta migración) envía siempre el campo explícito.
--
-- Plan de aplicación:
--   1. Ejecutar este SQL en Supabase (panel: Database → SQL Editor).
--   2. Desplegar el backend con el nuevo /api/orders ya preparado para
--      el campo.
--   3. Desplegar el frontend con el selector de modalidad en checkout.
-- =====================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_method text NOT NULL DEFAULT 'home_delivery';

-- Constraint defensivo: limita los valores aceptados a los modos
-- actualmente soportados. Si el día de mañana se añade 'locker' o
-- 'express', habrá que actualizar este CHECK con un nuevo bump.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_delivery_method_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_delivery_method_check
      CHECK (delivery_method IN ('home_delivery', 'store_pickup'));
  END IF;
END $$;
