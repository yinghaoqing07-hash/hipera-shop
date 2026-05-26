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

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    lock: noopLock,
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