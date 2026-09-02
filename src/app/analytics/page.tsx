"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Minus,
  ShoppingBag,
  DollarSign,
  Package,
  Hash,
  Layers,
  Star,
  Clock,
  ArrowRight,
  Loader2,
  X,
  Users,
  Percent,
  CalendarDays,
  Box,
} from "lucide-react";

// Lazy-load heavy chart and table components
const MonthlyChart = dynamic(() => import("./MonthlyChart"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[350px] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
    </div>
  ),
});

const MonthDetailTable = dynamic(() => import("./MonthDetailTable"), {
  ssr: false,
  loading: () => (
    <div className="flex h-32 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
    </div>
  ),
});

interface AnalyticsData {
  isCustomer: boolean;
  summary: {
    totalOrders: number;
    totalRevenue: number;
    averageCheck: number;
    totalCases: number;
    averageCases: number;
    averageSkus: number;
    totalUniqueSkus: number;
  };
  monthlyTrend: Array<{
    month: string;
    revenue: number;
    orders: number;
    cases: number;
  }>;
  products: Array<{
    productId: string;
    sku: string;
    name: string;
    cases: number;
    revenue: number;
    share: number;
    growth: number;
  }>;
  customers?: Array<{
    customerId: string;
    customerName: string;
    orders: number;
    revenue: number;
    averageOrder: number;
  }>;
  insights?: {
    averageOrderCases: number;
    lastOrderDaysAgo: number | null;
    favoriteProduct: string | null;
    favoriteProductShare: number;
    topSystemGrowingProduct: { name: string; growth: number } | null;
    averageCheckTrend: "UP" | "DOWN" | "EQUAL";
    casesAllTime: number;
    casesThisYear: number;
    casesThisMonth: number;
  };
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState<"revenue" | "orders" | "cases">(
    "revenue"
  );
  const [selectedMonth, setSelectedMonth] = useState<any>(null);
  const [monthProducts, setMonthProducts] = useState<any[]>([]);
  const [monthProductsLoading, setMonthProductsLoading] = useState(false);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async (monthKey?: string) => {
    setLoading(true);
    try {
      const url = monthKey
        ? `/api/analytics?month=${monthKey}`
        : "/api/analytics";
      const res = await fetch(url);
      if (res.ok) {
        setData(await res.json());
      }
    } catch (err) {
      console.error("Analytics fetch failed", err);
    } finally {
      setLoading(false);
    }
  };

