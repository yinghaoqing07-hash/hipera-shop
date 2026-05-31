// src/Login.jsx
import React, { useState } from "react";
import { supabase } from './supabaseClient';
import { Link } from "react-router-dom";
import { Lock, Mail, ArrowRight, ShoppingBag } from "lucide-react";
import toast, { Toaster } from 'react-hot-toast';

// Mismo criterio que el resto de la app: exige arroba y dominio.
const isEmailFormatOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    // Validación previa para dar un mensaje claro antes de llamar a
    // Supabase (antes el único feedback era un alert() del navegador con
    // el error técnico del SDK, poco amigable).
    if (!isEmailFormatOk(email)) {
      toast.error("Introduce un email válido.");
      return;
    }
    if (!password) {
      toast.error("Introduce tu contraseña.");
      return;
    }
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: password,
    });

    if (error) {
      // Mensaje genérico en español: no revelamos si el fallo es por
      // email inexistente o contraseña incorrecta (buena práctica de
      // seguridad para no facilitar enumeración de cuentas).
      const msg = /invalid login credentials/i.test(error.message || '')
        ? 'Email o contraseña incorrectos.'
        : (/email not confirmed/i.test(error.message || '')
            ? 'Debes confirmar tu email antes de entrar. Revisa tu bandeja de entrada.'
            : 'No se pudo iniciar sesión. Inténtalo de nuevo.');
      toast.error(msg);
      setLoading(false);
    } else {
      // Forzamos full reload en vez de navigate("/") por dos motivos:
      // 1. Multi-tab safety: si el cliente tiene otra pestaña abierta de
      //    hipera, la sincronización vía SPA puede dejar esta pestaña
      //    con React state desactualizado (signed in en localStorage
      //    pero no en el componente). Con location.href forzamos a que
      //    la app vuelva a leer la sesión desde cero.
      // 2. Defensa frente a estados pegajosos del SDK (locks colgados,
      //    suscripciones obsoletas). Un full reload garantiza un punto
      //    de partida limpio tras el login.
      window.location.href = '/';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center p-6">
      <Toaster position="top-center" toastOptions={{ style: { borderRadius: '12px', background: '#333', color: '#fff' } }} />
      <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden">
        
        {/* Header 区域 */}
        <div className="pt-10 pb-6 text-center bg-gray-50 border-b border-gray-100">
          <div className="w-16 h-16 bg-red-600 rounded-2xl flex items-center justify-center text-white mx-auto mb-4 shadow-lg shadow-red-200 transform rotate-3">
            <ShoppingBag size={32} />
          </div>
          <h2 className="text-2xl font-extrabold text-gray-800 tracking-tight">HIPERA</h2>
          <p className="text-gray-400 text-sm mt-1">Tu mercado online favorito</p>
        </div>

        {/* 表单区域 */}
        <div className="p-8">
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-2 ml-1">Email</label>
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-red-500 transition-colors" size={20} />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-red-500 focus:ring-4 focus:ring-red-100 outline-none transition-all font-medium text-gray-700"
                  placeholder="hola@ejemplo.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-2 ml-1">Contraseña</label>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-red-500 transition-colors" size={20} />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-red-500 focus:ring-4 focus:ring-red-100 outline-none transition-all font-medium text-gray-700"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gray-900 text-white py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:bg-black active:scale-95 transition-all shadow-xl shadow-gray-200 disabled:opacity-70"
            >
              {loading ? "Verificando..." : <>Entrar <ArrowRight size={20} /></>}
            </button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-sm text-gray-400">¿Aún no tienes cuenta?</p>
            <Link to="/register" className="text-red-600 font-bold hover:text-red-700 mt-1 inline-block border-b-2 border-transparent hover:border-red-100 transition-all">
              Crear cuenta gratis
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}