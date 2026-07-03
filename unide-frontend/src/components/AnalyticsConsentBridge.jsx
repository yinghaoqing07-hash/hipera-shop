// AnalyticsConsentBridge — puente RGPD entre el banner de cookies y GA4.
// No renderiza nada: sólo observa el consentimiento de 'analytics' y
// activa/desactiva GA4 (que se carga bajo demanda en analytics.js, nunca
// antes del consentimiento). Reacciona en caliente si el usuario cambia
// su decisión en el modal "Configurar".
import { useEffect } from 'react';
import { useCookieConsent } from '../hooks/useCookieConsent';
import { enableAnalytics, disableAnalytics } from '../utils/analytics';

export default function AnalyticsConsentBridge() {
  const { hasConsent } = useCookieConsent();
  const analyticsOn = hasConsent('analytics');
  useEffect(() => {
    if (analyticsOn) enableAnalytics();
    else disableAnalytics();
  }, [analyticsOn]);
  return null;
}
