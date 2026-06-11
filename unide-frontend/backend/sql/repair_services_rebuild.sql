-- =====================================================================
-- Rebuild del catálogo repair_services: nombres consistentes + orden curado
-- =====================================================================
-- Esta tabla solo alimenta el autocompletado (chips + datalist) del
-- formulario de cita. Comprobado: ninguna fila tiene precio/tipo propios
-- (todo price=0, repair_type='') y repair_bookings guarda brand/model como
-- TEXTO (no hay FK a repair_services.id), así que es seguro vaciar y
-- reinsertar.
--
-- Convención unificada: de MÁS NUEVO a MÁS ANTIGUO, agrupado por línea de
-- producto. El frontend muestra los modelos en el orden de la tabla (id
-- ascendente), por eso el orden de inserción de abajo ES el orden visible.
-- 'brand' se mantiene en minúscula (los chips filtran case-insensitive).
--
-- Idempotente: borra todo y reinserta. Se puede re-ejecutar sin duplicar.
-- =====================================================================

BEGIN;

DELETE FROM public.repair_services;

INSERT INTO public.repair_services (brand, model, title, repair_type, price, description)
SELECT v.brand, v.model, v.brand || ' ' || v.model, '', 0,
       'Incluye limpieza interna + Cristal y Funda (o Cargador) de REGALO.'
