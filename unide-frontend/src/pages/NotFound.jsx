// =====================================================================
// NotFound — Página 404 personalizada
// =====================================================================
// Antes del 2026-05-28 cualquier ruta no reconocida renderizaba <App />
// (la home). Eso significaba que /random-path devolvía 200 OK con
// contenido de home → Google lo trataba como "soft 404" y la calidad
// de indexación bajaba. Para humanos también era confuso (la URL era
// rara pero el contenido familiar).
//
// Solución: este componente toma el catch-all y muestra un mensaje
// claro + atajos para volver a contenido útil. Como SPA no podemos
// devolver HTTP 404 real desde el cliente; en index.html el meta
// http-equiv="status" no tiene efecto. Pero al menos:
//   - El contenido es claro (Google lo indexa como página vacía)
//   - El usuario tiene CTAs claros (volver al inicio)
//   - El navegador / extensiones no confunden la URL con la home
// =====================================================================

import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Home, Search, AlertCircle } from 'lucide-react';

export default function NotFound() {
  // Marcamos noindex dinámicamente para evitar que esta página entre
  // al índice de Google si por algún motivo el crawler llega aquí.
  // Lo dejamos al desmontar para no afectar al resto del SPA.
  useEffect(() => {
    const tag = document.createElement('meta');
    tag.name = 'robots';
    tag.content = 'noindex, follow';
    document.head.appendChild(tag);
    // Title específico (mejor que dejar el de la home)
    const prevTitle = document.title;
    document.title = '404 — Página no encontrada · HIPERA';
    return () => {
      tag.remove();
      document.title = prevTitle;
    };
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center">
        <div className="w-16 h-16 mx-auto bg-red-50 text-red-600 rounded-full flex items-center justify-center mb-4">
          <AlertCircle size={32} aria-hidden="true" />
        </div>
        <p className="text-5xl font-extrabold text-gray-900 mb-2">404</p>
        <h1 className="text-xl font-bold text-gray-800 mb-2">Página no encontrada</h1>
        <p className="text-sm text-gray-600 mb-6 leading-relaxed">
          La dirección que intentas abrir no existe en HIPERA, o ha sido
          movida. Comprueba la URL o vuelve al inicio para seguir comprando.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm px-5 py-3 rounded-xl shadow-sm transition-colors"
          >
            <Home size={16} aria-hidden="true" />
            Volver al inicio
          </Link>
          <Link
            to="/?legal=envios"
            className="inline-flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold text-sm px-5 py-3 rounded-xl transition-colors"
          >
            <Search size={16} aria-hidden="true" />
            Política de envíos
          </Link>
        </div>
        <p className="mt-6 text-xs text-gray-400">
          ¿Necesitas ayuda? Llámanos al{' '}
          <a href="tel:+34918782602" className="text-gray-600 hover:underline">
            +34 918 782 602
          </a>{' '}
          o escríbenos a{' '}
          <a href="mailto:info@hipera.es" className="text-gray-600 hover:underline">
            info@hipera.es
          </a>
          .
        </p>
      </div>
    </main>
  );
}
