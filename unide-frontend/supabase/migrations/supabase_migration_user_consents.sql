-- =====================================================================
-- HIPERA · Migración: tabla user_consents (GDPR / RGPD)
-- =====================================================================
-- Propósito: registrar el consentimiento de cookies de los usuarios
-- autenticados, como prueba auditable según el Art. 7(1) del RGPD.
--
-- Modelo: append-only. Cada cambio de preferencias crea un nuevo
-- registro; nunca se actualiza ni se borra (excepto cuando se borra
-- la cuenta, por cascada).
--
-- Aplicar en: Supabase Dashboard → SQL Editor → New Query → Run
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.user_consents (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Categorías de cookies (necessary siempre true por definición)
  necessary       BOOLEAN NOT NULL DEFAULT true,
  analytics       BOOLEAN NOT NULL DEFAULT false,
  marketing       BOOLEAN NOT NULL DEFAULT false,
  -- Metadatos de la decisión
  consent_version INT     NOT NULL DEFAULT 1,
  decided_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Auditoría (opcional, ayuda en caso de inspección AEPD)
  user_agent      TEXT,
  source          TEXT NOT NULL DEFAULT 'banner', -- 'banner' | 'settings' | 'reset'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Garantiza necessary=true a nivel de DB (defensa en profundidad)
  CONSTRAINT user_consents_necessary_always_true CHECK (necessary = true)
);

CREATE INDEX IF NOT EXISTS idx_user_consents_user_id
  ON public.user_consents (user_id);

CREATE INDEX IF NOT EXISTS idx_user_consents_decided_at
  ON public.user_consents (decided_at DESC);

-- =====================================================================
-- Row Level Security
-- =====================================================================
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

-- Los usuarios pueden leer su propio historial de consentimientos
DROP POLICY IF EXISTS "user_consents_select_own" ON public.user_consents;
CREATE POLICY "user_consents_select_own"
  ON public.user_consents
  FOR SELECT
  USING (auth.uid() = user_id);

-- Los usuarios pueden insertar su propio consentimiento
DROP POLICY IF EXISTS "user_consents_insert_own" ON public.user_consents;
CREATE POLICY "user_consents_insert_own"
  ON public.user_consents
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- NO se permiten UPDATE ni DELETE: append-only para mantener el rastro
-- de auditoría. La eliminación de cuenta lo cubre la cascada del FK.

-- =====================================================================
-- Vista de conveniencia: último consentimiento por usuario
-- =====================================================================
CREATE OR REPLACE VIEW public.user_consents_latest AS
SELECT DISTINCT ON (user_id)
  user_id,
  necessary,
  analytics,
  marketing,
  consent_version,
  decided_at,
  source
FROM public.user_consents
ORDER BY user_id, decided_at DESC;

GRANT SELECT ON public.user_consents_latest TO authenticated;
