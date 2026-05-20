// =====================================================================
// useCookieConsent · Hook de gestión de consentimiento de cookies (RGPD)
// =====================================================================
// Estado global compartido vía un store de módulo (sin React Context,
// para no envolver toda App.jsx en un provider). Todas las instancias
// del hook ven el mismo estado y se re-renderizan al cambiar.
//
// API:
//   const {
//     consent,         // null si no ha decidido aún; objeto si ya decidió
//     hasDecided,      // boolean
//     hasConsent,      // (category) => boolean
//     acceptAll,       // () => Promise<void>
//     rejectAll,       // () => Promise<void>
//     saveCustom,      // ({ analytics, marketing }) => Promise<void>
//     openSettings,    // () => void   (re-mostrar el modal Configurar)
//     closeSettings,   // () => void
//     isSettingsOpen,  // boolean
//   } = useCookieConsent();
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const STORAGE_KEY = 'cookieConsentV2';
const LEGACY_KEY = 'cookieConsent';
const CONSENT_VERSION = 1;

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.decided_at !== 'string') return null;
    return {
      necessary: true,
      analytics: !!parsed.analytics,
      marketing: !!parsed.marketing,
      decided_at: parsed.decided_at,
      consent_version: parsed.consent_version || 1,
    };
  } catch {
    return null;
  }
}

function writeStorage(consent) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
  } catch {
    // localStorage puede fallar en modo privado / quota; degradamos en silencio
  }
}

async function syncToSupabase(consent, source) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    await supabase.from('user_consents').insert({
      user_id: session.user.id,
      necessary: true,
      analytics: consent.analytics,
      marketing: consent.marketing,
      consent_version: CONSENT_VERSION,
      user_agent: navigator.userAgent?.slice(0, 500) || null,
      source,
    });
  } catch (e) {
    if (!import.meta.env.PROD) console.warn('[cookieConsent] DB sync skipped:', e?.message);
  }
}

// ---------------------------------------------------------------------
// Store de módulo (singleton). Compartido por todas las instancias del hook.
// ---------------------------------------------------------------------
let store = {
  consent: readStorage(),
  isSettingsOpen: false,
};
const subscribers = new Set();

function setStore(patch) {
  store = { ...store, ...patch };
  subscribers.forEach((fn) => fn(store));
}

// Limpieza one-shot: si existe el formato antiguo (string 'true'/'false'),
// lo eliminamos para forzar nueva decisión bajo el formato v2 (con
// categorías y timestamp). Cumple mejor con el Art. 7 del RGPD.
(function migrateLegacyKey() {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === 'true' || legacy === 'false') {
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch { /* ignore */ }
})();

// ---------------------------------------------------------------------
// Hook público
// ---------------------------------------------------------------------
export function useCookieConsent() {
  const [snapshot, setSnapshot] = useState(store);

  useEffect(() => {
    subscribers.add(setSnapshot);
    // Sincronización cross-tab: si el usuario cambia el consentimiento
    // en otra pestaña, propagamos el cambio aquí.
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) setStore({ consent: readStorage() });
    };
    window.addEventListener('storage', onStorage);
    return () => {
      subscribers.delete(setSnapshot);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const persist = useCallback(async (next, source) => {
    const fullConsent = {
      necessary: true,
      analytics: !!next.analytics,
      marketing: !!next.marketing,
      decided_at: new Date().toISOString(),
      consent_version: CONSENT_VERSION,
    };
    writeStorage(fullConsent);
    setStore({ consent: fullConsent, isSettingsOpen: false });
    await syncToSupabase(fullConsent, source);
  }, []);

  const acceptAll = useCallback(
    () => persist({ analytics: true, marketing: true }, 'banner'),
    [persist]
  );

  const rejectAll = useCallback(
    () => persist({ analytics: false, marketing: false }, 'banner'),
    [persist]
  );

  const saveCustom = useCallback(
    (categories) => persist(
      { analytics: !!categories?.analytics, marketing: !!categories?.marketing },
      'settings'
    ),
    [persist]
  );

  const openSettings = useCallback(() => setStore({ isSettingsOpen: true }), []);
  const closeSettings = useCallback(() => setStore({ isSettingsOpen: false }), []);

  const hasConsent = useCallback(
    (category) => {
      if (category === 'necessary') return true;
      if (!snapshot.consent) return false;
      return !!snapshot.consent[category];
    },
    [snapshot.consent]
  );

  return {
    consent: snapshot.consent,
    hasDecided: !!snapshot.consent,
    hasConsent,
    acceptAll,
    rejectAll,
    saveCustom,
    openSettings,
    closeSettings,
    isSettingsOpen: snapshot.isSettingsOpen,
  };
}
