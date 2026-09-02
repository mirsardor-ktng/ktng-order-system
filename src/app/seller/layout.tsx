'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FileSpreadsheet, LogOut, User, Loader2, Leaf } from 'lucide-react';

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ name: string; email: string; role: string } | null>(null);

  useEffect(() => {
    async function verifySeller() {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        
        if (data.authenticated && (data.user.role === 'SELLER' || data.user.role === 'ADMIN')) {
          setUser(data.user);
          setLoading(false);
        } else {
          router.replace('/login');
        }
      } catch (err) {
        router.replace('/login');
      }
    }
    verifySeller();
  }, [router]);

  const handleLogout = async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        router.replace('/login');
      }
    } catch (err) {
      console.error('Logout failed', err);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-background text-foreground">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="mt-4 text-sm font-semibold text-slate-400 uppercase tracking-wider">Загрузка сессии продавца...</p>
      </div>
    );
  }

  return (
    /*
      KEY FIX: h-screen overflow-hidden — locks the viewport.
      Header is flex-shrink-0 (never scrolls away).
      Main is overflow-y-auto (only this region scrolls).
    */
    <div className="relative h-screen overflow-hidden bg-background text-foreground flex flex-col">
      {/* Decorative Blur */}
      <div className="pointer-events-none absolute top-0 left-1/4 h-[400px] w-[400px] rounded-full bg-cyan-500/5 blur-[100px]" />
      
      {/* ── FIXED HEADER ── */}
      <header className="flex-shrink-0 z-40 w-full border-b border-white/5 bg-background/60 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-4">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 shadow-glow-primary">
                <FileSpreadsheet className="h-5 w-5 text-white" />
              </div>
              <div>
                <span className="font-bold tracking-tight text-base flex items-center gap-1.5">
                  SELLER CONSOLE <Leaf className="h-3 w-3 text-cyan-400 animate-pulse-slow" />
                </span>
                <span className="block text-[9px] font-bold text-slate-500 uppercase tracking-widest leading-none">Order Management</span>
              </div>
            </div>

            {/* Admin toggle (if user is Admin, they can switch) */}
            {user?.role === 'ADMIN' && (
              <Link 
                href="/admin" 
                className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-3 py-1.5 text-xs font-bold text-indigo-400 hover:bg-indigo-500/20 transition-all"
              >
                <span>В консоль админа</span>
              </Link>
            )}

            {/* Profile info */}
            <div className="flex items-center gap-3">
              <div className="hidden md:flex flex-col text-right">
                <span className="text-xs font-bold text-slate-200">{user?.name}</span>
                <span className="text-[10px] text-slate-500 font-semibold tracking-wider">Роль: Менеджер продаж</span>
              </div>
              <Link 
                href="/seller/profile" 
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white transition-all"
                title="Личный кабинет"
              >
                <User className="h-4 w-4" />
              </Link>
              <button 
                onClick={handleLogout}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-all"
                title="Выйти из системы"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ── SCROLLABLE CONTENT AREA ── */}
      <main className="flex-1 overflow-y-auto w-full">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
