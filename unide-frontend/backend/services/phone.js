// =====================================================================
// Validación de teléfono español (defensa servidor).
// El frontend ya valida, pero un cliente malicioso puede saltarse el JS
// y llamar a la API directamente. Normalizamos prefijo internacional
// opcional (+34 / 0034 / 34) y separadores, y exigimos 9 dígitos que
// empiecen por 6/7 (móvil) u 8/9 (fijo) — el rango válido en España.
// =====================================================================
export function isSpanishPhoneOk(raw) {
  let p = String(raw || '').replace(/[\s.\-()]/g, '');
  p = p.replace(/^\+?(0034|34)/, '');
  return /^[6-9]\d{8}$/.test(p);
}
