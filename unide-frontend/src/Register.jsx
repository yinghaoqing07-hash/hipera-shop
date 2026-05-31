import React, { useState } from "react";
import { supabase } from './supabaseClient';
import { useNavigate, Link } from "react-router-dom";
import { UserPlus, ArrowRight, MailCheck } from "lucide-react";
import toast, { Toaster } from 'react-hot-toast';
import { TERMS_VERSION, PRIVACY_VERSION } from './config/legal';
import { recordAcceptance } from './utils/termsAcceptance';

const PENDING_ACCEPTANCE_KEY = 'pendingTermsAcceptance';

// Mismo criterio que el resto de la app: exige arroba y dominio.
const isEmailFormatOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreedLegal, setAgreedLegal] = useState(false);
  const [loading, setLoading] = useState(false);
  // Cuando Supabase exige confirmar el email, guardamos aquí la dirección
  // para mostrar la pantalla "revisa tu correo" en lugar de saltar a login.
  const [sentEmail, setSentEmail] = useState(null);
  const [resending, setResending] = useState(false);
  const navigate = useNavigate();

  const handleResend = async () => {
    if (!sentEmail) return;
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: sentEmail,
      options: { emailRedirectTo: `${window.location.origin}/login` },
    });
    if (error) {
      toast.error('No se pudo reenviar. Espera un momento e inténtalo de nuevo.');
    } else {
      toast.success('Email de confirmación reenviado.');
    }
    setResending(false);
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    // Validaciones de cliente con feedback claro (antes solo dependíamos
    // de la validación nativa del navegador y del error técnico del SDK).
    if (!isEmailFormatOk(email)) {
      toast.error('Introduce un email válido.');
      return;
    }
    if (password.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Las contraseñas no coinciden.');
      return;
    }
    if (!agreedLegal) {
      toast.error('Debes aceptar la Política de Privacidad y el Aviso Legal para continuar.');
      return;
    }
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      // Si la confirmación de email está activada en Supabase, el enlace
      // del correo devolverá al cliente a /login ya verificado.
      options: { emailRedirectTo: `${window.location.origin}/login` },
    });

    if (error) {
      const msg = /already registered|already exists|user already/i.test(error.message || '')
        ? 'Ya existe una cuenta con este email. Inicia sesión.'
        : 'No se pudo crear la cuenta. Inténtalo de nuevo.';
      toast.error(msg);
      setLoading(false);
      return;
    }

    // Si Supabase devuelve sesión activa (confirmación de email desactivada),
    // registramos la aceptación inmediatamente. En caso contrario, guardamos
    // la intención en localStorage para que App.jsx la sincronice tras el
    // primer login confirmado.
    if (data?.session?.user?.id) {
      // Confirmación de email DESACTIVADA en Supabase: el registro ya
      // deja sesión iniciada. Registramos la aceptación y entramos
      // directamente (sin obligar a reescribir credenciales en /login).
      try {
        await recordAcceptance({ source: 'register', userId: data.session.user.id });
      } catch (err) {
        if (!import.meta.env.PROD) console.warn('[register] recordAcceptance:', err?.message);
      }
      toast.success('¡Cuenta creada! Entrando…');
      navigate("/");
      setLoading(false);
      return;
    }

    // Sin sesión inmediata => Supabase requiere confirmar el email.
    // Guardamos la aceptación pendiente y NOS QUEDAMOS en esta pantalla
    // mostrando "revisa tu correo" (antes saltábamos a /login, donde el
    // cliente no podía entrar porque la cuenta aún no estaba activada).
    try {
      localStorage.setItem(PENDING_ACCEPTANCE_KEY, JSON.stringify({
        source: 'register',
        terms_version: TERMS_VERSION,
        privacy_version: PRIVACY_VERSION,
        at: new Date().toISOString(),
      }));
    } catch { /* ignore quota errors */ }

    setSentEmail(email.trim());
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
      <Toaster position="top-center" toastOptions={{ style: { borderRadius: '12px', background: '#333', color: '#fff' } }} />
      {sentEmail ? (
        <div className="bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden p-8 text-center">
          <div className="w-14 h-14 bg-green-100 text-green-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <MailCheck size={28} />
          </div>
          <h2 className="text-2xl font-bold text-gray-800">Revisa tu correo</h2>
          <p className="text-gray-500 text-sm mt-2 leading-relaxed">
            Hemos enviado un email de confirmación a<br />
            <span className="font-semibold text-gray-800">{sentEmail}</span>.<br />
            Ábrelo y pulsa el enlace para activar tu cuenta.
          </p>
          <p className="text-xs text-gray-400 mt-3">
            ¿No lo ves? Revisa la carpeta de spam o correo no deseado.
          </p>
          <button
            onClick={handleResend}
            disabled={resending}
            className="mt-6 w-full border border-gray-200 text-gray-700 py-3 rounded-xl font-bold hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {resending ? 'Reenviando…' : 'Volver a enviar el email'}
          </button>
          <Link
            to="/login"
            className="mt-3 inline-flex items-center justify-center gap-2 w-full bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-700 transition-colors"
          >
            Ya lo he confirmado, iniciar sesión <ArrowRight size={18} />
          </Link>
        </div>
      ) : (
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
          <input
            type="password"
            required
            minLength={6}
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            className={`w-full p-3 border rounded-xl ${confirmPassword && confirmPassword !== password ? 'border-red-400 focus:border-red-500' : ''}`}
            placeholder="Repite la contraseña"
          />
          {confirmPassword && confirmPassword !== password && (
            <p className="text-xs text-red-500 -mt-2">Las contraseñas no coinciden.</p>
          )}

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
              y los {legalLink('terminos', 'Términos y Condiciones')} de HIPERA.{' '}
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
      )}
    </div>
  );
}
