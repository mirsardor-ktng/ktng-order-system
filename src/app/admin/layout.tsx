'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { 
  LayoutDashboard, Users, ShoppingBag, FolderSymlink, MapPin, FileClock, 
  Settings, LogOut, User, Loader2, Sparkles, Tag, Menu, X, ChevronRight, Shield, FileUp, Building2, BarChart3, Percent, Layers3, KeyRound
} from 'lucide-react';
import { useTranslation } from '@/i18n/context';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

interface AuthUser {
  name: string;
  email: string;
  role?: string;
  roleName?: string;
  permissions?: string[];
  defaultDashboard?: string;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    async function verifyAdmin() {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        const data = await res.json();
        
        if (data.authenticated && data.user) {
          const userPerms = data.user.permissions || [];
          const isSuper = data.user.role === 'ADMIN' || data.user.roleName === 'Суперадминистратор' || userPerms.includes('*');
          
          // Check if user has at least some admin-accessible permissions
          const hasAdminAccess = isSuper || userPerms.some((p: string) => [
            'users:read', 'users:manage', 'roles:manage', 'companies:read', 'companies:manage',
            'products:read', 'products:manage', 'products:stock_update', 'product_groups:manage',
            'tags:manage', 'promotions:read', 'promotions:manage', 'analytics:view',
            'templates:manage', 'placeholders:manage', 'import:execute', 'logs:view', 'settings:manage'
          ].includes(p));

          if (hasAdminAccess) {
            setUser(data.user);
            setLoading(false);
          } else {
            router.replace(data.user.defaultDashboard || '/customer');
          }
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
        <p className="mt-4 text-sm font-semibold text-slate-400 uppercase tracking-wider">{t('common.loading')}</p>
      </div>
    );
  }

  const isSuper = user?.role === 'ADMIN' || user?.roleName === 'Суперадминистратор' || (user?.permissions || []).includes('*');
  const userPerms = user?.permissions || [];

  const checkPerm = (required: string | string[]) => {
    if (isSuper) return true;
    if (Array.isArray(required)) {
      return required.some(r => userPerms.includes(r));
    }
    return userPerms.includes(required);
  };

  // Sidebar navigation menu with permission bindings and i18n
  const allMenuItems = [
    { name: t('navigation.dashboard'), path: '/admin', icon: LayoutDashboard, required: [] },
    { name: t('navigation.analytics'), path: '/analytics', icon: BarChart3, required: ['analytics:view'] },
    { name: t('navigation.users'), path: '/admin/users', icon: Users, required: ['users:read', 'users:manage'] },
    { name: t('navigation.roles'), path: '/admin/roles', icon: KeyRound, required: ['roles:manage', 'users:manage'] },
    { name: t('navigation.companies'), path: '/admin/companies', icon: Building2, required: ['companies:read', 'companies:manage'] },
    { name: t('navigation.promotions'), path: '/admin/promotions', icon: Percent, required: ['promotions:read', 'promotions:manage'] },
    { name: t('navigation.productGroups'), path: '/admin/product-groups', icon: Layers3, required: ['product_groups:manage', 'products:manage'] },
    { name: t('navigation.productsSku'), path: '/admin/products', icon: ShoppingBag, required: ['products:read', 'products:manage', 'products:stock_update'] },
    { name: t('navigation.tags'), path: '/admin/tags', icon: Tag, required: ['tags:manage', 'products:manage'] },
    { name: t('navigation.excelTemplates'), path: '/admin/templates', icon: FolderSymlink, required: ['templates:manage'] },
    { name: t('navigation.fieldMapping'), path: '/admin/placeholders', icon: MapPin, required: ['placeholders:manage'] },
    { name: t('navigation.importHistory'), path: '/admin/import-history', icon: FileUp, required: ['import:execute'] },
    { name: t('navigation.systemLogs'), path: '/admin/logs', icon: FileClock, required: ['logs:view'] },
    { name: t('navigation.cloudStorage'), path: '/admin/settings', icon: Settings, required: ['settings:manage'] }
  ];

