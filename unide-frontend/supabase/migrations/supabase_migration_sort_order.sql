-- Añadir sort_order para ordenar categorías, subcategorías y productos en la tienda
-- Ejecutar en Supabase: SQL Editor

-- categories
ALTER TABLE categories ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;
UPDATE categories SET sort_order = id WHERE sort_order IS NULL;

-- sub_categories (orden dentro de cada parent)
ALTER TABLE sub_categories ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;
UPDATE sub_categories SET sort_order = id WHERE sort_order IS NULL;

-- products (orden dentro de su subcategoría/categoría)
ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;
UPDATE products SET sort_order = id WHERE sort_order IS NULL;
