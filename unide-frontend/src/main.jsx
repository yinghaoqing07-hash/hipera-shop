import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { BrowserRouter, Routes, Route } from "react-router-dom";
import './index.css';

import App from './App';
import ChunkLoading from './components/ChunkLoading';
import AppCrash from './components/AppCrash';
import AdminProtectedRoute from './components/AdminProtectedRoute';

// =====================================================================
// Sentry — monitorización de errores del cliente (opcional, gated por env)
// =====================================================================
// Sólo se activa si VITE_SENTRY_DSN está definido en el build; sin DSN es
// un no-op total. Se ejecuta como monitorización FUNCIONAL (interés
// legítimo): no escribe cookies, no rastrea al usuario y desactiva el
// envío de PII (sendDefaultPii false). Por eso NO se condiciona al banner
// de cookies — sólo captura excepciones de JS para enterarnos de pantallas
// en blanco en el navegador del cliente. tracesSampleRate a 0: ni trazas
// de rendimiento ni session replay, así no añade peso ni recoge sesiones.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
}
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
const NotFound = lazy(() => import('./pages/NotFound'));


const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={({ resetError }) => <AppCrash resetError={resetError} />}>
      <BrowserRouter>
        <Suspense fallback={<ChunkLoading />}>
          <Routes>
          {/* 公开前台 */}
          <Route path="/" element={<App />} />
          <Route path="/repair" element={<App />} />

          {/* 登录页面 */}
          <Route path="/login" element={<Login />} />

          {/* 注册页面 */}
          <Route path="/register" element={<Register />} />

          {/* 受保护的后台 (admin role check + JWT) */}
          <Route
            path="/admin/*"
            element={
              <AdminProtectedRoute>
                <AdminApp />
              </AdminProtectedRoute>
            }
          />

          {/* Página 404 personalizada (antes era catch-all a <App />,
              lo que provocaba "soft 404" en Google: cualquier URL
              desconocida devolvía contenido de home con HTTP 200). */}
          <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