  // When a month is selected on chart, fetch month-specific product data
  const handleMonthSelect = async (monthPayload: any) => {
    setSelectedMonth(monthPayload);
    setMonthProductsLoading(true);
    try {
      const res = await fetch(
        `/api/analytics?month=${monthPayload.month}`
      );
      if (res.ok) {
        const monthData = await res.json();
        setMonthProducts(monthData.products || []);
      }
    } catch (err) {
      console.error("Month detail fetch failed", err);
    } finally {
      setMonthProductsLoading(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        <p className="mt-4 text-sm font-semibold text-slate-400">
          Загрузка аналитики продаж...
        </p>
      </div>
    );
  }

  const { summary, monthlyTrend, products, customers, insights, isCustomer } =
    data;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-4 sm:p-6 lg:p-8 space-y-8 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-100 flex items-center gap-3">
            <BarChart3 className="h-7 w-7 text-indigo-500" />
            <span>Аналитика продаж</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 font-semibold">
            {isCustomer
              ? "Ваша персональная статистика закупок"
              : "Общая статистика по всем дилерам"}
          </p>
        </div>
      </div>

      {/* ============= CUSTOMER INSIGHTS SECTION ============= */}
      {isCustomer && insights && (
        <div className="space-y-6">
          {/* Customer insights cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {/* Average Order */}
            <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-indigo-500 hover:border-l-indigo-400 transition-all">
              <div className="flex justify-between items-center text-slate-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  Ваш средний заказ
                </span>
                <Package className="h-4 w-4 text-indigo-400" />
              </div>
              <span className="block mt-2 text-2xl font-extrabold text-slate-100">
                {insights.averageOrderCases}{" "}
                <span className="text-sm text-slate-400 font-bold">
                  коробок
                </span>
              </span>
            </div>

            {/* Last Order */}
            <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-cyan-500 hover:border-l-cyan-400 transition-all">
              <div className="flex justify-between items-center text-slate-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  Последний заказ
                </span>
                <Clock className="h-4 w-4 text-cyan-400" />
              </div>
              <span className="block mt-2 text-2xl font-extrabold text-slate-100">
                {insights.lastOrderDaysAgo !== null
                  ? `${insights.lastOrderDaysAgo} ${insights.lastOrderDaysAgo === 1 ? "день" : insights.lastOrderDaysAgo < 5 ? "дня" : "дней"} назад`
                  : "Нет данных"}
              </span>
            </div>

            {/* Favorite Product */}
            <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-amber-500 hover:border-l-amber-400 transition-all">
              <div className="flex justify-between items-center text-slate-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  Чаще всего Вы покупаете
                </span>
                <Star className="h-4 w-4 text-amber-400" />
              </div>
              <span className="block mt-2 text-lg font-extrabold text-slate-100 line-clamp-1">
                {insights.favoriteProduct || "—"}
              </span>
              <span className="block mt-1 text-[10px] text-slate-500 font-semibold">
                {insights.favoriteProductShare}% ваших заказов
              </span>
            </div>

            {/* Top Growing Product (System-wide) */}
            {insights.topSystemGrowingProduct && (
              <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-emerald-500 hover:border-l-emerald-400 transition-all">
                <div className="flex justify-between items-center text-slate-400">
                  <span className="text-[10px] font-bold uppercase tracking-wider">
                    Самый быстрорастущий товар
                  </span>
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                </div>
                <span className="block mt-2 text-lg font-extrabold text-slate-100 line-clamp-1">
                  {insights.topSystemGrowingProduct.name}
                </span>
                <span className="block mt-1 text-xs text-emerald-400 font-extrabold">
                  +{insights.topSystemGrowingProduct.growth}%
                </span>
              </div>
            )}

            {/* Favorite SKU Share */}
            <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-violet-500 hover:border-l-violet-400 transition-all">
              <div className="flex justify-between items-center text-slate-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  Доля любимого SKU
                </span>
                <Percent className="h-4 w-4 text-violet-400" />
              </div>
              <span className="block mt-2 text-3xl font-extrabold text-slate-100">
                {insights.favoriteProductShare}%
              </span>
              <span className="block mt-1 text-[10px] text-slate-500 font-semibold">
                приходится на {insights.favoriteProduct || "—"}
              </span>
            </div>

            {/* Check Dynamics */}
            <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-rose-500 hover:border-l-rose-400 transition-all">
              <div className="flex justify-between items-center text-slate-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  Динамика среднего чека
                </span>
                {insights.averageCheckTrend === "UP" ? (
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                ) : insights.averageCheckTrend === "DOWN" ? (
                  <TrendingDown className="h-4 w-4 text-red-400" />
                ) : (
                  <Minus className="h-4 w-4 text-slate-400" />
                )}
              </div>
              <div className="mt-2 flex items-center gap-3">
                <span
                  className={`text-3xl font-extrabold ${
                    insights.averageCheckTrend === "UP"
                      ? "text-emerald-400"
                      : insights.averageCheckTrend === "DOWN"
                        ? "text-red-400"
                        : "text-slate-300"
                  }`}
                >
                  {insights.averageCheckTrend === "UP"
                    ? "↑"
                    : insights.averageCheckTrend === "DOWN"
                      ? "↓"
                      : "="}
                </span>
                <span className="text-xs text-slate-400 font-semibold">
                  по сравнению с прошлым месяцем
                </span>
              </div>
            </div>

            {/* Boxes stats */}
            <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-sky-500 hover:border-l-sky-400 transition-all sm:col-span-2 lg:col-span-1">
              <div className="flex justify-between items-center text-slate-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  Куплено коробок
                </span>
                <Box className="h-4 w-4 text-sky-400" />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-4">
                <div>
                  <span className="block text-[9px] text-slate-500 font-bold uppercase">
                    За всё время
                  </span>
                  <span className="block text-lg font-extrabold text-slate-100 mt-0.5">
                    {insights.casesAllTime}
                  </span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500 font-bold uppercase">
                    За год
                  </span>
                  <span className="block text-lg font-extrabold text-slate-100 mt-0.5">
                    {insights.casesThisYear}
                  </span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500 font-bold uppercase">
                    За месяц
                  </span>
                  <span className="block text-lg font-extrabold text-slate-100 mt-0.5">
                    {insights.casesThisMonth}
                  </span>
                </div>
              </div>
            </div>

            {/* Button → Orders */}
            <div className="glass-panel rounded-2xl p-5 flex items-center justify-center border border-dashed border-indigo-500/20 hover:border-indigo-500/40 transition-all cursor-pointer group"
              onClick={() => router.push("/customer/orders")}
            >
              <div className="text-center">
                <ArrowRight className="h-6 w-6 text-indigo-400 mx-auto group-hover:translate-x-1 transition-transform" />
                <span className="block mt-2 text-xs font-bold text-indigo-400 group-hover:text-indigo-300">
                  История заказов
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============= ADMIN / SELLER / MANAGER SECTION ============= */}
      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-indigo-500">
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Заказы
            </span>
            <Hash className="h-4 w-4 text-indigo-400" />
          </div>
          <span className="block mt-2 text-2xl font-extrabold text-slate-100">
            {summary.totalOrders}
          </span>
        </div>

        <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-emerald-500">
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Выручка
            </span>
            <DollarSign className="h-4 w-4 text-emerald-400" />
          </div>
          <span className="block mt-2 text-2xl font-extrabold text-slate-100">
            {summary.totalRevenue.toLocaleString()}
          </span>
          <span className="block text-[9px] text-slate-500 font-semibold mt-1">
            UZS
          </span>
        </div>

        <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-cyan-500">
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Средний чек
            </span>
            <DollarSign className="h-4 w-4 text-cyan-400" />
          </div>
          <span className="block mt-2 text-2xl font-extrabold text-slate-100">
            {summary.averageCheck.toLocaleString()}
          </span>
        </div>

        <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-amber-500">
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Всего коробок
            </span>
            <Package className="h-4 w-4 text-amber-400" />
          </div>
          <span className="block mt-2 text-2xl font-extrabold text-slate-100">
            {summary.totalCases}
          </span>
        </div>

        <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-violet-500">
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Ср. коробок
            </span>
            <Layers className="h-4 w-4 text-violet-400" />
          </div>
          <span className="block mt-2 text-2xl font-extrabold text-slate-100">
            {summary.averageCases}
          </span>
        </div>

        <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-rose-500">
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Ср. SKU
            </span>
            <ShoppingBag className="h-4 w-4 text-rose-400" />
          </div>
          <span className="block mt-2 text-2xl font-extrabold text-slate-100">
            {summary.averageSkus}
          </span>
        </div>

        <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-sky-500">
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Уник. SKU
            </span>
            <Layers className="h-4 w-4 text-sky-400" />
          </div>
          <span className="block mt-2 text-2xl font-extrabold text-slate-100">
            {summary.totalUniqueSkus}
          </span>
        </div>
      </div>

      {/* Chart Section */}
      <div className="glass-panel rounded-3xl p-5 sm:p-6 border border-white/5 space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h2 className="text-base font-bold text-slate-200 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-indigo-400" />
            <span>Динамика продаж по месяцам</span>
          </h2>

          {/* Chart type toggle */}
          <div className="flex items-center gap-1.5 bg-slate-950/40 p-1.5 rounded-xl border border-white/5">
            {(
              [
                { key: "revenue", label: "Выручка" },
                { key: "orders", label: "Заказы" },
                { key: "cases", label: "Коробки" },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                onClick={() => setChartType(item.key)}
                className={`px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all ${
                  chartType === item.key
                    ? "bg-indigo-600 text-white shadow-glass-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <MonthlyChart
          data={monthlyTrend}
          chartType={chartType}
          onMonthSelect={handleMonthSelect}
        />

        <p className="text-[10px] text-slate-500 font-semibold text-center">
          Нажмите на колонку месяца для детализации
        </p>
      </div>

      {/* Month Detail Section */}
      {selectedMonth && (
        <div className="glass-panel rounded-3xl p-5 sm:p-6 border border-white/5 space-y-5 animate-fade-in">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-bold text-slate-200 flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-cyan-400" />
              <span>
                Детализация за{" "}
                <span className="text-cyan-400">
                  {selectedMonth.month}
                </span>
              </span>
            </h2>
            <button
              onClick={() => setSelectedMonth(null)}
              className="p-1.5 rounded-lg border border-white/5 bg-slate-900 text-slate-400 hover:text-white hover:bg-white/5 transition-all"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Month KPI cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4">
              <span className="block text-[9px] text-slate-500 font-bold uppercase">
                Заказы
              </span>
              <span className="block text-xl font-extrabold text-slate-100 mt-1">
                {selectedMonth.orders}
              </span>
            </div>
            <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4">
              <span className="block text-[9px] text-slate-500 font-bold uppercase">
                Средний чек
              </span>
              <span className="block text-xl font-extrabold text-slate-100 mt-1">
                {selectedMonth.orders > 0
                  ? Math.round(
                      selectedMonth.revenue / selectedMonth.orders
                    ).toLocaleString()
                  : 0}
              </span>
            </div>
            <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4">
              <span className="block text-[9px] text-slate-500 font-bold uppercase">
                Коробок
              </span>
              <span className="block text-xl font-extrabold text-slate-100 mt-1">
                {Math.round(selectedMonth.cases * 100) / 100}
              </span>
            </div>
            <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4">
              <span className="block text-[9px] text-slate-500 font-bold uppercase">
                Выручка
              </span>
              <span className="block text-xl font-extrabold text-emerald-400 mt-1">
                {selectedMonth.revenue.toLocaleString()}
              </span>
            </div>
            <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4">
              <span className="block text-[9px] text-slate-500 font-bold uppercase">
                Уникальных SKU
              </span>
              <span className="block text-xl font-extrabold text-slate-100 mt-1">
                {monthProducts.length}
              </span>
            </div>
          </div>

          {/* SKU detail table for the selected month */}
          {monthProductsLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
            </div>
          ) : (
            <MonthDetailTable products={monthProducts} />
          )}

          {/* Customer: Link to orders for selected month */}
          {isCustomer && (
            <div className="flex justify-center pt-2">
              <button
                onClick={() =>
                  router.push(
                    `/customer/orders?month=${selectedMonth.month}`
                  )
                }
                className="btn-primary flex items-center gap-2 px-5 py-2.5 text-xs"
              >
                <span>
                  История заказов за {selectedMonth.month}
                </span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Products Overview (All-time) */}
      {!selectedMonth && products.length > 0 && (
        <div className="glass-panel rounded-3xl p-5 sm:p-6 border border-white/5 space-y-4">
          <h2 className="text-base font-bold text-slate-200 flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-amber-400" />
            <span>Продажи по SKU (общие)</span>
          </h2>
          <MonthDetailTable products={products} />
        </div>
      )}

      {/* Customer Rankings (Admin/Seller/Manager only) */}
      {!isCustomer && customers && customers.length > 0 && (
        <div className="glass-panel rounded-3xl p-5 sm:p-6 border border-white/5 space-y-4">
          <h2 className="text-base font-bold text-slate-200 flex items-center gap-2">
            <Users className="h-5 w-5 text-violet-400" />
            <span>Рейтинг дилеров</span>
          </h2>
          <div className="glass-panel rounded-2xl overflow-hidden border border-white/5">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 bg-slate-950/40 text-[10px] text-slate-400 uppercase tracking-wider font-extrabold">
                    <th className="py-3 px-5">#</th>
                    <th className="py-3 px-5">Дилер</th>
                    <th className="py-3 px-5 text-right">Заказы</th>
                    <th className="py-3 px-5 text-right">Выручка</th>
                    <th className="py-3 px-5 text-right">
                      Средний чек
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs">
                  {customers.map((c, idx) => (
                    <tr
                      key={c.customerId}
                      className="hover:bg-white/5 transition-all text-slate-300"
                    >
                      <td className="py-3 px-5 font-extrabold text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="py-3 px-5 font-bold text-slate-200">
                        {c.customerName}
                      </td>
                      <td className="py-3 px-5 text-right font-bold">
                        {c.orders}
                      </td>
                      <td className="py-3 px-5 text-right font-extrabold text-emerald-400">
                        {c.revenue.toLocaleString()} so'm
                      </td>
                      <td className="py-3 px-5 text-right font-bold text-slate-300">
                        {c.averageOrder.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