FROM (VALUES
  -- ===== Apple (nuevo → antiguo) =====
  (1,  'apple', 'iPhone 17 Pro Max'),
  (2,  'apple', 'iPhone 17 Pro'),
  (3,  'apple', 'iPhone 17 Air'),
  (4,  'apple', 'iPhone 17'),
  (5,  'apple', 'iPhone 16 Pro Max'),
  (6,  'apple', 'iPhone 16 Pro'),
  (7,  'apple', 'iPhone 16 Plus'),
  (8,  'apple', 'iPhone 16'),
  (9,  'apple', 'iPhone 16e'),
  (10, 'apple', 'iPhone 15 Pro Max'),
  (11, 'apple', 'iPhone 15 Pro'),
  (12, 'apple', 'iPhone 15 Plus'),
  (13, 'apple', 'iPhone 15'),
  (14, 'apple', 'iPhone 14 Pro Max'),
  (15, 'apple', 'iPhone 14 Pro'),
  (16, 'apple', 'iPhone 14 Plus'),
  (17, 'apple', 'iPhone 14'),
  (18, 'apple', 'iPhone 13 Pro Max'),
  (19, 'apple', 'iPhone 13 Pro'),
  (20, 'apple', 'iPhone 13'),
  (21, 'apple', 'iPhone 13 mini'),
  (22, 'apple', 'iPhone 12 Pro Max'),
  (23, 'apple', 'iPhone 12 Pro'),
  (24, 'apple', 'iPhone 12'),
  (25, 'apple', 'iPhone 12 mini'),
  (26, 'apple', 'iPhone 11 Pro Max'),
  (27, 'apple', 'iPhone 11 Pro'),
  (28, 'apple', 'iPhone 11'),
  (29, 'apple', 'iPhone XS Max'),
  (30, 'apple', 'iPhone XS'),
  (31, 'apple', 'iPhone XR'),
  (32, 'apple', 'iPhone X'),
  (33, 'apple', 'iPhone SE (2022)'),

  -- ===== Samsung (línea S → A → Z → M, nuevo → antiguo) =====
  (34, 'samsung', 'Galaxy S25 Ultra'),
  (35, 'samsung', 'Galaxy S25 Edge'),
  (36, 'samsung', 'Galaxy S25+'),
  (37, 'samsung', 'Galaxy S25'),
  (38, 'samsung', 'Galaxy S24 Ultra'),
  (39, 'samsung', 'Galaxy S24+'),
  (40, 'samsung', 'Galaxy S24'),
  (41, 'samsung', 'Galaxy S23 Ultra'),
  (42, 'samsung', 'Galaxy S23+'),
  (43, 'samsung', 'Galaxy S23'),
  (44, 'samsung', 'Galaxy S22 Ultra'),
  (45, 'samsung', 'Galaxy S22+'),
  (46, 'samsung', 'Galaxy S22'),
  (47, 'samsung', 'Galaxy S21'),
  (48, 'samsung', 'Galaxy A55'),
  (49, 'samsung', 'Galaxy A54 5G'),
  (50, 'samsung', 'Galaxy A52 / A52s'),
  (51, 'samsung', 'Galaxy A35'),
  (52, 'samsung', 'Galaxy A34 5G'),
  (53, 'samsung', 'Galaxy A32'),
  (54, 'samsung', 'Galaxy A25'),
  (55, 'samsung', 'Galaxy A24'),
  (56, 'samsung', 'Galaxy A16'),
  (57, 'samsung', 'Galaxy A15'),
  (58, 'samsung', 'Galaxy A14'),
  (59, 'samsung', 'Galaxy A13'),
  (60, 'samsung', 'Galaxy Z Fold7'),
  (61, 'samsung', 'Galaxy Z Flip7'),
  (62, 'samsung', 'Galaxy Z Fold6'),
  (63, 'samsung', 'Galaxy Z Flip6'),
  (64, 'samsung', 'Galaxy Z Fold5'),
  (65, 'samsung', 'Galaxy Z Flip5'),
  (66, 'samsung', 'Galaxy M54'),

  -- ===== Xiaomi (Xiaomi → Redmi Note → Redmi → POCO, nuevo → antiguo) =====
  (67, 'xiaomi', 'Xiaomi 15 Ultra'),
  (68, 'xiaomi', 'Xiaomi 15 Pro'),
  (69, 'xiaomi', 'Xiaomi 15'),
  (70, 'xiaomi', 'Xiaomi 14 Pro'),
  (71, 'xiaomi', 'Xiaomi 14'),
  (72, 'xiaomi', 'Xiaomi 13 Pro'),
  (73, 'xiaomi', 'Xiaomi 13'),
  (74, 'xiaomi', 'Xiaomi 13T'),
  (75, 'xiaomi', 'Xiaomi 12T'),
  (76, 'xiaomi', 'Xiaomi 12'),
  (77, 'xiaomi', 'Xiaomi Mi 11'),
  (78, 'xiaomi', 'Redmi Note 14 Pro'),
  (79, 'xiaomi', 'Redmi Note 14'),
  (80, 'xiaomi', 'Redmi Note 13 Pro'),
  (81, 'xiaomi', 'Redmi Note 13'),
  (82, 'xiaomi', 'Redmi Note 12 Pro'),
  (83, 'xiaomi', 'Redmi Note 12'),
  (84, 'xiaomi', 'Redmi Note 11'),
  (85, 'xiaomi', 'Redmi Note 10'),
  (86, 'xiaomi', 'Redmi 12'),
  (87, 'xiaomi', 'Redmi 11'),
  (88, 'xiaomi', 'Redmi 10'),
  (89, 'xiaomi', 'POCO F6'),
  (90, 'xiaomi', 'POCO F5'),
  (91, 'xiaomi', 'POCO X6 Pro'),
  (92, 'xiaomi', 'POCO X6'),
  (93, 'xiaomi', 'POCO X5 / X5 Pro'),
  (94, 'xiaomi', 'POCO M5 / M5s'),

  -- ===== OPPO (Find X → Reno → A, nuevo → antiguo) =====
  (95,  'oppo', 'OPPO Find X9 Pro'),
  (96,  'oppo', 'OPPO Find X9'),
  (97,  'oppo', 'OPPO Find X8 Pro'),
  (98,  'oppo', 'OPPO Find X8'),
  (99,  'oppo', 'OPPO Find X7'),
  (100, 'oppo', 'OPPO Find X6 Pro'),
  (101, 'oppo', 'OPPO Find X6'),
  (102, 'oppo', 'OPPO Reno12 Pro'),
  (103, 'oppo', 'OPPO Reno12'),
  (104, 'oppo', 'OPPO Reno11 Pro'),
  (105, 'oppo', 'OPPO Reno11'),
  (106, 'oppo', 'OPPO Reno10 Pro'),
  (107, 'oppo', 'OPPO Reno10'),
  (108, 'oppo', 'OPPO A78'),
  (109, 'oppo', 'OPPO A77 / A77s'),
  (110, 'oppo', 'OPPO A58'),
  (111, 'oppo', 'OPPO A54'),
  (112, 'oppo', 'OPPO A53'),
  (113, 'oppo', 'OPPO A16 / A16s'),
  (114, 'oppo', 'OPPO A15')
) AS v(ord, brand, model)
ORDER BY v.ord;

COMMIT;
