import React, { useState } from "react";
import { supabase } from './supabaseClient';
import { useNavigate, Link } from "react-router-dom";
import { UserPlus, ArrowRight } from "lucide-react";
import toast from 'react-hot-toast';
import { TERMS_VERSION, PRIVACY_VERSION } from './config/legal';
import { recordAcceptance } from './utils/termsAcceptance';

const PENDING_ACCEPTANCE_KEY = 'pendingTermsAcceptance';

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreedLegal, setAgreedLegal] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!agreedLegal) {
      toast.error('Debes aceptar la Política de Privacidad y el Aviso Legal para continuar.');
      return;
    }
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      toast.error('Error al registrarse: ' + error.message);
      setLoading(false);
      return;
    }

    // Si Supabase devuelve sesión activa (confirmación de email desactivada),
    // registramos la aceptación inmediatamente. En caso contrario, guardamos
    // la intención en localStorage para que App.jsx la sincronice tras el
    // primer login confirmado.
    if (data?.session?.user?.id) {
      try {
        await recordAcceptance({ source: 'register', userId: data.session.user.id });
      } catch (err) {
        if (!import.meta.env.PROD) console.warn('[register] recordAcceptance:', err?.message);
      }
    } else {
      try {
        localStorage.setItem(PENDING_ACCEPTANCE_KEY, JSON.stringify({
          source: 'register',
          terms_version: TERMS_VERSION,
          privacy_version: PRIVACY_VERSION,
          at: new Date().toISOString(),
        }));
      } catch { /* ignore quota errors */ }
    }

    toast.success('Cuenta creada. Por favor, inicia sesión.');
    navigate("/login");
    setLoading(false);
  };

  const legalLink = (slug, label) => (
    <a
      href={`/?legal=${slug}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-red-600 font-medium underline hover:text-red-700"
    >
      {label}
    </a>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden p-8">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-red-100 text-red-600 rounded-xl flex items-center justify-center mx-auto mb-4">
            <UserPlus size={24} />
          </div>
          <h2 className="text-2xl font-bold text-gray-800">Crear Cuenta</h2>
          <p className="text-gray-400 text-sm">Únete a HIPERA</p>
        </div>

        <form onSubmit={handleRegister} className="space-y-4">
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full p-3 border rounded-xl"
            placeholder="Email"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full p-3 border rounded-xl"
            placeholder="Contraseña (mín. 6 caracteres)"
          />

          <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 hover:border-gray-300 transition-colors cursor-pointer">
            <input
              type="checkbox"
              checked={agreedLegal}
              onChange={e => setAgreedLegal(e.target.checked)}
              required
              className="mt-1 h-4 w-4 accent-red-600 cursor-pointer flex-shrink-0"
              aria-describedby="legal-consent-text"
            />
            <span id="legal-consent-text" className="text-xs text-gray-600 leading-relaxed">
              He leído y acepto la {legalLink('privacidad', 'Política de Privacidad')}{' '}
              y los {legalLink('aviso', 'Términos y Condiciones')} de HIPERA.{' '}
              <span className="text-gray-400">
                (versión {TERMS_VERSION}.{PRIVACY_VERSION})
              </span>
            </span>
          </label>

          <button
            type="submit"
            disabled={loading || !agreedLegal}
            className="w-full bg-red-600 text-white py-3 rounded-xl font-bold flex justify-center items-center gap-2 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Registrando..." : "Registrarse"} <ArrowRight size={18} />
          </button>
        </form>

        <div className="mt-4 text-center text-sm">
          <span className="text-gray-500">¿Ya tienes cuenta? </span>
          <Link to="/login" className="text-red-600 font-bold hover:underline">Inicia Sesión</Link>
        </div>
      </div>
    </div>
  );
}
