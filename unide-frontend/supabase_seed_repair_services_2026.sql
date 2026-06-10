-- =====================================================================
-- Seed: modelos recientes para repair_services (Apple 16/17, Samsung S25 + A,
-- plegables Z6/Z7, Xiaomi 15 / Redmi Note 14 / POCO).
-- Idempotente: usa WHERE NOT EXISTS, se puede ejecutar varias veces sin duplicar.
-- Solo alimenta el autocompletado del formulario de cita (precio y tipo se
-- gestionan luego desde Admin > Reparaciones).
-- =====================================================================

insert into public.repair_services (brand, model, title, repair_type, price, description)
select
  v.brand,
  v.model,
  v.brand || ' ' || v.model,
  '',
  0,
  'Incluye limpieza interna + Cristal y Funda (o Cargador) de REGALO.'
from (values
  -- Apple (estilo existente: 'iphone' en minúscula)
  ('apple', 'iphone 16'),
  ('apple', 'iphone 16plus'),
  ('apple', 'iphone 16pro'),
  ('apple', 'iphone 16pro max'),
  ('apple', 'iphone 16e'),
  ('apple', 'iphone 17'),
  ('apple', 'iphone 17 Air'),
  ('apple', 'iphone 17pro'),
  ('apple', 'iphone 17pro max'),
  ('apple', 'iphone SE (2022)'),

  -- Samsung
  ('samsung', 'Galaxy S25'),
  ('samsung', 'Galaxy S25+'),
  ('samsung', 'Galaxy S25 Ultra'),
  ('samsung', 'Galaxy S25 Edge'),
  ('samsung', 'Galaxy A15'),
  ('samsung', 'Galaxy A16'),
  ('samsung', 'Galaxy A25'),
  ('samsung', 'Galaxy A35'),
  ('samsung', 'Galaxy A55'),
  ('samsung', 'Galaxy Z Flip6'),
  ('samsung', 'Galaxy Z Fold6'),
  ('samsung', 'Galaxy Z Flip7'),
  ('samsung', 'Galaxy Z Fold7'),

  -- Xiaomi
  ('xiaomi', 'Xiaomi 15'),
  ('xiaomi', 'Xiaomi 15 Pro'),
  ('xiaomi', 'Xiaomi 15 Ultra'),
  ('xiaomi', 'Redmi Note 14'),
  ('xiaomi', 'Redmi Note 14 Pro'),
  ('xiaomi', 'POCO X6'),
  ('xiaomi', 'POCO X6 Pro'),
  ('xiaomi', 'POCO F6')
) as v(brand, model)
where not exists (
  select 1 from public.repair_services r
  where lower(r.brand) = lower(v.brand)
    and lower(r.model) = lower(v.model)
);
