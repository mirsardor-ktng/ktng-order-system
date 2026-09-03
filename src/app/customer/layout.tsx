'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { ShoppingBag, History, LogOut, User, Loader2, Sparkles, Leaf, BarChart3 } from 'lucide-react';

interface AuthUser {
  name: string;
  email: string;
  role?: string;
  roleName?: string;
  permissions?: string[];
  defaultDashboard?: string;
}

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    async function verifyCustomer() {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        const data = await res.json();
        
        if (data.authenticated && data.user) {
          const userPerms = data.user.permissions || [];
          const isSuper = data.user.role === 'ADMIN' || data.user.roleName === 'Суперадминистратор' || userPerms.includes('*');
          const hasCustomerAccess = isSuper || userPerms.some((p: string) => [
            'orders:view_own', 'orders:create', 'products:read', 'orders:view_all'
          ].includes(p));

          if (hasCustomerAccess) {
            setUser(data.user);
            setLoading(false);
          } else {
            router.replace(data.user.defaultDashboard || '/login');
          }
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
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout failed', err);
    } finally {
      window.location.href = '/login';
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-background text-foreground">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="mt-4 text-sm font-semibold text-slate-400 uppercase tracking-wider">Загрузка каталога заказчика...</p>
      </div>
    );
  }

  const isSuper = user?.role === 'ADMIN' || user?.roleName === 'Суперадминистратор' || (user?.permissions || []).includes('*');
  const canViewAnalytics = isSuper || (user?.permissions || []).includes('analytics:view');

  return (
    <div className="relative h-screen overflow-hidden bg-background text-foreground flex flex-col">
      {/* Dynamic Background Glow */}
      <div className="pointer-events-none absolute top-0 right-1/4 h-[500px] w-[500px] rounded-full bg-emerald-500/5 blur-[120px]" />
      
      {/* ── FIXED TOP NAVBAR ── */}
      <header className="flex-shrink-0 z-40 w-full border-b border-white/5 bg-background/60 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-4">
            
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-tr from-emerald-500 to-teal-600 shadow-glow-primary">
                <Leaf className="h-5 w-5 text-white" />
              </div>
              <div>
                <span className="font-bold tracking-tight text-base flex items-center gap-1.5">
                  B2B WHOLESALE <Sparkles className="h-3 w-3 text-emerald-400" />
                </span>
                <span className="block text-[9px] font-bold text-slate-500 uppercase tracking-widest leading-none">Cigarette Supply Portal</span>
              </div>
            </div>

            {/* Middle Nav */}
            <nav className="hidden md:flex items-center gap-1 bg-slate-900/40 border border-white/5 p-1 rounded-xl">
              <Link 
                href="/customer" 
                className={`flex items-center gap-2 px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  pathname === '/customer' 
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                <span>Каталог товаров</span>
              </Link>
              
              <Link 
                href="/customer/orders" 
                className={`flex items-center gap-2 px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  pathname === '/customer/orders' 
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <History className="h-3.5 w-3.5" />
                <span>История заказов</span>
              </Link>

              {canViewAnalytics && (
                <Link 
                  href="/analytics" 
                  className={`flex items-center gap-2 px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                    pathname === '/analytics' 
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                  <span>Аналитика</span>
                </Link>
              )}
            </nav>

            {/* Profile Info & Logout */}
            <div className="flex items-center gap-3">
              <div className="hidden md:flex flex-col text-right">
                <span className="text-xs font-bold text-slate-200">{user?.name}</span>
                <span className="text-[10px] text-slate-500 font-semibold tracking-wider">
                  {user?.roleName || 'B2B Покупатель'}
                </span>
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

        {/* Mobile Sub-Navigation Bar */}
        <div className="flex md:hidden border-t border-white/5 bg-slate-950/60 px-4 py-2 gap-2 overflow-x-auto">
          <Link 
            href="/customer" 
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg whitespace-nowrap transition-all ${
              pathname === '/customer' 
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' 
                : 'text-slate-400'
            }`}
          >
            <ShoppingBag className="h-3 w-3" />
            <span>Каталог</span>
          </Link>
          
          <Link 
            href="/customer/orders" 
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg whitespace-nowrap transition-all ${
              pathname === '/customer/orders' 
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' 
                : 'text-slate-400'
            }`}
          >
            <History className="h-3 w-3" />
            <span>Мои заказы</span>
          </Link>

          {canViewAnalytics && (
            <Link 
              href="/analytics" 
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg whitespace-nowrap transition-all ${
                pathname === '/analytics' 
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' 
                  : 'text-slate-400'
              }`}
            >
              <BarChart3 className="h-3 w-3" />
              <span>Аналитика</span>
            </Link>
          )}
        </div>
      </header>

      {/* ── SCROLLABLE CONTENT AREA ── */}
      <main className="flex-1 overflow-y-auto w-full">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
