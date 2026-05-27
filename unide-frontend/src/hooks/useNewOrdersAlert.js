// =====================================================================
// useNewOrdersAlert · Alerta de pedidos nuevos para el panel Admin
// =====================================================================
// Reúne en un único hook tres responsabilidades que el panel admin
// necesita combinadas:
//
//   1. Polling ligero contra GET /api/admin/orders/new?since=...
//      cada `pollIntervalMs` (default 20 s). Se pausa cuando la
//      pestaña está oculta para no quemar CPU/red.
//
//   2. Aviso sonoro generado con Web Audio API (no usamos archivos
//      .mp3 en /public para no añadir binarios al repo y para
//      funcionar offline / con caché agresiva del navegador). Tres
//      pitidos cortos 880/1100/880 Hz, 150 ms cada uno, gain 0.3.
//      El AudioContext arranca suspendido por la autoplay policy de
//      Chrome/Safari: hace falta un user gesture (click, teclado)
//      antes del primer sonido. El hook escucha pointerdown/keydown
//      con { once: true } y libera el contexto al primer gesto, sin
//      molestar al usuario.
//
//   3. Notificaciones del sistema operativo (Notification API).
//      Opt-in explícito vía requestNotifPermission(); si el permiso
//      es 'denied' o el navegador no la soporta, se degrada en
//      silencio (sólo sonido + badge en la UI).
//
// Persistencia:
//   - `lastSeen` se guarda en localStorage como ISO timestamp para
//     que el polling sobreviva a refrescos. La clave que escribimos
//     siempre es `server_time` del backend (no `Date.now()` del
//     cliente) para evitar drift de reloj.
//   - `isMuted` también se persiste; el usuario puede silenciar y
//     volver al día siguiente con la preferencia recordada.
//
// API:
//   const {
//     newOrders, newCount,
//     isMuted, toggleMute,
//     playSound,                // disparo manual ("probar sonido")
//     markAllSeen,              // limpia el badge
//     audioUnlocked, unlockAudio,
//     notifPermission, requestNotifPermission,
//     lastPollAt, lastNewOrderAt,
//   } = useNewOrdersAlert({ pollIntervalMs: 20000, enabled: true });
// =====================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';

const LS_LAST_SEEN = 'admin_orders_last_seen';
const LS_MUTED = 'admin_orders_muted';
const DEFAULT_POLL_MS = 20000;

