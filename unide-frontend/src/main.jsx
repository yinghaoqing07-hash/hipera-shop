import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { supabase } from './supabaseClient';
import { apiClient } from './api/client';
import './index.css';

import App from './App';
import AdminApp from './Admin';
import Login from './Login';
import Register from './Register';

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
              onClick={async () => {
                await supabase.auth.signOut();
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
    </BrowserRouter>
  </React.StrictMode>
);