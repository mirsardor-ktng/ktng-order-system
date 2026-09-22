'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, UserPlus, Key, Mail, Lock, CheckCircle2, ChevronRight, Loader2, Database } from 'lucide-react';

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // Setup Wizard Form State
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [encryptionKey, setEncryptionKey] = useState('B2BSecureSystemPassphrase2026');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Checking if setup is required
  useEffect(() => {
    async function checkSetup() {
      try {
        const res = await fetch('/api/auth/setup');
        const data = await res.json();
        
        if (data.setupRequired) {
          setSetupRequired(true);
          setLoading(false);
        } else {
          // If setup is not required, check active session
          const sessionRes = await fetch('/api/auth/me');
          const sessionData = await sessionRes.json();
          
          if (sessionData.authenticated && sessionData.user) {
            const target = sessionData.user.defaultDashboard || (sessionData.user.role === 'ADMIN' ? '/admin' : sessionData.user.role === 'SELLER' ? '/seller' : '/customer');
            router.replace(target);
          } else {
            router.replace('/login');
          }
        }
      } catch (err) {
        console.error('Failed to check setup state', err);
        setLoading(false);
        setError('Не удалось подключиться к базе данных. Проверьте соединение.');
      }
    }
    checkSetup();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    if (!name || !email || !password || !encryptionKey) {
      setError('Пожалуйста, заполните все поля.');
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, encryptionKey }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(true);
        setTimeout(() => {
          router.replace('/admin');
        }, 2000);
      } else {
        setError(data.error || 'Произошла непредвиденная ошибка при регистрации.');
      }
    } catch (err) {
      setError('Не удалось подключиться к серверу. Попробуйте еще раз.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-background text-foreground">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="mt-4 text-sm font-medium text-slate-400">Инициализация системы...</p>
      </div>
    );
  }

  if (!setupRequired) return null;

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background px-4 py-12">
      {/* Decorative Glow Elements */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-[600px] w-[600px] rounded-full bg-indigo-500/10 blur-[150px]" />
      <div className="pointer-events-none absolute -bottom-45 -right-45 h-[600px] w-[600px] rounded-full bg-cyan-500/10 blur-[150px]" />

      <div className="w-full max-w-2xl animate-slide-up">
        {/* Logo Section */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 shadow-glow-primary">
            <ShieldCheck className="h-8 w-8 text-white" />
          </div>
          <h1 className="mt-6 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Мастер настройки <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">B2B Platform</span>
          </h1>
          <p className="mt-3 max-w-md text-sm text-slate-400 sm:text-base">
            Добро пожаловать в систему оптового приема заказов. Создайте первую учетную запись суперадминистратора для начала работы.
          </p>
        </div>

        {/* Setup Form Panel */}
        <div className="glass-panel rounded-3xl p-8 sm:p-10">
          {success ? (
            <div className="flex flex-col items-center py-8 text-center animate-fade-in">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-success">
                <CheckCircle2 className="h-10 w-10" />
              </div>
              <h2 className="mt-6 text-2xl font-bold text-success glow-text-success">Установка завершена!</h2>
              <p className="mt-2 text-slate-400">
                Кабинет администратора успешно создан. Перенаправляем вас на дашборд управления...
              </p>
              <div className="mt-6 flex items-center justify-center gap-2 text-sm text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Запуск B2B панелей...</span>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-400 animate-fade-in">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                <h3 className="text-lg font-bold flex items-center gap-2 text-indigo-400">
                  <UserPlus className="h-5 w-5" /> 1. Профиль Администратора
                </h3>
                
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor="name" className="text-xs font-semibold text-slate-400 uppercase tracking-wider">ФИО / Название компании</label>
                    <input
                      id="name"
                      type="text"
                      className="w-full rounded-xl px-4 py-3 text-sm glass-input"
                      placeholder="Иван Иванов"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={submitting}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="email" className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Рабочий Email</label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-slate-400" />
                      <input
                        id="email"
                        type="email"
                        className="w-full rounded-xl pl-11 pr-4 py-3 text-sm glass-input"
                        placeholder="admin@tobacco.ru"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={submitting}
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="pass" className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Пароль (строго bcrypt хэширование)</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-slate-400" />
                    <input
                      id="pass"
                      type="password"
                      className="w-full rounded-xl pl-11 pr-4 py-3 text-sm glass-input"
                      placeholder="••••••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={submitting}
                      required
                    />
                  </div>
                </div>
              </div>

              <hr className="border-slate-800" />

              <div className="space-y-4">
                <h3 className="text-lg font-bold flex items-center gap-2 text-cyan-400">
                  <Database className="h-5 w-5" /> 2. Шифрование резервных копий
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Поскольку резервные копии пользователей синхронизируются с защищенным облачным хранилищем, мы шифруем файлы по стандарту
                  <strong> AES-256-CBC</strong>. Укажите секретную фразу-пароль, которая будет использоваться в качестве мастер-ключа.
                </p>

                <div className="space-y-1.5">
                  <label htmlFor="encKey" className="text-xs font-semibold text-slate-400 uppercase tracking-wider">AES Мастер-Ключ</label>
                  <div className="relative">
                    <Key className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-slate-400" />
                    <input
                      id="encKey"
                      type="text"
                      className="w-full rounded-xl pl-11 pr-4 py-3 text-sm glass-input"
                      placeholder="Мастер-ключ шифрования"
                      value={encryptionKey}
                      onChange={(e) => setEncryptionKey(e.target.value)}
                      disabled={submitting}
                      required
                    />
                  </div>
                  <span className="text-[10px] text-slate-500">
                    * Сохраните этот ключ. Восстановление данных из хранилища без него будет невозможно.
                  </span>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="btn-primary w-full flex items-center justify-center gap-2 py-3.5 text-base disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Инициализируем систему...</span>
                  </>
                ) : (
                  <>
                    <span>Развернуть платформу</span>
                    <ChevronRight className="h-5 w-5" />
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
