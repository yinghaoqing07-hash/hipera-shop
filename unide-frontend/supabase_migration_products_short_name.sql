-- Product short display names for storefront cards.
-- Run this in Supabase SQL editor before deploying code that reads/writes short_name.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS short_name text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_products_short_name
  ON public.products USING gin (to_tsvector('simple', coalesce(short_name, '')));