export function useNewOrdersAlert({ pollIntervalMs = DEFAULT_POLL_MS, enabled = true } = {}) {
  const [newOrders, setNewOrders] = useState([]);
  const [isMuted, setIsMuted] = useState(() => {
    try { return localStorage.getItem(LS_MUTED) === '1'; } catch { return false; }
  });
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [notifPermission, setNotifPermission] = useState(() => {
    return typeof Notification !== 'undefined' ? Notification.permission : 'denied';
  });
  const [lastPollAt, setLastPollAt] = useState(null); // Date | null
  const [lastNewOrderAt, setLastNewOrderAt] = useState(null); // Date | null

  const audioCtxRef = useRef(null);
  const lastSeenRef = useRef(null); // ISO timestamp (string)
  const pollTimerRef = useRef(null);
  // Snapshot del estado actual de `isMuted` accesible desde dentro de
  // poll() sin tener que re-suscribir el setInterval cada vez que el
  // usuario silencia/desbloquea. Lo mismo con notifPermission.
  const isMutedRef = useRef(isMuted);
  const notifPermRef = useRef(notifPermission);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { notifPermRef.current = notifPermission; }, [notifPermission]);

  // Inicializa lastSeen al montar:
  //   - Si ya hay un valor en localStorage, lo usamos (sobrevive a refresh).
  //   - Si no, usamos "ahora" del cliente para NO reportar todo el
  //     histórico como nuevo en el primer arranque del panel.
  //
  // Sólo lo hacemos una vez. Si el usuario llama markAllSeen() o el
  // polling actualiza server_time, lastSeenRef se moverá hacia delante.
  useEffect(() => {
    let saved = null;
    try { saved = localStorage.getItem(LS_LAST_SEEN); } catch { /* ignore */ }
    if (saved) {
      lastSeenRef.current = saved;
    } else {
      const nowIso = new Date().toISOString();
      lastSeenRef.current = nowIso;
      try { localStorage.setItem(LS_LAST_SEEN, nowIso); } catch { /* ignore */ }
    }
  }, []);

  // -------------------------------------------------------------------
  // AUDIO (Web Audio API, sin archivos externos)
  // -------------------------------------------------------------------
  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctx = typeof window !== 'undefined'
        ? (window.AudioContext || window.webkitAudioContext)
        : null;
      if (Ctx) audioCtxRef.current = new Ctx();
    }
    return audioCtxRef.current;
  }, []);

  const playSound = useCallback(() => {
    if (isMutedRef.current) return;
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'closed') return;
    if (ctx.state === 'suspended') {
      // Intentamos resumir por si el AudioContext quedó pausado.
      // Si falla (no hubo gesto), el sonido simplemente no saldrá; no
      // queremos lanzar excepciones al admin durante el polling.
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const beeps = [
      { freq: 880,  start: 0.00 },
      { freq: 1100, start: 0.20 },
      { freq: 880,  start: 0.40 },
    ];
    beeps.forEach(({ freq, start }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Envolvente A/R muy corta para evitar clicks por discontinuidad.
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.3, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + 0.20);
    });
  }, [getAudioCtx]);

  const unlockAudio = useCallback(() => {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume()
        .then(() => setAudioUnlocked(true))
        .catch(() => { /* el navegador no nos dejará; reintentaremos en el próximo gesto */ });
    } else {
      setAudioUnlocked(true);
    }
  }, [getAudioCtx]);

  // Auto-unlock en el primer gesto del usuario (cualquier click o
  // tecla) tras montar el hook. Una vez liberado, el browser no
  // volverá a suspender el contexto en esta sesión.
  useEffect(() => {
    if (audioUnlocked) return;
    const onGesture = () => unlockAudio();
    window.addEventListener('pointerdown', onGesture, { once: true });
    window.addEventListener('keydown',     onGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown',     onGesture);
    };
  }, [audioUnlocked, unlockAudio]);

  // -------------------------------------------------------------------
  // MUTE (persistente)
  // -------------------------------------------------------------------
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      try { localStorage.setItem(LS_MUTED, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // -------------------------------------------------------------------
  // NOTIFICACIONES (opt-in)
  // -------------------------------------------------------------------
  const requestNotifPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    try {
      const p = await Notification.requestPermission();
      setNotifPermission(p);
    } catch {
      // Algunos navegadores embebidos lanzan al pedir permiso; lo
      // tratamos como denied y degradamos a sonido + badge.
      setNotifPermission('denied');
    }
  }, []);

  // -------------------------------------------------------------------
  // POLLING
  // -------------------------------------------------------------------
  useEffect(() => {
    if (!enabled) return undefined;

    const poll = async () => {
      // Si la pestaña no está visible no consumimos red. El listener
      // de visibilitychange dispara un poll manual al volver, así que
      // no nos perdemos pedidos.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (!lastSeenRef.current) return;
      try {
        const resp = await apiClient.getNewAdminOrders(lastSeenRef.current);
        setLastPollAt(new Date());
        if (!resp) return;
        const fresh = Array.isArray(resp.orders) ? resp.orders : [];
        const serverTime = resp.server_time;

        if (fresh.length > 0) {
          setNewOrders((prev) => {
            // Dedupe por id (los polls solapados pueden traer el mismo
            // pedido dos veces si el servidor responde lento).
            const seenIds = new Set(prev.map((o) => o.id));
            const trulyNew = fresh.filter((o) => !seenIds.has(o.id));
            if (trulyNew.length === 0) return prev;

            // Sonido y notificación del sistema sólo para los
            // verdaderamente nuevos, no para los duplicados.
            playSound();
            setLastNewOrderAt(new Date());

            if (notifPermRef.current === 'granted' && typeof Notification !== 'undefined') {
              try {
                const title = `HIPERA · ${trulyNew.length} pedido${trulyNew.length > 1 ? 's' : ''} nuevo${trulyNew.length > 1 ? 's' : ''}`;
                const body = trulyNew
                  .slice(0, 5)
                  .map((o) => `#${String(o.id).slice(0, 8)} · ${Number(o.total || 0).toFixed(2)} €`)
                  .join('\n');
                const notif = new Notification(title, {
                  body,
                  icon: '/favicon.ico',
                  // tag colapsa notificaciones repetidas: si ya hay
                  // una visible, la reemplaza en vez de apilarlas.
                  tag: 'hipera-new-order',
                  // requireInteraction: en navegadores que lo
                  // soporten, queda visible hasta que el admin la
                  // cierre o haga click (útil si está en otra app).
                  requireInteraction: true,
                });
                notif.onclick = () => {
                  try { window.focus(); } catch { /* ignore */ }
                  notif.close();
                };
              } catch {
                // Notification puede fallar en iframes / contextos
                // sin permisos; degradamos en silencio.
              }
            }

            // Encolamos los nuevos al principio para que el banner
            // muestre los más recientes primero.
            return [...trulyNew, ...prev];
          });
        }

        // Avanzamos `lastSeen` siempre que el servidor nos dé un
        // server_time válido, incluso si no había pedidos nuevos.
        // Así si en el próximo intervalo entra un pedido, lo
        // detectaremos respecto a este timestamp y no al inicial.
        if (typeof serverTime === 'string' && serverTime) {
          lastSeenRef.current = serverTime;
          try { localStorage.setItem(LS_LAST_SEEN, serverTime); } catch { /* ignore */ }
        }
      } catch (e) {
        if (typeof import.meta !== 'undefined' && !import.meta.env?.PROD) {
          // eslint-disable-next-line no-console
          console.warn('[useNewOrdersAlert] poll:', e?.message);
        }
      }
    };

    // Primer poll a los 5 s del montaje (damos tiempo a que el
    // backend de Railway se despierte si estaba dormido).
    const initial = setTimeout(poll, 5000);
    pollTimerRef.current = setInterval(poll, pollIntervalMs);

    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        // Llamada inmediata al volver a la pestaña: el admin no
        // espera 20 s para ver lo que llegó mientras estaba fuera.
        poll();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      clearTimeout(initial);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [enabled, pollIntervalMs, playSound]);

  // -------------------------------------------------------------------
  // API pública
  // -------------------------------------------------------------------
  const markAllSeen = useCallback(() => {
    setNewOrders([]);
    // Avanzamos lastSeen al "ahora" del cliente: no queremos que un
    // refresh devuelva los mismos pedidos como nuevos. Aunque el
    // reloj del cliente esté un poco desincronizado respecto al
    // servidor, el peor caso es que en el próximo poll volvamos a
    // ver durante una iteración pedidos creados en ese delta, y
    // sólo si el reloj del cliente va por delante.
    const nowIso = new Date().toISOString();
    lastSeenRef.current = nowIso;
    try { localStorage.setItem(LS_LAST_SEEN, nowIso); } catch { /* ignore */ }
  }, []);

  return {
    newOrders,
    newCount: newOrders.length,
    isMuted,
    toggleMute,
    playSound,
    markAllSeen,
    audioUnlocked,
    unlockAudio,
    notifPermission,
    requestNotifPermission,
    lastPollAt,
    lastNewOrderAt,
  };
}
