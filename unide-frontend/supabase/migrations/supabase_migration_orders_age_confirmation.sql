-- =====================================================================
-- orders.age_confirmed_at — declaración de mayoría de edad (+18)
-- =====================================================================
-- Ley 5/2002 de la Comunidad de Madrid: prohibida la venta de bebidas
-- alcohólicas a menores de 18 años, también en venta a distancia.
-- Cuando un pedido contiene alcohol, el checkout exige marcar una
-- casilla de declaración y el backend guarda aquí el instante de esa
-- declaración como evidencia (T&C §2.2). NULL = el pedido no contenía
-- alcohol (o es anterior a esta columna).
--
-- Columna NULLABLE: no rompe pedidos existentes ni el flujo actual.
-- El backend tolera su ausencia (reintenta el INSERT sin el campo),
-- pero debe ejecutarse esta migración para que la evidencia se guarde.
alter table public.orders
  add column if not exists age_confirmed_at timestamptz;

comment on column public.orders.age_confirmed_at is
  'Momento en que el cliente declaró ser mayor de 18 años en el checkout (pedidos con bebidas alcohólicas). NULL si el pedido no contenía alcohol.';
