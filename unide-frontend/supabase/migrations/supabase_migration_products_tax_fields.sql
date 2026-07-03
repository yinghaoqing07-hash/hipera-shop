-- HIPERA phase 2 tax groundwork.
-- Adds IVA classification fields to products without marking existing products as reviewed.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2),
  ADD COLUMN IF NOT EXISTS tax_category text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tax_review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS tax_note text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_tax_rate_allowed'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_tax_rate_allowed
      CHECK (tax_rate IS NULL OR tax_rate IN (4, 10, 21));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_tax_review_status_allowed'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_tax_review_status_allowed
      CHECK (tax_review_status IN ('pending', 'needs_review', 'ask_gestor', 'reviewed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_tax_review_status
  ON public.products (tax_review_status);

CREATE INDEX IF NOT EXISTS idx_products_tax_rate
  ON public.products (tax_rate);
