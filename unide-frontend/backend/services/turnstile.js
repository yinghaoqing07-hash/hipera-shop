// =====================================================================
// Cloudflare Turnstile — verificación de token
// =====================================================================
// Captcha invisible que protege POST /api/orders de bots. El widget se
// monta en el checkout (src/components/TurnstileGate.jsx) y devuelve
// un token a Cloudflare. Aquí lo verificamos contra siteverify; si la
// respuesta no es success=true, rechazamos el pedido con 403.
//
// Comportamiento sin configurar:
//   Si TURNSTILE_SECRET_KEY no está definido, devolvemos true (modo
//   permisivo) para que el desarrollo local funcione sin claves. En
//   producción la variable debe estar presente o todos los pedidos
//   pasarán sin verificación. README_BACKEND_SETUP documenta cómo
//   obtener las claves desde dash.cloudflare.com/?to=/:account/turnstile.
//
// Test secret de Cloudflare (siempre acepta, NO usar en producción):
//   1x0000000000000000000000000000000AA
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstileToken(token, remoteip) {
  const secret = process.env.TURNSTILE_SECRET_KEY || '';
  if (!secret) {
    // Modo permisivo: no exigimos token si el backend no tiene secret.
    return { ok: true, skipped: true };
  }
  if (!token || typeof token !== 'string') {
    return { ok: false, error: 'missing-token' };
  }
  try {
    const params = new URLSearchParams();
    params.set('secret', secret);
    params.set('response', token);
    if (remoteip) params.set('remoteip', remoteip);
    const resp = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!resp.ok) {
      return { ok: false, error: `siteverify-http-${resp.status}` };
    }
    const data = await resp.json();
    if (data && data.success) return { ok: true };
    // Devolvemos los códigos de error de Cloudflare para diagnóstico.
    // Lista: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/#error-codes
    return { ok: false, error: (data['error-codes'] || []).join(',') || 'unknown' };
  } catch (e) {
    return { ok: false, error: `network: ${e?.message || e}` };
  }
}
