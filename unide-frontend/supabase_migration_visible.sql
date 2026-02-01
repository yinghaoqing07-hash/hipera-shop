-- Añadir columna visible a products (controla si se muestra en la tienda)
-- Ejecutar en Supabase: SQL Editor
ALTER TABLE products ADD COLUMN IF NOT EXISTS visible boolean DEFAULT true;
