-- =====================================================================
-- Migración: orders.coupon_code + orders.discount  (cupones de promoción)
-- =====================================================================
-- Soporte para cupones de descuento (campaña de lanzamiento). Cuando un
-- pedido aplica un cupón válido guardamos:
--   • coupon_code : el código aplicado, normalizado en MAYÚSCULAS
--                   (p. ej. 'BIENVENIDA10'). NULL si no se usó cupón.
--   • discount    : el importe descontado en euros (>= 0). 0 por defecto.
--
-- El descuento se calcula y valida SIEMPRE en el backend (config del
-- cupón + comprobaciones de mínimo/caducidad/uso único). El cliente no
-- puede inflar el descuento: el servidor recalcula sobre el subtotal y
-- guarda aquí el valor autoritativo. `total` ya es el importe final
-- (con el descuento ya restado).
--
-- El uso único por cliente se comprueba consultando esta misma columna:
-- un cupón se considera "ya usado" si existe otro pedido del mismo
-- usuario (o teléfono) con el mismo coupon_code y estado distinto de
-- 'Esperando pago' / 'Cancelado'.
--
-- Ejecutar en Supabase → SQL Editor.
-- =====================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS discount numeric NOT NULL DEFAULT 0;

-- Índice para la comprobación de "uso único por cliente": filtramos por
-- coupon_code. Parcial (solo filas que realmente usaron un cupón) para
-- mantenerlo pequeño y selectivo.
CREATE INDEX IF NOT EXISTS idx_orders_coupon_code
  ON orders (coupon_code)
  WHERE coupon_code IS NOT NULL;