  const visibleMenuItems = allMenuItems.filter(item => {
    if (item.required.length === 0) return true;
    return checkPerm(item.required);
  });

  const canSwitchToSeller = checkPerm(['orders:create', 'orders:view_all', 'orders:edit']);

  const SidebarContent = () => (
    <>
      {/* Branding header */}
      <div className="p-6 border-b border-white/5 flex items-center gap-3 flex-shrink-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-tr from-primary to-accent shadow-glow-primary">
          <Shield className="h-5 w-5 text-white" />
        </div>
        <div>
          <span className="font-bold tracking-tight text-sm flex items-center gap-1">
            ADMIN CORE <span className="text-[10px] text-primary-focus">v2.0</span>
          </span>
          <span className="block text-[8px] font-bold text-slate-500 uppercase tracking-widest leading-none">{t('navigation.orderControl')}</span>
        </div>
      </div>

      {/* Navigation list */}
      <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
        {visibleMenuItems.map((item) => {
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

      {/* User Card, Language Switcher & Logout */}
      <div className="p-4 border-t border-white/5 space-y-3 bg-slate-950/30 flex-shrink-0">
        {/* Language Switcher in Admin Sidebar */}
        <div className="flex justify-center">
          <LanguageSwitcher size="sm" />
        </div>

        <div className="flex items-center gap-3 px-2">
          <Link 
            href="/admin/profile" 
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 border border-white/10 text-slate-300 flex-shrink-0 hover:bg-white/10 hover:text-white transition-all"
            title={t('navigation.profile')}
          >
            <User className="h-4 w-4" />
          </Link>
          <div className="flex-1 min-w-0">
            <span className="block text-xs font-bold text-slate-200 truncate">{user?.name}</span>
            <span className="block text-[8px] text-slate-500 uppercase tracking-widest font-extrabold leading-none mt-1 truncate">
              {user?.roleName || 'Superadmin'}
            </span>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-2">
          {canSwitchToSeller ? (
            <Link 
              href="/seller" 
              className="flex items-center justify-center rounded-lg border border-cyan-500/25 bg-cyan-500/10 py-1.5 text-[9px] font-bold text-cyan-400 hover:bg-cyan-500/20 transition-all"
              title={t('navigation.sellerConsole')}
            >
              {t('navigation.sellerConsole')}
            </Link>
          ) : (
            <div className="flex items-center justify-center rounded-lg border border-white/5 bg-white/[0.02] py-1.5 text-[9px] font-bold text-slate-500">
              Admin
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center justify-center gap-1 rounded-lg bg-red-500/10 border border-red-500/20 py-1.5 text-[9px] font-bold text-red-400 hover:bg-red-500/20 transition-all"
          >
            <LogOut className="h-3 w-3" />
            <span>{t('auth.logout')}</span>
          </button>
        </div>
      </div>
    </>
  );

  return (
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
            <button
              onClick={() => setDrawerOpen(true)}
              className="h-8 w-8 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-all"
              aria-label="Menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-primary to-accent">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="font-extrabold tracking-tight text-xs uppercase text-slate-200">Admin Control</span>
          </div>

          <div className="flex items-center gap-2">
            <LanguageSwitcher size="sm" />
            {canSwitchToSeller && (
              <Link 
                href="/seller"
                className="px-2.5 py-1 text-[9px] font-bold rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
              >
                {t('navigation.sellerConsole')}
              </Link>
            )}
            <button 
              onClick={handleLogout}
              className="h-7 w-7 rounded bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center"
              title={t('auth.logout')}
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>


        {/* Mobile horizontal sub-nav */}
        <nav className="flex-shrink-0 flex lg:hidden bg-slate-950/80 border-b border-white/5 py-2 px-4 gap-1.5 overflow-x-auto select-none z-20">
          {visibleMenuItems.map((item) => {
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
