-- =====================================================================
-- HIPERA · Migración: tabla user_terms_acceptances (RGPD)
-- =====================================================================
-- Registra la aceptación de Términos y Condiciones + Política de
-- Privacidad por parte de usuarios autenticados, con timestamp y
-- versión, como prueba auditable (Art. 7 RGPD + Art. 22 LSSI-CE).
--
-- Modelo: append-only. Cada aceptación crea un registro nuevo; nunca
-- se actualiza ni se borra (excepto cascada al eliminar la cuenta).
--
-- Cuándo se inserta:
--   - source='register': al registrarse (consentimiento obligatorio)
--   - source='checkout': si la versión vigente sube y el usuario
--     vuelve a confirmar en el checkout
--   - source='profile':  si en el futuro hay re-aceptación desde el
--     perfil del usuario
--
-- Aplicar en: Supabase Dashboard → SQL Editor → New Query → Run
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.user_terms_acceptances (
  id               BIGSERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  terms_version    INT  NOT NULL,
  privacy_version  INT  NOT NULL,
  accepted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source           TEXT NOT NULL DEFAULT 'register',  -- 'register' | 'checkout' | 'profile'
  user_agent       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_terms_acceptances_versions_positive CHECK (
    terms_version > 0 AND privacy_version > 0
  ),
  CONSTRAINT user_terms_acceptances_source_valid CHECK (
    source IN ('register', 'checkout', 'profile')
  )
);

CREATE INDEX IF NOT EXISTS idx_user_terms_acc_user_id
  ON public.user_terms_acceptances (user_id);

CREATE INDEX IF NOT EXISTS idx_user_terms_acc_accepted_at
  ON public.user_terms_acceptances (accepted_at DESC);

-- =====================================================================
-- Row Level Security
-- =====================================================================
ALTER TABLE public.user_terms_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_terms_acc_select_own" ON public.user_terms_acceptances;
CREATE POLICY "user_terms_acc_select_own"
  ON public.user_terms_acceptances
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_terms_acc_insert_own" ON public.user_terms_acceptances;
CREATE POLICY "user_terms_acc_insert_own"
  ON public.user_terms_acceptances
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- NO UPDATE / DELETE: append-only para mantener historial probatorio.

-- =====================================================================
-- Vista de conveniencia: última aceptación por usuario
-- (con security_invoker para respetar RLS desde el principio)
-- =====================================================================
CREATE OR REPLACE VIEW public.user_terms_acceptances_latest
WITH (security_invoker = on)
AS
SELECT DISTINCT ON (user_id)
  user_id,
  terms_version,
  privacy_version,
  accepted_at,
  source
FROM public.user_terms_acceptances
ORDER BY user_id, accepted_at DESC;

GRANT SELECT ON public.user_terms_acceptances_latest TO authenticated;
