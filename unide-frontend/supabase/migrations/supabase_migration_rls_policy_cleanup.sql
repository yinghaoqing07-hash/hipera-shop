-- =====================================================================
-- Limpieza de políticas RLS heredadas (2026-07-03)
-- =====================================================================
-- Contexto: en la época en que el frontend hablaba directamente con
-- Supabase se crearon políticas permisivas. Hoy TODO el tráfico de
-- catálogo y pedidos pasa por el backend propio (Railway) con la
-- service role key, que ignora RLS, así que estas políticas solo
-- abrían agujeros a cualquiera con la anon key (pública en el bundle):
--
--   1) "Enable All Access Categories"    → ALL con qual=true: cualquier
--      visitante podía crear/editar/BORRAR categorías.
--   2) "Enable All Access SubCategories" → ídem con subcategorías.
--   3) "Public Insert Orders"            → INSERT con check=true:
--      permitía insertar pedidos directamente en la tabla, saltándose
--      Turnstile, rate limits, validación de teléfono y control de
--      stock del backend.
--
-- También se eliminan políticas muertas que apuntaban al placeholder
-- admin@example.com y una política de lectura duplicada.
--
-- Se CONSERVAN:
--   - "Public Read *" (catálogo público, inofensivo)
--   - "Admin Write/Manage *" (qual = auth.email() del titular)
--   - "User View Own Orders" (qual = auth.uid() = user_id)
--   - Políticas de user_consents / user_terms_acceptances (el frontend
--     sí inserta ahí directamente, acotado a la fila propia).
-- =====================================================================

drop policy if exists "Enable All Access Categories" on public.categories;
drop policy if exists "Enable All Access SubCategories" on public.sub_categories;
drop policy if exists "Public Insert Orders" on public.orders;

-- Limpieza de políticas muertas / duplicadas
drop policy if exists "Admin Delete Repairs" on public.repair_services;
drop policy if exists "Admin Insert Repairs" on public.repair_services;
drop policy if exists "Enable read access" on public.sub_categories;
