import React, { useState } from "react";
import { supabase } from './supabaseClient';
import { useNavigate, Link } from "react-router-dom";
import { UserPlus, Mail, Lock, ArrowRight } from "lucide-react";

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
    });

    if (error) {
      alert("Error: " + error.message);
    } else {
      alert("注册成功！请登录。"); // Supabase 默认可能需要邮箱验证，但在开发模式下通常直接成功
      navigate("/login");
    }
    setLoading(false);
  };

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
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full p-3 border rounded-xl" placeholder="Email" />
          <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full p-3 border rounded-xl" placeholder="Contraseña (min 6 caracteres)" />
          <button type="submit" disabled={loading} className="w-full bg-red-600 text-white py-3 rounded-xl font-bold flex justify-center items-center gap-2">
            {loading ? "Registrando..." : "Registrarse"} <ArrowRight size={18}/>
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
