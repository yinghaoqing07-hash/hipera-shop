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