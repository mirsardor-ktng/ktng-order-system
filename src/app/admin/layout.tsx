'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { 
  LayoutDashboard, Users, ShoppingBag, FolderSymlink, MapPin, FileClock, 
  Settings, LogOut, User, Loader2, Sparkles, Tag, Menu, X, ChevronRight, Shield, FileUp, Building2, BarChart3, Percent, Layers3
} from 'lucide-react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    async function verifyAdmin() {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        
        if (data.authenticated && data.user.role === 'ADMIN') {
          setUser(data.user);
          setLoading(false);
        } else {
          router.replace('/login');
        }
      } catch (err) {
        router.replace('/login');
      }
    }
    verifyAdmin();
  }, [router]);

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

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
        <p className="mt-4 text-sm font-medium text-slate-400 font-semibold uppercase tracking-wider">Загрузка консоли администратора...</p>
      </div>
    );
  }

  // Sidebar navigation menu
  const menuItems = [
    { name: 'Обзор', path: '/admin', icon: LayoutDashboard },
    { name: 'Аналитика', path: '/analytics', icon: BarChart3 },
    { name: 'Пользователи', path: '/admin/users', icon: Users },
    { name: 'Компании', path: '/admin/companies', icon: Building2 },
    { name: 'Акции & Скидки', path: '/admin/promotions', icon: Percent },
    { name: 'Группы товаров', path: '/admin/product-groups', icon: Layers3 },
    { name: 'Каталог SKU', path: '/admin/products', icon: ShoppingBag },
    { name: 'Теги', path: '/admin/tags', icon: Tag },
    { name: 'Шаблоны Excel', path: '/admin/templates', icon: FolderSymlink },
    { name: 'Маппинг полей', path: '/admin/placeholders', icon: MapPin },
    { name: 'Импорт истории', path: '/admin/import-history', icon: FileUp },
    { name: 'Логи системы', path: '/admin/logs', icon: FileClock },
    { name: 'Интеграция GDrive', path: '/admin/settings', icon: Settings }
  ];

  const SidebarContent = () => (
    <>
      {/* Branding header */}
      <div className="p-6 border-b border-white/5 flex items-center gap-3 flex-shrink-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-tr from-primary to-accent shadow-glow-primary">
          <Shield className="h-5 w-5 text-white" />
        </div>
        <div>
          <span className="font-bold tracking-tight text-sm flex items-center gap-1">
            ADMIN CORE <span className="text-[10px] text-primary-focus">v1.0</span>
          </span>
          <span className="block text-[8px] font-bold text-slate-500 uppercase tracking-widest leading-none">B2B Order Control</span>
        </div>
      </div>

      {/* Navigation list */}
      <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.path;

          return (
            <Link
              key={item.path}
              href={item.path}
              className={`flex items-center gap-3 px-4 py-3 text-xs font-bold rounded-xl transition-all ${
                isActive 
                  ? 'bg-primary text-white shadow-glass-sm' 
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">{item.name}</span>
              {isActive && <ChevronRight className="h-3 w-3 opacity-60" />}
            </Link>
          );
        })}
      </nav>

      {/* User Card & Logout */}
      <div className="p-4 border-t border-white/5 space-y-3 bg-slate-950/30 flex-shrink-0">
        <div className="flex items-center gap-3 px-2">
          <Link 
            href="/admin/profile" 
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 border border-white/10 text-slate-300 flex-shrink-0 hover:bg-white/10 hover:text-white transition-all"
            title="Личный кабинет"
          >
            <User className="h-4 w-4" />
          </Link>
          <div className="flex-1 min-w-0">
            <span className="block text-xs font-bold text-slate-200 truncate">{user?.name}</span>
            <span className="block text-[8px] text-slate-500 uppercase tracking-widest font-extrabold leading-none mt-1">Superadmin</span>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-2">
          <Link 
            href="/seller" 
            className="flex items-center justify-center rounded-lg border border-cyan-500/25 bg-cyan-500/10 py-1.5 text-[9px] font-bold text-cyan-400 hover:bg-cyan-500/20 transition-all"
            title="Перейти в консоль продаж"
          >
            Консоль продаж
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center justify-center gap-1 rounded-lg bg-red-500/10 border border-red-500/20 py-1.5 text-[9px] font-bold text-red-400 hover:bg-red-500/20 transition-all"
          >
            <LogOut className="h-3 w-3" />
            <span>Выйти</span>
          </button>
        </div>
      </div>
    </>
  );

  return (
    /* 
      KEY FIX: h-screen overflow-hidden on the outer shell.
      The sidebar and the content column are both flex children.
      The content column gets overflow-y-auto so only IT scrolls.
      The sidebar stays pinned at full viewport height.
    */
    <div className="relative h-screen overflow-hidden bg-background text-foreground flex">
      {/* Dynamic Glow behind sidebar */}
      <div className="pointer-events-none absolute top-0 left-0 h-[600px] w-[300px] rounded-full bg-indigo-500/5 blur-[120px] z-0" />

      {/* ── MOBILE DRAWER OVERLAY ── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* ── MOBILE SLIDE-IN DRAWER ── */}
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 flex flex-col bg-slate-950/95 border-r border-white/5 backdrop-blur-xl transition-transform duration-300 ease-in-out lg:hidden ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Drawer close button */}
        <button
          onClick={() => setDrawerOpen(false)}
          className="absolute top-4 right-4 h-8 w-8 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-all"
        >
          <X className="h-4 w-4" />
        </button>
        <SidebarContent />
      </aside>

      {/* ── DESKTOP PINNED SIDEBAR ── */}
      <aside className="hidden lg:flex w-64 flex-col flex-shrink-0 bg-slate-950/60 border-r border-white/5 backdrop-blur-md h-full z-10">
        <SidebarContent />
      </aside>

      {/* ── RIGHT: Header + Scrollable Content ── */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">

        {/* ── STICKY TOP HEADER (mobile) ── */}
        <header className="flex-shrink-0 z-30 w-full border-b border-white/5 bg-background/70 backdrop-blur-md lg:hidden px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Hamburger */}
            <button
              onClick={() => setDrawerOpen(true)}
              className="h-8 w-8 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-all"
              aria-label="Открыть меню"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-primary to-accent">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="font-extrabold tracking-tight text-xs uppercase text-slate-200">Admin Control</span>
          </div>

          <div className="flex gap-2">
            <Link 
              href="/seller"
              className="px-2.5 py-1 text-[9px] font-bold rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
            >
              Продажи
            </Link>
            <button 
              onClick={handleLogout}
              className="h-7 w-7 rounded bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        {/* Mobile horizontal sub-nav */}
        <nav className="flex-shrink-0 flex lg:hidden bg-slate-950/80 border-b border-white/5 py-2 px-4 gap-1.5 overflow-x-auto select-none z-20">
          {menuItems.map((item) => {
            const isActive = pathname === item.path;
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`px-3 py-1.5 text-[10px] font-extrabold rounded-lg whitespace-nowrap transition-all ${
                  isActive ? 'bg-primary text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* ── SCROLLABLE CONTENT AREA ── */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
