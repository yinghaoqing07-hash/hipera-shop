// =====================================================================
// TurnstileGate · Widget invisible de Cloudflare Turnstile
// =====================================================================
// Captcha invisible para proteger acciones críticas (creación de
// pedidos) contra bots sin afectar la UX del usuario humano. La
// inmensa mayoría de las sesiones se resuelven con un challenge no
// interactivo (token devuelto en <1s); sólo cuando Cloudflare detecta
// firma de bot el widget muestra un desafío visible.
//
// Uso:
//
//   const ref = useRef(null);
//   ...
//   <TurnstileGate ref={ref} />
//   ...
//   const token = await ref.current?.executeAsync();
//   if (!token) {
//     toast.error('No se pudo verificar la solicitud, inténtalo otra vez.');
//     return;
//   }
//   await apiClient.createOrder({ ...payload, turnstile_token: token });
//
// Comportamiento sin configuración:
//   Si VITE_TURNSTILE_SITE_KEY no está en .env, el componente no
//   renderiza nada y executeAsync() resuelve a null. El backend debe
//   estar configurado en modo permisivo (TURNSTILE_SECRET_KEY también
//   ausente) en ese caso, o rechazará todos los pedidos. Esto facilita
//   el desarrollo local sin exponer claves de producción.
//
// Test keys de Cloudflare (siempre aceptan, NO usar en producción):
//   Site key:   1x00000000000000000000AA
//   Secret key: 1x0000000000000000000000000000000AA
// =====================================================================

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();

// Espera a que el script de Cloudflare cargue la API global.
// Polling barato (200 ms) durante un máximo de 5 s.
function waitForTurnstile(maxMs = 5000) {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && window.turnstile) return resolve(window.turnstile);
    const start = Date.now();
    const tick = () => {
      if (typeof window !== 'undefined' && window.turnstile) return resolve(window.turnstile);
      if (Date.now() - start > maxMs) return resolve(null);
      setTimeout(tick, 200);
    };
    tick();
  });
}

export const TurnstileGate = forwardRef(function TurnstileGate(_props, ref) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const resolverRef = useRef(null);

  // Montaje del widget en modo invisible. Si SITE_KEY no está
  // configurada NO renderizamos ni montamos nada — el componente es
  // un no-op silencioso. Esto permite arrancar el frontend sin
  // depender de variables de entorno locales.
  useEffect(() => {
    if (!SITE_KEY) return undefined;

    let cancelled = false;
    (async () => {
      const turnstile = await waitForTurnstile();
      if (cancelled || !turnstile || !containerRef.current) return;

      try {
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          size: 'invisible',
          // Cuando Cloudflare emite token, completamos la promesa
          // pendiente (si la hay) y guardamos el token para que un
          // segundo executeAsync inmediato lo reciba sin re-ejecutar.
          callback: (token) => {
            if (resolverRef.current) {
              resolverRef.current(token);
              resolverRef.current = null;
            }
          },
          // Si Cloudflare devuelve error (red, configuración mal,
          // dominio no autorizado en el dashboard), resolvemos con
          // null. El caller mostrará un toast genérico y pedirá
          // reintentar.
          'error-callback': () => {
            if (resolverRef.current) {
              resolverRef.current(null);
              resolverRef.current = null;
            }
            // Reset preventivo para que el siguiente execute() no
            // arrastre el estado de error.
            try { turnstile.reset(widgetIdRef.current); } catch { /* ignore */ }
          },
          // Los tokens expiran a los ~5 min. Reseteamos para que el
          // siguiente execute() obtenga uno nuevo.
          'expired-callback': () => {
            try { turnstile.reset(widgetIdRef.current); } catch { /* ignore */ }
          },
        });
      } catch (e) {
        if (!import.meta.env.PROD) {
          // eslint-disable-next-line no-console
          console.warn('[TurnstileGate] render:', e?.message);
        }
      }
    })();

    return () => {
      cancelled = true;
      const turnstile = typeof window !== 'undefined' ? window.turnstile : null;
      if (turnstile && widgetIdRef.current) {
        try { turnstile.remove(widgetIdRef.current); } catch { /* ignore */ }
      }
      widgetIdRef.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    /**
     * Ejecuta el widget y devuelve una promesa con el token o null si:
     *   - No hay SITE_KEY configurada (componente inactivo).
     *   - El script de Turnstile no se cargó (sin red, bloqueado por
     *     adblocker, dominio no autorizado).
     *   - El timeout interno (8 s) se agota sin respuesta.
     *
     * El caller decide si rechazar la acción (modo estricto) o
     * permitirla con un token vacío (modo permisivo, p. ej. dev).
     */
    executeAsync: () => new Promise((resolve) => {
      const turnstile = typeof window !== 'undefined' ? window.turnstile : null;
      if (!SITE_KEY || !turnstile || !widgetIdRef.current) {
        return resolve(null);
      }
      // Sólo permitimos una ejecución concurrente. Si ya había una en
      // curso, resolvemos la anterior con null antes de iniciar la
      // nueva (evita que callbacks viejas crucen tokens entre
      // diferentes peticiones).
      if (resolverRef.current) {
        try { resolverRef.current(null); } catch { /* ignore */ }
      }
      resolverRef.current = resolve;
      try {
        turnstile.execute(widgetIdRef.current);
      } catch (_e) {
        if (resolverRef.current === resolve) {
          resolverRef.current = null;
          resolve(null);
        }
        return;
      }
      // Timeout defensivo: si el widget no responde nada en 8 s,
      // resolvemos con null. Cloudflare resuelve en <1s en condiciones
      // normales; 8 s protege contra estados zombi sin tener al cliente
      // esperando demasiado tras pulsar "Pagar".
      setTimeout(() => {
        if (resolverRef.current === resolve) {
          resolverRef.current = null;
          resolve(null);
        }
      }, 8000);
    }),

    /** Reset manual (no usado externamente, expuesto por simetría). */
    reset: () => {
      const turnstile = typeof window !== 'undefined' ? window.turnstile : null;
      if (turnstile && widgetIdRef.current) {
        try { turnstile.reset(widgetIdRef.current); } catch { /* ignore */ }
      }
    },

    /** True si la integración está activa (clave configurada). */
    isEnabled: () => !!SITE_KEY,
  }), []);

  // Sin clave: no renderizamos nada (ni el contenedor) para que un
  // entorno sin configurar no tenga huella en el DOM.
  if (!SITE_KEY) return null;

  // Contenedor oculto: Turnstile invisible no muestra nada salvo que
  // Cloudflare decida desafiar al usuario. En ese caso, el widget
  // renderiza un overlay propio. Mantenemos el div con tamaño cero
  // y sin afectar al layout.
  return (
    <div
      ref={containerRef}
      className="cf-turnstile-gate"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
      aria-hidden="true"
    />
  );
});
