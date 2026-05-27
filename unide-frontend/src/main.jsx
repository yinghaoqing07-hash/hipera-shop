import React, { lazy, Suspense, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { supabase, clearSupabaseLocalSession } from './supabaseClient';
import { apiClient } from './api/client';
import './index.css';

import App from './App';
// =====================================================================
// Code-splitting: páginas que no son la home pública se cargan a
// demanda. El panel /admin es el caso más extremo (~600 KB con jsPDF,
// html2canvas, qrcode), pero también sacamos Login/Register del
// bundle principal: la mayoría de visitas son anónimas que no llegan
// a esas rutas. Resultado: el bundle inicial baja de ~1.3 MB a ~700 KB
// y los visitantes nuevos ven LCP/FCP notablemente más rápido.
//
// El <Suspense fallback> se renderiza mientras carga el chunk; en una
// conexión 4G normal es prácticamente instantáneo (un parpadeo).
// =====================================================================
const AdminApp = lazy(() => import('./Admin'));
const Login = lazy(() => import('./Login'));
const Register = lazy(() => import('./Register'));

// Pantalla de carga genérica para chunks. Color neutro para no chocar
// con el tema rojo de HIPERA si el chunk pertenece a admin (gris) o
// front (rojo); evitamos un flash de color marcado durante el split.
function ChunkLoading({ label = 'Cargando…' }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="flex flex-col items-center gap-3 text-gray-500">
        <div className="w-8 h-8 border-4 border-gray-200 border-t-gray-600 rounded-full animate-spin" aria-hidden="true" />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}

// =====================================================================
// AdminProtectedRoute — control de acceso al panel /admin
// =====================================================================
// Historia previa: el guard sólo verificaba que existiera sesión de
// Supabase, sin comprobar si el email del usuario figuraba en la
// whitelist de administradores. Combinado con /register público,
// cualquier persona podía darse de alta y entrar al panel. Se corrige
// el 2026-05-25 consultando GET /api/me, que devuelve un booleano
// isAdmin calculado server-side contra ADMIN_EMAILS.
//
// La whitelist NO se duplica en el frontend: el backend es la única
// fuente de verdad. Si la sesión existe pero el backend responde
// isAdmin=false, mostramos una pantalla con mensaje claro en vez de
// redirigir silenciosamente, para que un usuario legítimo entienda
// por qué no puede entrar.
// =====================================================================

const AdminProtectedRoute = ({ children }) => {
  const [session, setSession] = useState(null);
  const [isAdmin, setIsAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const verify = async (sess) => {
      if (cancelled) return;
      setSession(sess);
      if (!sess) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      try {
        const me = await apiClient.getMe();
        if (!cancelled) setIsAdmin(!!me?.isAdmin);
      } catch (e) {
        console.warn('[AdminProtectedRoute] /api/me falló:', e?.message);
        if (!cancelled) setIsAdmin(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => verify(session));

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setLoading(true);
        verify(session);
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
                // Limpiamos sincronamente los tokens locales (ver
                // clearSupabaseLocalSession en supabaseClient.js para
                // el razonamiento completo). Sin esa limpieza previa
                // el location.href siguiente recarga la pagina antes
                // de que el SDK haya borrado el localStorage, el
                // siguiente arranque lee la sesion stale y el guard
                // de admin vuelve a quedarse en bucle.
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
};

const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={<ChunkLoading />}>
        <Routes>
          {/* 公开前台 */}
          <Route path="/" element={<App />} />

          {/* 登录页面 */}
          <Route path="/login" element={<Login />} />

          {/* 注册页面 */}
          <Route path="/register" element={<Register />} />

          {/* 受保护的后台 (admin role check + JWT) */}
          <Route
            path="/admin"
            element={
              <AdminProtectedRoute>
                <AdminApp />
              </AdminProtectedRoute>
            }
          />

          {/* 404 处理 */}
          <Route path="*" element={<App />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>
);