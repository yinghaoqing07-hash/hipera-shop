import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase, clearSupabaseLocalSession } from '../supabaseClient';
import { apiClient } from '../api/client';

export default function AdminProtectedRoute({ children }) {
  const [session, setSession] = useState(null);
  const [isAdmin, setIsAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let currentUserId = null; // usuario ya verificado (para ignorar re-emisiones)

    const verify = async (sess, { silent = false } = {}) => {
      if (cancelled) return;
      setSession(sess);
      if (!sess) {
        currentUserId = null;
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      currentUserId = sess.user?.id || null;
      try {
        const me = await apiClient.getMe();
        if (!cancelled) setIsAdmin(!!me?.isAdmin);
      } catch (e) {
        console.warn('[AdminProtectedRoute] /api/me falló:', e?.message);
        // En una re-verificación silenciosa (p. ej. al volver a la pestaña),
        // un fallo transitorio de red NO debe expulsar a un admin ya
        // verificado: conservamos el estado anterior. Solo la verificación
        // inicial trata el fallo como "no admin".
        if (!cancelled && !silent) setIsAdmin(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => verify(session));

    // ⚠️ Fix iOS/Safari: supabase-js emite TOKEN_REFRESHED y SIGNED_IN cada
    // vez que la pestaña vuelve a ser visible (su auto-refresh corre en
    // visibilitychange). La versión anterior hacía setLoading(true) en CADA
    // evento → desmontaba el panel entero → "Verificando permisos…" +
    // remount + recarga de todos los datos. Para el usuario era
    // indistinguible de un refresh completo al volver de otra app.
    // Regla: los eventos que no pueden cambiar quién eres (mismo usuario)
    // NO tocan la UI.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
          if (session) setSession(session); // token fresco, sin remount
          return;
        }
        if (event === 'SIGNED_IN' && session?.user?.id && session.user.id === currentUserId) {
          setSession(session); // re-emisión al re-enfocar: mismo usuario → no-op
          return;
        }
        // Cambios reales: SIGNED_OUT, USER_UPDATED o un usuario distinto.
        const sameUser = session?.user?.id && session.user.id === currentUserId;
        if (!sameUser) setLoading(true); // solo bloquea la UI si cambió la identidad
        verify(session, { silent: !!sameUser });
      }
    );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Verificando permisos…</div>;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md bg-white border border-gray-200 rounded-2xl shadow-sm p-6 text-center space-y-4">
          <h1 className="text-xl font-bold text-gray-900">Acceso restringido</h1>
          <p className="text-sm text-gray-600">
            Tu cuenta <strong>{session.user?.email || ''}</strong> no tiene
            permisos de administrador. El panel <code>/admin</code> está
            reservado al personal autorizado de HIPERA.
          </p>
          <p className="text-xs text-gray-500">
            Si crees que se trata de un error, contacta con el equipo para
            que añada tu correo a la lista de administradores.
          </p>
          <div className="flex gap-2 justify-center pt-2">
            <a
              href="/"
              className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors"
            >
              Volver al inicio
            </a>
            <button
              type="button"
              onClick={() => {
                clearSupabaseLocalSession();
                supabase.auth.signOut().catch((e) => {
                  if (!import.meta.env.PROD) console.warn('[admin] signOut bg:', e?.message);
                });
                window.location.href = '/login';
              }}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    );
  }

  return children;
}
