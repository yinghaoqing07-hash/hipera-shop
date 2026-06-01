// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://yscoewxnmsfpebfwwios.supabase.co'
const supabaseKey = 'sb_publishable_1ivi8GXvmMeu0WV6ppcrDA_B9ziqXSL'

// =====================================================================
// Configuración explícita del cliente — multi-tab safe
// =====================================================================
// Por defecto supabase-js v2 utiliza `navigator.locks` para sincronizar
// el refresh del token entre pestañas. Se detectó (2026-05-27) un
// deadlock cuando una pestaña quedaba colgada en un AbortError o tras
// limpiar localStorage parcialmente: el lock no se liberaba y la
// segunda pestaña no podía completar signInWithPassword (la sesión
// aterrizaba en localStorage pero el callback onAuthStateChange de la
// pestaña que iniciaba la sesión NUNCA se disparaba, mientras que la
// otra pestaña sí recibía storage event y actualizaba su React state).
//
// Sustituimos el lock por una implementación in-memory (no-op
// efectivo): cada pestaña ejecuta su refresh de forma independiente.
// En el peor caso ambas pestañas refrescan a la vez y supabase realiza
// dos requests redundantes — coste despreciable frente al deadlock.
// La consistencia entre pestañas se mantiene vía storage events.
//
// NO modificamos storageKey: mantener el valor por defecto evita que
// los usuarios actualmente logueados pierdan su sesión al desplegar
// este cambio (un storageKey distinto se traduciría en sesiones
// huérfanas en localStorage y forzaría re-login global).
const noopLock = async (_name, _acquireTimeout, fn) => fn();

// =====================================================================
// fetch con timeout para TODAS las llamadas de red de Supabase
// =====================================================================
// Problema observado: al pulsar "Pagar", el botón se quedaba colgado
// minutos enteros (no segundos) hasta tener que refrescar la página. La
// causa: cuando el access token está caducado, getSession() dispara un
// refresh contra el endpoint de auth de Supabase mediante fetch SIN
// timeout. Si ese request se estanca (red móvil inestable, endpoint
// lento), la promesa nunca resuelve y arrastra a todo lo que la espera
// (incluido el checkout). El lock ya estaba neutralizado (noopLock), así
// que el cuelgue venía de la propia petición HTTP.
//
// Envolvemos el fetch global con un AbortController de 12 s. Si una
// llamada de auth/refresh no responde, aborta y el flujo continúa con un
// error manejable en vez de quedarse zombi. 12 s es holgado para auth.
const fetchWithTimeout = (input, init = {}) => {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), 12000);
  // Respetamos cualquier signal externo: si el caller aborta, también.
  if (init.signal) {
    if (init.signal.aborted) ctrl.abort();
    else init.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(id));
};

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    lock: noopLock,
  },
  global: {
    fetch: fetchWithTimeout,
  },
})

// =====================================================================
// clearSupabaseLocalSession — borrado sincrono de tokens en localStorage
// =====================================================================
// supabase.auth.signOut() limpia localStorage solo despues de recibir
// la respuesta del endpoint /logout, lo que significa que cualquier
// codigo que dispare un window.location.href inmediatamente despues
// puede recargar la pagina ANTES de que el SDK haya limpiado el token.
// Resultado: la pagina recargada lee la sesion stale y el usuario
// vuelve a quedar logueado, dando la impresion de que "no se puede
// cerrar sesion". Esto ocurrio el 2026-05-27 con dos pestanas abiertas.
//
// Para garantizar logout fiable usamos un helper que borra de forma
// sincrona todas las claves que Supabase guarda en localStorage. La
// llamada signOut() sigue lanzandose en segundo plano para revocar el
// token tambien en el servidor (mejor higiene), pero el reload de la
// pestana no depende ya de su finalizacion.
//
// Patron de uso:
//   clearSupabaseLocalSession();
//   supabase.auth.signOut().catch(() => {});
//   window.location.href = '/';
// =====================================================================
export function clearSupabaseLocalSession() {
  try {
    // Recolectamos primero las claves (no podemos mutar localStorage
    // mientras iteramos sus indices).
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-')) keysToRemove.push(k);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch (e) {
    // Modo incognito estricto u otros entornos sin acceso a Storage:
    // ignoramos silenciosamente, el reload posterior cubre el resto.
    if (!import.meta.env.PROD) console.warn('[auth] clearLocal:', e?.message);
  }
}