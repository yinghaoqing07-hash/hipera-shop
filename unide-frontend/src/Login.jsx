// src/Login.jsx
import React, { useState } from "react";
import { supabase } from './supabaseClient';
import { useNavigate, Link } from "react-router-dom";
import { Lock, Mail, ArrowRight, ShoppingBag } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) {
      alert("Error: " + error.message);
      setLoading(false);
    } else {
      navigate("/"); // 登录成功直接去首页
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center p-6">
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