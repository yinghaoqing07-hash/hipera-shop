// =====================================================================
// Authentication & authorization
// =====================================================================
// Historia previa: el middleware authenticateAdmin sólo verificaba que
// el JWT de Supabase fuera válido, pero NO comprobaba el rol del
// usuario. Combinado con /register público (main.jsx), cualquier
// persona podía crearse una cuenta, obtener un JWT y consumir todos
// los endpoints /api/admin/*. Esto se corrigió el 2026-05-25 añadiendo
// una whitelist de emails de administrador parametrizada por entorno.
//
// Configuración (variable obligatoria en producción):
//   ADMIN_EMAILS=email1@dominio.com,email2@dominio.com
//
// Sin la variable definida, NO se concede acceso administrativo a
// nadie (fail closed). El endpoint /api/me permite al frontend
// consultar si el usuario autenticado actual está en la whitelist
// (para mostrar/ocultar /admin) sin filtrar el listado completo.
// =====================================================================
import { supabase } from '../lib/supabase.js';

const parseAdminEmails = () => {
  const raw = process.env.ADMIN_EMAILS || '';
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
};

export const isAdminUser = (user) => {
  const list = parseAdminEmails();
  if (list.length === 0) return false;
  const email = (user?.email || '').trim().toLowerCase();
  if (!email) return false;
  return list.includes(email);
};

// Aviso de arranque si la whitelist está vacía en producción.
if (process.env.NODE_ENV === 'production' && parseAdminEmails().length === 0) {
  console.warn(
    '[Auth] ⚠️ ADMIN_EMAILS no está configurada. Todos los endpoints ' +
    '/api/admin/* y /admin del frontend devolverán 403. Configura ' +
    'ADMIN_EMAILS=email1,email2 en las variables de entorno del servidor ' +
    'antes de intentar acceder al panel.'
  );
}

// Validación de JWT (no exige rol). Usado por /api/me y compuesto por
// authenticateAdmin para añadir comprobación de whitelist.
export const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return res.status(401).json({ error: 'Token no enviado. Cierra sesión y vuelve a iniciar sesión en /login' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error) {
      console.warn('[Auth] getUser error:', error.message);
      return res.status(401).json({ error: 'Token inválido o expirado. Cierra sesión y vuelve a iniciar sesión' });
    }
    if (!user) {
      return res.status(401).json({ error: 'Sesión no válida. Vuelve a iniciar sesión' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.warn('[Auth] Exception:', err?.message);
    res.status(401).json({ error: 'Error de autenticación. Intenta cerrar sesión y volver a entrar' });
  }
};

// Validación de JWT + whitelist de email. Para endpoints administrativos.
export const authenticateAdmin = (req, res, next) => {
  authenticateUser(req, res, (err) => {
    if (err) return next(err);
    if (!isAdminUser(req.user)) {
      console.warn(`[Auth] Acceso admin denegado para email=${req.user?.email || '(sin email)'}`);
      return res.status(403).json({
        error: 'Acceso denegado: la cuenta no tiene permisos de administrador.',
      });
    }
    next();
  });
};

// =====================================================================
// Autenticación del AGENTE DE IMPRESIÓN (PC de la tienda)
// =====================================================================
// El agente de impresión es un proceso headless en el PC de la tienda;
// NO puede hacer login interactivo (no hay JWT de Supabase). Se
// autentica con un token compartido en la cabecera X-Print-Token,
// comparado contra PRINT_AGENT_TOKEN del entorno (Railway).
//
// Por qué un token propio y no el JWT admin:
//   - El agente corre 24/7 sin persona delante; un JWT caduca.
//   - Mantiene el secreto del PC de la tienda acotado a SOLO imprimir
//     (no da acceso al panel admin ni a Supabase directamente).
//
// Sin PRINT_AGENT_TOKEN configurado → 503 (las rutas de impresión
// quedan deshabilitadas; el resto del backend sigue igual).
export const authenticatePrintAgent = (req, res, next) => {
  const expected = process.env.PRINT_AGENT_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'Impresión no configurada (falta PRINT_AGENT_TOKEN).' });
  }
  const provided = req.headers['x-print-token'];
  if (!provided || provided !== expected) {
    console.warn('[print] token inválido o ausente desde IP', req.ip);
    return res.status(401).json({ error: 'Token de impresión inválido.' });
  }
  next();
};

// Extrae el user_id VERIFICADO del JWT de la cabecera Authorization, o
// null si no hay sesión válida. No confía en el user_id del body (que un
// invitado podría falsificar). Se usa para reglas sensibles de cupón.
export async function getVerifiedUserId(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    return user?.id || null;
  } catch {
    return null;
  }
}
