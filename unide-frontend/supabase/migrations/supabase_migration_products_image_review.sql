-- HIPERA product image review flag.
-- Marks products whose main image should be optimized later.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_needs_optimization boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_products_image_needs_optimization
  ON public.products (image_needs_optimization);
