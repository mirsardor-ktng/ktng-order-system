'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Lock, LogIn, Loader2, Shield, Briefcase, UserCircle } from 'lucide-react';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState('');

  // Check if session is already active
  useEffect(() => {
    async function checkSession() {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (data.authenticated) {
          const role = data.user.role;
          if (role === 'ADMIN') router.replace('/admin');
          else if (role === 'SELLER') router.replace('/seller');
          else router.replace('/customer');
        }
      } catch (err) {
        console.error('Session verify failed', err);
      } finally {
        setCheckingSession(false);
      }
    }
    checkSession();
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!email || !password) {
      setError('Заполните все поля для ввода.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.ok) {
        // Successful login, redirect based on role
        const role = data.user.role;
        if (role === 'ADMIN') router.replace('/admin');
        else if (role === 'SELLER') router.replace('/seller');
        else router.replace('/customer');
      } else {
        setError(data.error || 'Неверные авторизационные данные.');
      }
    } catch (err) {
      setError('Не удалось подключиться к серверу. Попробуйте позже.');
    } finally {
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-background text-foreground">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="mt-4 text-sm font-medium text-slate-400">Проверка активной сессии...</p>
      </div>
    );
  }

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background px-4">
      {/* Decorative Blur Orbs */}
      <div className="pointer-events-none absolute top-1/4 left-1/4 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-1/4 right-1/4 h-[500px] w-[500px] translate-x-1/2 translate-y-1/2 rounded-full bg-accent/10 blur-[120px]" />

      <div className="w-full max-w-md animate-slide-up">
        {/* Branding header */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent shadow-glow-primary">
            <LogIn className="h-6 w-6 text-white" />
          </div>
          <h2 className="mt-5 text-2xl font-bold tracking-tight">Вход в B2B Систему</h2>
          <p className="mt-2 text-xs text-slate-400 uppercase tracking-widest font-semibold">
            Cigarette Wholesale Ordering
          </p>
        </div>

        {/* glass card container */}
        <div className="glass-panel rounded-2xl p-6 sm:p-8">
          <form onSubmit={handleLogin} className="space-y-5">
            {error && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3.5 text-xs text-red-400 animate-fade-in">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="email" className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Электронная почта</label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4.5 w-4.5 text-slate-400" />
                <input
                  id="email"
                  type="email"
                  className="w-full rounded-xl pl-10 pr-4 py-2.5 text-sm glass-input"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="pass" className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Пароль доступа</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4.5 w-4.5 text-slate-400" />
                <input
                  id="pass"
                  type="password"
                  className="w-full rounded-xl pl-10 pr-4 py-2.5 text-sm glass-input"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4.5 w-4.5 animate-spin" />
                  <span>Выполняем вход...</span>
                </>
              ) : (
                <>
                  <LogIn className="h-4.5 w-4.5" />
                  <span>Войти в аккаунт</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Roles Hint Banner */}
        <div className="mt-8 grid grid-cols-3 gap-2 px-2 text-center text-[10px] text-slate-400">
          <div className="flex flex-col items-center p-2 rounded-xl bg-slate-900/30 border border-white/5">
            <Shield className="h-3.5 w-3.5 mb-1 text-indigo-400" />
            <span className="font-semibold text-slate-300">Admin</span>
            <span>Контроль & SKU</span>
          </div>
          <div className="flex flex-col items-center p-2 rounded-xl bg-slate-900/30 border border-white/5">
            <Briefcase className="h-3.5 w-3.5 mb-1 text-cyan-400" />
            <span className="font-semibold text-slate-300">Seller</span>
            <span>Аналитика & Заказы</span>
          </div>
          <div className="flex flex-col items-center p-2 rounded-xl bg-slate-900/30 border border-white/5">
            <UserCircle className="h-3.5 w-3.5 mb-1 text-emerald-400" />
            <span className="font-semibold text-slate-300">Customer</span>
            <span>Закупки & Черновики</span>
          </div>
        </div>
      </div>
    </main>
  );
}
