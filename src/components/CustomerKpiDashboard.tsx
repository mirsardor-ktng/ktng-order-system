'use client';

import { useState, useEffect, useMemo } from 'react';
import { Clock, DollarSign, PackageCheck, Target, TrendingUp, CheckCircle2, AlertCircle } from 'lucide-react';

interface OrderItem {
  id: string;
  orderNumber: string;
  status: string;
  totalPacks: number;
  totalBlocks: number;
  totalCases: number;
  totalPrice: number;
  createdAt: string;
}

interface UserCompany {
  id?: string;
  name?: string;
  code?: string;
  purchasePlanCases?: number | null;
  monthlyTargetCases?: number | null;
}

interface CustomerKpiDashboardProps {
  orders?: OrderItem[];
  company?: UserCompany | null;
  className?: string;
}

export default function CustomerKpiDashboard({ orders: propOrders, company: propCompany, className = '' }: CustomerKpiDashboardProps) {
  const [orders, setOrders] = useState<OrderItem[]>(propOrders || []);
  const [company, setCompany] = useState<UserCompany | null>(propCompany || null);
  const [loading, setLoading] = useState(!propOrders || !propCompany);

  useEffect(() => {
    if (propOrders) setOrders(propOrders);
    if (propCompany) setCompany(propCompany);
  }, [propOrders, propCompany]);

  useEffect(() => {
    if (propOrders && propCompany) return;

    let isMounted = true;
    async function loadData() {
      try {
        const [meRes, ordersRes] = await Promise.all([
          fetch('/api/auth/me', { cache: 'no-store' }),
          fetch('/api/orders', { cache: 'no-store' })
        ]);

        if (meRes.ok) {
          const meData = await meRes.json();
          if (isMounted && meData.authenticated && meData.user?.company) {
            setCompany(meData.user.company);
          }
        }

        if (ordersRes.ok) {
          const ordersData = await ordersRes.json();
          if (isMounted && Array.isArray(ordersData)) {
            setOrders(ordersData);
          }
        }
      } catch (err) {
        console.error('Failed to load customer KPI data', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();
    return () => { isMounted = false; };
  }, [propOrders, propCompany]);

  const stats = useMemo(() => {
    const validOrders = orders.filter(o => o.status !== 'DRAFT' && o.status !== 'CANCELLED');
    
    // 1. Last Order (most recent submitted/created order)
    const sorted = [...validOrders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const latestOrder = sorted[0] || [...orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    // 2. Total Purchase Volume (UZS)
    const totalPurchaseVolume = validOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);

    // 3. Total Shipped Quantity (status: SHIPPED or COMPLETED)
    const shippedOrders = orders.filter(o => o.status === 'SHIPPED' || o.status === 'COMPLETED');
    const totalShippedCases = Math.round(shippedOrders.reduce((sum, o) => sum + (o.totalCases || 0), 0) * 100) / 100;
    const totalShippedBlocks = shippedOrders.reduce((sum, o) => sum + (o.totalBlocks || 0), 0);

    // 4. Current Month Plan & Progress
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const currentMonthShippedOrders = shippedOrders.filter(o => {
      const d = new Date(o.createdAt);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    const currentMonthCases = Math.round(currentMonthShippedOrders.reduce((sum, o) => sum + (o.totalCases || 0), 0) * 100) / 100;
    const targetCases = company?.monthlyTargetCases || company?.purchasePlanCases || 0;
    const planProgressPercent = targetCases > 0 ? Math.round((currentMonthCases / targetCases) * 100) : 0;

    return {
      latestOrder,
      totalPurchaseVolume,
      totalShippedCases,
      totalShippedBlocks,
      currentMonthCases,
      targetCases,
      planProgressPercent
    };
  }, [orders, company]);

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'NEW':
        return { text: 'Новый', color: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' };
      case 'ASSEMBLY':
        return { text: 'Сборка', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
      case 'SHIPPED':
        return { text: 'Отгружен', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' };
      case 'COMPLETED':
        return { text: 'Завершен', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
      case 'CANCELLED':
        return { text: 'Отменен', color: 'bg-red-500/10 text-red-400 border-red-500/20' };
      case 'DRAFT':
        return { text: 'Черновик', color: 'bg-slate-700/30 text-slate-400 border-slate-700/50' };
      default:
        return { text: status, color: 'bg-slate-700/30 text-slate-400 border-slate-700/50' };
    }
  };

  const formatDateTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-4 ${className}`}>
      {/* ── CARD 1: Последний заказ ── */}
      <div className="glass-panel relative overflow-hidden rounded-2xl p-5 border-l-4 border-l-cyan-500 transition-all hover:bg-white/[0.04]">
        <div className="flex justify-between items-center text-slate-400">
          <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">Последний заказ</span>
          <div className="h-7 w-7 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400">
            <Clock className="h-4 w-4" />
          </div>
        </div>

        {stats.latestOrder ? (
          <div className="mt-2.5 space-y-1">
            <div className="text-base font-extrabold text-slate-100 truncate">
              {formatDateTime(stats.latestOrder.createdAt)}
            </div>
            <div className="flex items-center gap-2 pt-0.5">
              <span className="text-[11px] font-bold text-slate-300">№ {stats.latestOrder.orderNumber}</span>
              <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold border ${getStatusLabel(stats.latestOrder.status).color}`}>
                {getStatusLabel(stats.latestOrder.status).text}
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-2.5 space-y-1">
            <div className="text-sm font-bold text-slate-400">Заказов пока нет</div>
            <p className="text-[10px] text-slate-500">Оформите ваш первый оптовый заказ</p>
          </div>
        )}
      </div>

      {/* ── CARD 2: Общий объем закупа ── */}
      <div className="glass-panel relative overflow-hidden rounded-2xl p-5 border-l-4 border-l-emerald-500 transition-all hover:bg-white/[0.04]">
        <div className="flex justify-between items-center text-slate-400">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Общий объем закупа</span>
          <div className="h-7 w-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
            <DollarSign className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-2.5 space-y-1">
          <div className="text-base sm:text-lg font-extrabold text-emerald-400 truncate">
            {stats.totalPurchaseVolume.toLocaleString('ru-RU')} <span className="text-xs font-semibold text-emerald-400/80">so'm</span>
          </div>
          <p className="text-[10px] text-slate-400 font-medium">Сумма всех оформленных заказов</p>
        </div>
      </div>

      {/* ── CARD 3: Общее отгруженное количество ── */}
      <div className="glass-panel relative overflow-hidden rounded-2xl p-5 border-l-4 border-l-indigo-500 transition-all hover:bg-white/[0.04]">
        <div className="flex justify-between items-center text-slate-400">
          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Отгружено продукции</span>
          <div className="h-7 w-7 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
            <PackageCheck className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-2.5 space-y-1">
          <div className="text-base sm:text-lg font-extrabold text-slate-100 truncate">
            {stats.totalShippedCases.toLocaleString('ru-RU')} <span className="text-xs font-semibold text-slate-400">коробок</span>
          </div>
          <p className="text-[10px] text-slate-400 font-medium">
            {stats.totalShippedBlocks.toLocaleString('ru-RU')} блоков (отгруженные заказы)
          </p>
        </div>
      </div>

      {/* ── CARD 4: План на текущий месяц ── */}
      <div className="glass-panel relative overflow-hidden rounded-2xl p-5 border-l-4 border-l-amber-500 transition-all hover:bg-white/[0.04]">
        <div className="flex justify-between items-center text-slate-400">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">План на текущий месяц</span>
          <div className="h-7 w-7 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400">
            <Target className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-2.5 space-y-2">
          <div className="flex items-baseline justify-between">
            <div className="text-base sm:text-lg font-extrabold text-slate-100">
              {stats.targetCases > 0 ? (
                <>
                  {stats.currentMonthCases.toLocaleString('ru-RU')} <span className="text-xs text-slate-400 font-normal">/ {stats.targetCases.toLocaleString('ru-RU')} кор.</span>
                </>
              ) : (
                <>
                  {stats.currentMonthCases.toLocaleString('ru-RU')} <span className="text-xs text-slate-400 font-normal">кор.</span>
                </>
              )}
            </div>

            {stats.targetCases > 0 && (
              <span className={`text-xs font-extrabold ${stats.planProgressPercent >= 100 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {stats.planProgressPercent}%
              </span>
            )}
          </div>

          {stats.targetCases > 0 ? (
            <div className="w-full bg-slate-800/80 rounded-full h-1.5 overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-700 ${stats.planProgressPercent >= 100 ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : 'bg-gradient-to-r from-amber-500 to-orange-400'}`}
                style={{ width: `${Math.min(100, stats.planProgressPercent)}%` }}
              />
            </div>
          ) : (
            <p className="text-[10px] text-slate-500">План компании на месяц не установлен</p>
          )}
        </div>
      </div>
    </div>
  );
}
