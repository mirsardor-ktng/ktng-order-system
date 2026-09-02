'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { ShoppingBag, History, LogOut, User, Loader2, Sparkles, Leaf, BarChart3 } from 'lucide-react';

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    async function verifyCustomer() {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        
        if (data.authenticated && data.user.role === 'CUSTOMER') {
          setUser(data.user);
          setLoading(false);
        } else {
          router.replace('/login');
        }
      } catch (err) {
        router.replace('/login');
      }
    }
    verifyCustomer();
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
        <p className="mt-4 text-sm font-medium text-slate-400 font-semibold uppercase tracking-wider">Загрузка сессии клиента...</p>
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
      {/* Decorative Orbs */}
      <div className="pointer-events-none absolute top-0 right-1/4 h-[400px] w-[400px] rounded-full bg-primary/5 blur-[100px]" />
      
      {/* ── FIXED GLASSMORPHIC HEADER ── */}
      <header className="flex-shrink-0 z-40 w-full border-b border-white/5 bg-background/60 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-4">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-tr from-primary to-accent shadow-glow-primary">
                <ShoppingBag className="h-5 w-5 text-white" />
              </div>
              <div className="hidden sm:block">
                <span className="font-bold tracking-tight text-base flex items-center gap-1.5">
                  TOBACCO B2B <Leaf className="h-3 w-3 text-accent animate-pulse-slow" />
                </span>
                <span className="block text-[9px] font-bold text-slate-500 uppercase tracking-widest leading-none">Ordering platform</span>
              </div>
            </div>

            {/* Navigation tabs */}
            <nav className="flex items-center gap-1.5 sm:gap-3 bg-slate-950/40 p-1 rounded-xl border border-white/5">
              <Link 
                href="/customer" 
                className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  pathname === '/customer' 
                    ? 'bg-primary text-white shadow-glass-sm' 
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                <span className="hidden xs:inline">Витрина товаров</span>
              </Link>
              <Link 
                href="/customer/orders" 
                className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  pathname === '/customer/orders' 
                    ? 'bg-primary text-white shadow-glass-sm' 
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <History className="h-3.5 w-3.5" />
                <span className="hidden xs:inline">История заказов</span>
              </Link>
              <Link 
                href="/analytics" 
                className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  pathname === '/analytics' 
                    ? 'bg-primary text-white shadow-glass-sm' 
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                <span className="hidden xs:inline">Аналитика</span>
              </Link>
            </nav>

            {/* User Session card */}
            <div className="flex items-center gap-3">
              <div className="hidden md:flex flex-col text-right">
                <span className="text-xs font-bold text-slate-200">{user?.name}</span>
                <span className="text-[10px] text-slate-500 font-semibold tracking-wider">Роль: Покупатель</span>
              </div>
              <Link 
                href="/customer/profile" 
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
