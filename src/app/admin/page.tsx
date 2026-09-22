'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  LayoutDashboard, ShoppingBag, Users, FolderCheck, FileText, 
  ArrowRight, ShieldCheck, Database, Calendar, CheckCircle2, 
  Clock, AlertCircle, Banknote, Layers, Package, Loader2
} from 'lucide-react';
import { useTranslation } from '@/i18n/context';

interface Order {
  id: string;
  orderNumber: string;
  totalPrice: number;
  status: string;
  createdAt: string;
  customer: {
    name: string;
  };
}

interface AuditLog {
  id: string;
  action: string;
  details: string;
  timestamp: string;
  user?: {
    email: string;
  };
}

export default function AdminOverview() {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState({
    totalUsers: 0,
    totalOrders: 0,
    totalTemplates: 0,
    revenue: 0,
    blocks: 0,
    cases: 0
  });
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [latestOrders, setLatestOrders] = useState<Order[]>([]);
  const [latestLogs, setLatestLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadOverviewData() {
      // Fetch each data source independently so one failure doesn't cascade
      let gdriveData: any = {};
      let ordersData: any[] = [];
      let logsData: any[] = [];

      // 1. Fetch Google Drive Settings & Metrics
      try {
        const gdriveRes = await fetch('/api/admin/gdrive');
        if (gdriveRes.ok) {
          gdriveData = await gdriveRes.json();
          setSyncEnabled(gdriveData.syncEnabled || false);
        }
      } catch (err) {
        console.error('[Dashboard] Failed to load GDrive settings:', err);
      }

      // 2. Fetch Orders for detailed totals
      try {
        const ordersRes = await fetch('/api/orders');
        const ordersJson = await ordersRes.json();
        // Validate response is an array (not an error object)
        if (Array.isArray(ordersJson)) {
          ordersData = ordersJson;
        } else {
          console.warn('[Dashboard] /api/orders returned non-array:', ordersJson?.error || ordersJson);
        }
      } catch (err) {
        console.error('[Dashboard] Failed to load orders:', err);
      }

      // 3. Fetch Audit Logs
      try {
        const logsRes = await fetch('/api/admin/logs');
        const logsJson = await logsRes.json();
        if (Array.isArray(logsJson)) {
          logsData = logsJson;
        }
      } catch (err) {
        console.error('[Dashboard] Failed to load audit logs:', err);
      }

      // Calculate Revenue, Blocks, Cases from active orders (excluding DRAFT and CANCELLED)
      const activeOrders = ordersData.filter((o: any) => o.status !== 'DRAFT' && o.status !== 'CANCELLED');
      const revenue = activeOrders.reduce((sum: number, o: any) => sum + (o.totalPrice || 0), 0);
      const blocks = activeOrders.reduce((sum: number, o: any) => sum + (o.totalBlocks || 0), 0);
      const cases = activeOrders.reduce((sum: number, o: any) => sum + (o.totalCases || 0), 0);

      setMetrics({
        totalUsers: gdriveData.metrics?.totalUsers || 0,
        totalOrders: ordersData.length,
        totalTemplates: gdriveData.metrics?.totalTemplates || 0,
        revenue,
        blocks,
        cases: Math.round(cases * 100) / 100
      });

      setLatestOrders(ordersData.slice(0, 5));
      setLatestLogs(logsData.slice(0, 5));
      setLoading(false);
    }

    loadOverviewData();
  }, []);

  // Helper to render order badges
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <span className="text-[9px] font-bold text-slate-400">Черновик</span>;
      case 'NEW':
        return <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">Новый</span>;
      case 'ASSEMBLY':
        return <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 border border-amber-500/20 text-amber-400">Сборка</span>;
      case 'SHIPPED':
        return <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">Отгрузка</span>;
      case 'COMPLETED':
        return <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-semibold">Завершен</span>;
      case 'CANCELLED':
        return <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-red-500/10 border border-red-500/20 text-red-400">Отменен</span>;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 w-full flex-col items-center justify-center text-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-xs font-semibold text-slate-400">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <LayoutDashboard className="h-5 w-5 text-primary" />
            <span>Панель управления суперадминистратора</span>
          </h2>
          <span className="block text-xs text-slate-400 mt-1 font-semibold">
            Операционный контроль, управление товарами, клиентами и интеграцией GDrive
          </span>
        </div>

        {/* Sync Mode Banner */}
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold ${
          syncEnabled 
            ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-400 glow-text-success'
            : 'bg-amber-500/15 border-amber-500/35 text-amber-400'
        }`}>
          <Database className="h-4 w-4" />
          <span>GDrive Sync: {syncEnabled ? 'Подключен' : 'Локальный Fallback'}</span>
        </div>
      </div>

      {/* 1. Core KPIs Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Rev */}
        <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-primary">
          <div className="flex justify-between items-center text-slate-500">
            <span className="text-[10px] font-bold uppercase tracking-wider">Gross Общий доход</span>
            <Banknote className="h-4.5 w-4.5 text-primary" />
          </div>
          <span className="block mt-2 text-xl font-extrabold text-slate-100">{metrics.revenue.toLocaleString()} UZS</span>
          <span className="block mt-1 text-[9px] text-slate-500 font-semibold">Всего B2B сделок</span>
        </div>

        {/* Cases */}
        <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-cyan-500">
          <div className="flex justify-between items-center text-slate-500">
            <span className="text-[10px] font-bold uppercase tracking-wider">Коробки (Cases)</span>
            <Package className="h-4.5 w-4.5 text-cyan-400" />
          </div>
          <span className="block mt-2 text-xl font-extrabold text-slate-100">{metrics.cases} кор.</span>
          <span className="block mt-1 text-[9px] text-slate-500 font-semibold">500 пачек в коробке</span>
        </div>

        {/* Blocks */}
        <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-emerald-500">
          <div className="flex justify-between items-center text-slate-500">
            <span className="text-[10px] font-bold uppercase tracking-wider">Блоки (Blocks)</span>
            <Layers className="h-4.5 w-4.5 text-emerald-400" />
          </div>
          <span className="block mt-2 text-xl font-extrabold text-slate-100">{metrics.blocks} бл.</span>
          <span className="block mt-1 text-[9px] text-slate-500 font-semibold">10 пачек в блоке</span>
        </div>

        {/* Users */}
        <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-amber-500">
          <div className="flex justify-between items-center text-slate-500">
            <span className="text-[10px] font-bold uppercase tracking-wider">Зарегистрировано</span>
            <Users className="h-4.5 w-4.5 text-amber-400" />
          </div>
          <span className="block mt-2 text-xl font-extrabold text-slate-100">{metrics.totalUsers} пользователей</span>
          <span className="block mt-1 text-[9px] text-slate-500 font-semibold">Заказчики, продавцы и админы</span>
        </div>
      </div>

      {/* 2. Overview content grids split */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Section left: Latest orders */}
        <div className="glass-panel rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-slate-200 text-sm sm:text-base flex items-center gap-2">
              <ShoppingBag className="h-4.5 w-4.5 text-indigo-400" />
              <span>Последние B2B заказы</span>
            </h3>
            <Link href="/seller" className="text-primary-focus text-xs font-bold hover:underline flex items-center gap-1">
              <span>Смотреть журнал</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {latestOrders.length === 0 ? (
            <p className="text-slate-500 text-xs py-8 text-center">Заказов в системе еще не оформлено.</p>
          ) : (
            <div className="space-y-3">
              {latestOrders.map((order) => {
                const date = new Date(order.createdAt).toLocaleDateString('ru-RU', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit'
                });
                return (
                  <div key={order.id} className="bg-slate-900/30 border border-white/5 rounded-xl p-3 flex justify-between items-center text-xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-300">{order.orderNumber}</span>
                        {renderStatusBadge(order.status)}
                      </div>
                      <span className="block text-[10px] text-slate-500 font-semibold mt-1">
                        Клиент: {order.customer.name} ({date})
                      </span>
                    </div>

                    <span className="font-extrabold text-emerald-400">{order.totalPrice.toLocaleString()} UZS</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Section right: Audit trail */}
        <div className="glass-panel rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-slate-200 text-sm sm:text-base flex items-center gap-2">
              <ShieldCheck className="h-4.5 w-4.5 text-emerald-400" />
              <span>Аудит безопасности (Audit Logs)</span>
            </h3>
            <Link href="/admin/logs" className="text-primary-focus text-xs font-bold hover:underline flex items-center gap-1">
              <span>Весь лог</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {latestLogs.length === 0 ? (
            <p className="text-slate-500 text-xs py-8 text-center">Записей аудита безопасности нет.</p>
          ) : (
            <div className="space-y-3">
              {latestLogs.map((log) => {
                const logTime = new Date(log.timestamp).toLocaleTimeString('ru-RU', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                });
                return (
                  <div key={log.id} className="bg-slate-900/30 border border-white/5 rounded-xl p-3 text-xs leading-normal">
                    <div className="flex justify-between items-center text-[10px] text-slate-500 mb-1 font-semibold">
                      <span className="text-primary-focus font-bold">{log.action}</span>
                      <span>{logTime}</span>
                    </div>
                    <p className="text-slate-300 text-[11px] leading-relaxed">{log.details}</p>
                    {log.user && (
                      <span className="block text-[8px] text-slate-600 font-bold tracking-wide uppercase mt-1">Инициатор: {log.user.email}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
