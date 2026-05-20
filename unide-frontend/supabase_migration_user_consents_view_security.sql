-- =====================================================================
-- HIPERA · Migración: corregir RLS de la vista user_consents_latest
-- =====================================================================
-- Por defecto, PostgreSQL crea las vistas en modo SECURITY DEFINER, lo
-- que hace que las consultas se ejecuten con los permisos del creador
-- (postgres) y bypassen el RLS de la tabla subyacente.
--
-- Esto significa que CUALQUIER usuario autenticado podría leer las
-- preferencias de cookies de OTROS usuarios a través de la vista,
-- aunque la tabla user_consents tenga RLS correctamente configurado.
--
-- Solución (PostgreSQL 15+, soportado por Supabase): activar
-- security_invoker para que la vista respete la sesión del consumidor
-- y por tanto el RLS de la tabla.
--
-- Aplicar en: Supabase Dashboard → SQL Editor → New Query → Run
-- =====================================================================

ALTER VIEW public.user_consents_latest SET (security_invoker = on);

-- Verificación (opcional): tras ejecutar lo de arriba, en el Table
-- Editor el badge "UNRESTRICTED" de user_consents_latest debe
-- desaparecer.
