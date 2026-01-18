import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { supabase } from './supabaseClient'; // 引入 supabase
import './index.css';

import App from './App';
import AdminApp from './Admin';
import Login from './Login'; // 引入新创建的 Login 组件
import Register from './Register'; // 引入

// 创建一个“保镖”组件
const ProtectedRoute = ({ children }) => {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. 检查当前有没有人登录
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // 2. 监听登录状态变化 (防止用户手动清空 cookies)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) return <div className="min-h-screen flex items-center justify-center">Cargando...</div>;

  // 如果没有登录，踢回 /login
  if (!session) {
    return <Navigate to="/login" replace />;
  }

  // 如果登录了，放行
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

        {/* 受保护的后台 */}
        <Route 
          path="/admin" 
          element={
            <ProtectedRoute>
              <AdminApp />
            </ProtectedRoute>
          } 
        />
        
        {/* 404 处理 */}
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);