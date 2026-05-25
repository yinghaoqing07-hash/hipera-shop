-- =====================================================================
-- Migración: orders.customer_email
-- =====================================================================
-- Añade la columna customer_email a la tabla `orders` para soportar:
--
--   1. Envío de confirmación transaccional por Resend tras crear un
--      pedido (backend/services/email.js).
--   2. Reenvío manual del email desde el panel /admin en el futuro.
--   3. Búsqueda de pedidos por email en caso de soporte / disputa.
--
-- La columna es NULLABLE: los pedidos existentes no se ven afectados y
-- los pedidos futuros sin email (p. ej. si el cliente lo deja vacío y
-- el backend lo descarta como inválido) también pueden persistirse.
--
-- RGPD: el email es dato personal (Art. 4.1 RGPD). Su tratamiento se
-- ampara en la ejecución del contrato (Art. 6.1.b) y queda recogido
-- en la Política de Privacidad §4 (datos tratados en gestión de
-- pedidos) — verificar que la enumeración de datos incluye "correo
-- electrónico" al subir esta migración.
--
-- Plazo de conservación: el de los pedidos (6 años conforme a la
-- normativa fiscal y mercantil aplicable a documentación de ventas).
--
-- Ejecutar en Supabase → SQL Editor.
-- =====================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_email text;

-- Índice opcional (útil si se buscan pedidos por email desde el panel
-- admin con frecuencia). Comentado por defecto; descomenta si el
-- volumen de pedidos crece y aparece latencia en búsquedas:
--
-- CREATE INDEX IF NOT EXISTS idx_orders_customer_email
--   ON orders (customer_email)
--   WHERE customer_email IS NOT NULL;
