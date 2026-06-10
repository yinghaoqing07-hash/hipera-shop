-- =====================================================================
-- Migración: groundwork de facturación VeriFactu (fiskaly)
-- =====================================================================
-- NO cambia el flujo actual de pedidos ni la impresión de tickets.
-- Solo añade columnas NULLABLE en orders para, en una fase posterior,
-- emitir facturas conformes a VeriFactu (RD 1007/2023 + Orden
-- HAC/1177/2024) a través del proveedor certificado (fiskaly).
--
-- Cuando se integre fiskaly:
--   1) Se calcula el desglose de IVA (tax_breakdown) del pedido.
--   2) Se asigna un número de factura correlativo y sin saltos con
--      next_invoice_number(series, year).
--   3) Se envía a fiskaly, que devuelve la huella (hash encadenado) y
--      el QR; se guardan en verifactu_hash / verifactu_qr y el estado
--      pasa a 'issued'.
--
-- Ejecutar en Supabase → SQL Editor.
-- =====================================================================

-- --- Columnas de facturación en orders (todas opcionales) ---
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS invoice_series      text,
  ADD COLUMN IF NOT EXISTS invoice_number      integer,
  ADD COLUMN IF NOT EXISTS invoice_full_number text,        -- p. ej. "A-2026-000123"
  ADD COLUMN IF NOT EXISTS invoice_issued_at   timestamptz,
  ADD COLUMN IF NOT EXISTS tax_breakdown       jsonb,       -- desglose por tipo de IVA
  -- Datos fiscales del cliente (solo si pide factura completa / nominal)
  ADD COLUMN IF NOT EXISTS billing_name        text,
  ADD COLUMN IF NOT EXISTS billing_nif         text,
  ADD COLUMN IF NOT EXISTS billing_address     text,
  -- Respuesta del proveedor VeriFactu (fiskaly)
  ADD COLUMN IF NOT EXISTS verifactu_status    text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS verifactu_id        text,        -- id de la factura en el proveedor
  ADD COLUMN IF NOT EXISTS verifactu_hash      text,        -- huella encadenada
  ADD COLUMN IF NOT EXISTS verifactu_qr        text;        -- contenido del QR (URL AEAT)

-- Estados válidos del ciclo de vida de la factura electrónica.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_verifactu_status_allowed'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_verifactu_status_allowed
      CHECK (verifactu_status IN ('none', 'pending', 'issued', 'error'));
  END IF;
END $$;

-- Cada (serie, número) debe ser único. Índice parcial: solo facturas ya
-- numeradas (el resto de pedidos tienen invoice_number NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_orders_invoice_series_number
  ON public.orders (invoice_series, invoice_number)
  WHERE invoice_number IS NOT NULL;

-- =====================================================================
-- Contador de facturas: numeración CORRELATIVA y SIN SALTOS
-- =====================================================================
-- VeriFactu exige que la numeración dentro de cada serie sea continua y
-- cronológica. Usamos una tabla de contadores (una fila por serie+año) y
-- una función atómica que incrementa bajo bloqueo de fila, evitando
-- condiciones de carrera y huecos.
CREATE TABLE IF NOT EXISTS public.invoice_counters (
  series      text    NOT NULL,
  year        integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (series, year)
);

-- next_invoice_number('A', 2026) -> siguiente entero de la serie A en 2026.
-- INSERT ... ON CONFLICT DO UPDATE es atómico: dos llamadas simultáneas se
-- serializan sobre la misma fila y nunca devuelven el mismo número.
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_series text, p_year integer)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_next integer;
BEGIN
  INSERT INTO public.invoice_counters (series, year, last_number)
  VALUES (p_series, p_year, 1)
  ON CONFLICT (series, year)
  DO UPDATE SET last_number = public.invoice_counters.last_number + 1
  RETURNING last_number INTO v_next;
  RETURN v_next;
END;
$$;
