// =====================================================================
// Utilidades de aceptación de Términos y Política de Privacidad
// =====================================================================
// Comprueba y registra la aceptación de los documentos legales en
// Supabase (tabla user_terms_acceptances). Funciona en modo
// append-only: cada aceptación crea una fila nueva con timestamp.
//
// API:
//   recordAcceptance({ source, userId? })
//   getLatestAcceptance(userId)
//   needsReacceptance(latest)
// =====================================================================

import { supabase } from '../supabaseClient';
import { TERMS_VERSION, PRIVACY_VERSION } from '../config/legal';

/**
 * Registra la aceptación actual en la base de datos.
 *
 * @param {Object} opts
 * @param {'register'|'checkout'|'profile'} opts.source
 * @param {string=} opts.userId - Si no se proporciona, se obtiene de la sesión.
 * @returns {Promise<void>}
 */
export async function recordAcceptance({ source, userId } = {}) {
  let uid = userId;
  if (!uid) {
    const { data: { session } } = await supabase.auth.getSession();
    uid = session?.user?.id;
  }
  if (!uid) throw new Error('No hay sesión activa para registrar la aceptación.');

  const { error } = await supabase.from('user_terms_acceptances').insert({
    user_id: uid,
    terms_version: TERMS_VERSION,
    privacy_version: PRIVACY_VERSION,
    source: source || 'register',
    user_agent: navigator.userAgent?.slice(0, 500) || null,
  });
  if (error) throw error;
}

/**
 * Obtiene la última aceptación registrada del usuario.
 * Devuelve null si nunca ha aceptado.
 *
 * @param {string} userId
 * @returns {Promise<{terms_version:number, privacy_version:number, accepted_at:string}|null>}
 */
export async function getLatestAcceptance(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('user_terms_acceptances')
    .select('terms_version, privacy_version, accepted_at, source')
    .eq('user_id', userId)
    .order('accepted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (!import.meta.env.PROD) console.warn('[termsAcceptance] getLatest error:', error.message);
    return null;
  }
  return data;
}

/**
 * Decide si hay que volver a pedir aceptación.
 *
 *  - Sin registro previo → true (nunca aceptó)
 *  - Versión aceptada < versión vigente → true
 *  - Versiones al día → false
 *
 * @param {{terms_version:number, privacy_version:number}|null} latest
 * @returns {boolean}
 */
export function needsReacceptance(latest) {
  if (!latest) return true;
  return (
    (latest.terms_version || 0) < TERMS_VERSION ||
    (latest.privacy_version || 0) < PRIVACY_VERSION
  );
}
