// =====================================================================
// CookieConsent · Banner + modal "Configurar" (RGPD / AEPD)
// =====================================================================
// - Banner inferior con 3 botones: Aceptar todo / Rechazar / Configurar
// - Modal Configurar con categorías (técnicas / análisis / marketing)
// - Botón externo (footer) puede abrir el modal vía openSettings()
//
// Antes de la decisión del usuario:
//   - No se carga ningún script de tracking (analytics, marketing).
//     El consumidor de estos servicios debe consultar useCookieConsent()
//     antes de inicializar: if (hasConsent('analytics')) loadPlausible();
// =====================================================================

import { useState, useEffect } from 'react';
import { Cookie, X, ShieldCheck, BarChart3, Megaphone } from 'lucide-react';
import { useCookieConsent } from '../hooks/useCookieConsent';

export default function CookieConsent({ onShowPolicy }) {
  const {
    consent,
    hasDecided,
    acceptAll,
    rejectAll,
    saveCustom,
    openSettings,
    closeSettings,
    isSettingsOpen,
  } = useCookieConsent();

  const showBanner = !hasDecided && !isSettingsOpen;

  if (!showBanner && !isSettingsOpen) return null;

  return (
    <>
      {showBanner && (
        <Banner
          onAcceptAll={acceptAll}
          onRejectAll={rejectAll}
          onConfigure={openSettings}
          onShowPolicy={onShowPolicy}
        />
      )}
      {isSettingsOpen && (
        <SettingsModal
          initial={consent}
          onClose={closeSettings}
          onAcceptAll={acceptAll}
          onRejectAll={rejectAll}
          onSave={saveCustom}
          onShowPolicy={onShowPolicy}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// Banner inferior
// ---------------------------------------------------------------------
function Banner({ onAcceptAll, onRejectAll, onConfigure, onShowPolicy }) {
  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Aviso de cookies"
      className="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur text-white p-4 z-50 animate-slide-up border-t border-gray-700 shadow-2xl"
    >
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-start md:items-center gap-4 text-sm">
        <div className="flex items-start gap-3 flex-1">
          <Cookie className="text-yellow-500 flex-shrink-0 mt-0.5" size={24} />
          <div className="text-gray-300 leading-relaxed">
            <p className="font-medium text-white mb-1">Gestión de cookies</p>
            <p>
              Usamos cookies técnicas imprescindibles para el funcionamiento de la web
              (sesión, cesta de la compra). Las cookies de análisis y marketing son
              opcionales y requieren tu consentimiento.{' '}
              {onShowPolicy && (
                <button
                  type="button"
                  onClick={onShowPolicy}
                  className="underline text-yellow-400 hover:text-yellow-300"
                >
                  Más información
                </button>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto md:flex-shrink-0">
          <button
            type="button"
            onClick={onRejectAll}
            className="border border-gray-600 text-gray-300 px-4 py-2 rounded-lg font-medium hover:text-white hover:border-gray-400 transition-colors text-sm whitespace-nowrap"
          >
            Rechazar
          </button>
          <button
            type="button"
            onClick={onConfigure}
            className="border border-gray-500 text-gray-200 px-4 py-2 rounded-lg font-medium hover:bg-gray-800 transition-colors text-sm whitespace-nowrap"
          >
            Configurar
          </button>
          <button
            type="button"
            onClick={onAcceptAll}
            className="bg-white text-gray-900 px-5 py-2 rounded-lg font-bold hover:bg-gray-100 transition-colors text-sm whitespace-nowrap"
          >
            Aceptar todo
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Modal "Configurar preferencias"
// ---------------------------------------------------------------------
function SettingsModal({ initial, onClose, onAcceptAll, onRejectAll, onSave, onShowPolicy }) {
  const [analytics, setAnalytics] = useState(!!initial?.analytics);
  const [marketing, setMarketing] = useState(!!initial?.marketing);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Preferencias de cookies"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <Cookie className="text-yellow-500" size={22} />
            <h2 className="text-lg font-bold text-gray-900">Preferencias de cookies</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-colors"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4 text-sm text-gray-600 leading-relaxed">
          <p>
            Puedes elegir qué cookies aceptar. Las cookies técnicas son imprescindibles
            para que la web funcione (no se pueden desactivar). El resto son opcionales
            y se cargan únicamente con tu consentimiento.
          </p>

          <CategoryRow
            icon={<ShieldCheck size={18} className="text-green-600" />}
            title="Cookies técnicas (siempre activas)"
            description="Necesarias para el inicio de sesión, la cesta de la compra y la seguridad. Sin ellas la web no funcionaría."
            disabled
            checked
          />

          <CategoryRow
            icon={<BarChart3 size={18} className="text-blue-600" />}
            title="Cookies de análisis"
            description="Nos ayudan a entender cómo se usa la web para mejorarla. Actualmente HIPERA no utiliza cookies de análisis; este interruptor queda preparado para un posible uso futuro."
            checked={analytics}
            onChange={setAnalytics}
          />

          <CategoryRow
            icon={<Megaphone size={18} className="text-pink-600" />}
            title="Cookies de marketing"
            description="Permitirían mostrar contenido o publicidad relevante. Actualmente HIPERA no utiliza cookies de marketing ni publicitarias de terceros."
            checked={marketing}
            onChange={setMarketing}
          />

          {onShowPolicy && (
            <p className="text-xs text-gray-500 pt-2">
              Consulta nuestra{' '}
              <button
                type="button"
                onClick={() => { onClose(); onShowPolicy(); }}
                className="underline text-gray-700 hover:text-gray-900"
              >
                Política de Cookies
              </button>{' '}
              para más detalle.
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 p-5 border-t border-gray-100 bg-gray-50 sticky bottom-0">
          <button
            type="button"
            onClick={onRejectAll}
            className="flex-1 border border-gray-300 text-gray-700 px-4 py-2.5 rounded-lg font-medium hover:bg-white transition-colors text-sm"
          >
            Rechazar todo
          </button>
          <button
            type="button"
            onClick={() => onSave({ analytics, marketing })}
            className="flex-1 border border-gray-900 text-gray-900 px-4 py-2.5 rounded-lg font-medium hover:bg-gray-100 transition-colors text-sm"
          >
            Guardar preferencias
          </button>
          <button
            type="button"
            onClick={onAcceptAll}
            className="flex-1 bg-gray-900 text-white px-4 py-2.5 rounded-lg font-bold hover:bg-black transition-colors text-sm"
          >
            Aceptar todo
          </button>
        </div>
      </div>
    </div>
  );
}

function CategoryRow({ icon, title, description, checked, onChange, disabled }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 bg-gray-50">
      <div className="flex-shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
          <Toggle checked={checked} onChange={onChange} disabled={disabled} />
        </div>
        <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-900 ${
        disabled
          ? 'bg-gray-300 cursor-not-allowed opacity-70'
          : checked
            ? 'bg-gray-900 cursor-pointer'
            : 'bg-gray-300 cursor-pointer hover:bg-gray-400'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        } mt-0.5`}
      />
    </button>
  );
}
