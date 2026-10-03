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
  ArrowLeft,
  Loader2,
  X,
  Users,
  Percent,
  CalendarDays,
  Box,
  Building2,
  ChevronDown,
} from "lucide-react";
import { useTranslation } from "@/i18n/context";
import LanguageSwitcher from "@/components/LanguageSwitcher";

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
    revenueGrowth?: number | null;
    ordersGrowth?: number | null;
    casesGrowth?: number | null;
    averageCheckGrowth?: number | null;
  };
  monthlyTrend: Array<{
    month: string;
    rawKey?: string;
    revenue: number;
    orders: number;
    cases: number;
  }>;
  chartGranularity?: 'day' | 'month';
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
  companies?: Array<{
    id: string;
    name: string;
    code: string;
  }>;
  period?: {
    currentStart: string | null;
    currentEnd: string | null;
    previousStart: string | null;
    previousEnd: string | null;
    periodLength: number | null;
  };
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
  const { t, language } = useTranslation();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState<"revenue" | "orders" | "cases">(
    "revenue"
  );
  const [selectedMonth, setSelectedMonth] = useState<any>(null);
  const [monthProducts, setMonthProducts] = useState<any[]>([]);
  const [monthProductsLoading, setMonthProductsLoading] = useState(false);

  const [draftStartDate, setDraftStartDate] = useState<string>("");
  const [draftEndDate, setDraftEndDate] = useState<string>("");
  const [appliedStartDate, setAppliedStartDate] = useState<string>("");
  const [appliedEndDate, setAppliedEndDate] = useState<string>("");
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [companyDropdownOpen, setCompanyDropdownOpen] = useState(false);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async (
    monthKey?: string,
    sDate: string = appliedStartDate,
    eDate: string = appliedEndDate,
    cIds: string[] = selectedCompanyIds
  ) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (monthKey) params.set("month", monthKey);
      if (sDate) params.set("startDate", sDate);
      if (eDate) params.set("endDate", eDate);
      if (cIds.length > 0) params.set("companyIds", cIds.join(","));

      const query = params.toString();
      const url = query ? `/api/analytics?${query}` : "/api/analytics";
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

  const handleApplyFilters = () => {
    setAppliedStartDate(draftStartDate);
    setAppliedEndDate(draftEndDate);
    setSelectedMonth(null);
    setMonthProducts([]);
    fetchAnalytics(undefined, draftStartDate, draftEndDate, selectedCompanyIds);
  };

  const handleResetFilters = () => {
    setDraftStartDate("");
    setDraftEndDate("");
    setAppliedStartDate("");
    setAppliedEndDate("");
    setSelectedCompanyIds([]);
    setSelectedMonth(null);
    setMonthProducts([]);
    fetchAnalytics(undefined, "", "", []);
  };

  const toggleCompany = (id: string) => {
    setSelectedCompanyIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const selectAllCompanies = () => {
    if (data?.companies) {
      setSelectedCompanyIds(data.companies.map((c) => c.id));
    }
  };

  const clearCompanies = () => {
    setSelectedCompanyIds([]);
  };

  // When a month is selected on chart, fetch month-specific product data
  const handleMonthSelect = async (monthPayload: any) => {
    setSelectedMonth(monthPayload);
    setMonthProductsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("month", monthPayload.rawKey || monthPayload.month);
      if (appliedStartDate) params.set("startDate", appliedStartDate);
      if (appliedEndDate) params.set("endDate", appliedEndDate);
      if (selectedCompanyIds.length > 0) params.set("companyIds", selectedCompanyIds.join(","));

      const res = await fetch(`/api/analytics?${params.toString()}`);
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

  const renderGrowthBadge = (growth?: number | null) => {
    if (growth === undefined || growth === null) {
      return (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700">
          <Minus className="h-3 w-3" />
          <span>N/A</span>
        </span>
      );
    }

    if (growth > 0) {
      return (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <TrendingUp className="h-3 w-3" />
          <span>+{growth}%</span>
        </span>
      );
    }

    if (growth < 0) {
      return (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-rose-500/10 text-rose-400 border border-rose-500/20">
          <TrendingDown className="h-3 w-3" />
          <span>{growth}%</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
        <Minus className="h-3 w-3" />
        <span>0%</span>
      </span>
    );
  };

  if (loading || !data) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        <p className="mt-4 text-sm font-semibold text-slate-400">
          {t('analytics.loading')}
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
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-xl bg-slate-900/60 border border-white/5 text-slate-400 hover:text-white hover:bg-white/5 transition-all"
            title={t('common.back')}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-100 flex items-center gap-3">
              <BarChart3 className="h-7 w-7 text-indigo-500" />
              <span>{t('analytics.title')}</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1 font-semibold">
              {isCustomer
                ? t('analytics.customerSubtitle')
                : t('analytics.generalSubtitle')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <LanguageSwitcher />
        </div>
      </div>

      {/* Filters Bar: Period & Multi-Company */}
      <div className="glass-panel rounded-2xl p-4 sm:p-5 border border-white/5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Start Date */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-semibold">{t('analytics.startDate')}:</span>
            <input
              type="date"
              value={draftStartDate}
              onChange={(e) => setDraftStartDate(e.target.value)}
              className="bg-slate-900/80 border border-slate-700/60 text-slate-200 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* End Date */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-semibold">{t('analytics.endDate')}:</span>
            <input
              type="date"
              value={draftEndDate}
              onChange={(e) => setDraftEndDate(e.target.value)}
              className="bg-slate-900/80 border border-slate-700/60 text-slate-200 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Company Multi-Select (Staff only) */}
          {!isCustomer && data.companies && data.companies.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setCompanyDropdownOpen((prev) => !prev)}
                className="bg-slate-900/80 border border-slate-700/60 text-slate-200 text-xs rounded-xl px-3 py-2 flex items-center gap-2 hover:border-slate-600 transition-colors"
              >
                <Building2 className="h-3.5 w-3.5 text-indigo-400" />
                <span>
                  {selectedCompanyIds.length === 0
                    ? t('analytics.allCompanies')
                    : `${selectedCompanyIds.length} ${t('seller.companiesCount')}`}
                </span>
                <ChevronDown className="h-3 w-3 text-slate-400" />
              </button>

              {companyDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setCompanyDropdownOpen(false)}
                  />
                  <div className="absolute left-0 top-full mt-2 w-72 max-h-80 overflow-y-auto bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-3 z-50 space-y-2">
                    <div className="flex justify-between items-center pb-2 border-b border-white/5">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        {t('analytics.selectCompanies')}
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={selectAllCompanies}
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold"
                        >
                          {t('analytics.selectAll')}
                        </button>
                        <span className="text-slate-600">|</span>
                        <button
                          type="button"
                          onClick={clearCompanies}
                          className="text-[10px] text-slate-400 hover:text-white font-bold"
                        >
                          {t('analytics.clear')}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1.5 pt-1">
                      {data.companies.map((c) => {
                        const isSelected = selectedCompanyIds.includes(c.id);
                        return (
                          <label
                            key={c.id}
                            className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-white/5 cursor-pointer text-xs text-slate-200"
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleCompany(c.id)}
                              className="rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-0 focus:ring-offset-0"
                            />
                            <span className="truncate font-medium">{c.name}</span>
                            {c.code && (
                              <span className="ml-auto text-[10px] text-slate-500 font-mono">
                                {c.code}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleApplyFilters}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-glass transition-all"
          >
            {t('analytics.apply')}
          </button>
          <button
            type="button"
            onClick={handleResetFilters}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold rounded-xl border border-white/5 transition-all"
          >
            {t('analytics.reset')}
          </button>
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
                  {t('analytics.averageOrder')}
                </span>
                <Package className="h-4 w-4 text-indigo-400" />
              </div>
              <span className="block mt-2 text-2xl font-extrabold text-slate-100">
                {insights.averageOrderCases}{" "}
                <span className="text-sm text-slate-400 font-bold">
                  {t('dashboard.casesUnit')}
                </span>
              </span>
            </div>

            {/* Last Order */}
            <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-cyan-500 hover:border-l-cyan-400 transition-all">
              <div className="flex justify-between items-center text-slate-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  {t('analytics.lastOrder')}
                </span>
                <Clock className="h-4 w-4 text-cyan-400" />
              </div>
              <span className="block mt-2 text-2xl font-extrabold text-slate-100">
                {insights.lastOrderDaysAgo !== null
                  ? `${insights.lastOrderDaysAgo} ${
                      language === 'ru'
                        ? (insights.lastOrderDaysAgo === 1 ? t('analytics.dayAgo') : insights.lastOrderDaysAgo < 5 ? t('analytics.daysAgoFew') : t('analytics.daysAgo'))
                        : t('analytics.daysAgo')
                    }`
                  : t('analytics.noData')}
              </span>
            </div>

            {/* Favorite Product */}
            <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-amber-500 hover:border-l-amber-400 transition-all">
              <div className="flex justify-between items-center text-slate-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  {t('analytics.favoriteProduct')}
                </span>
                <Star className="h-4 w-4 text-amber-400" />
              </div>
              <span className="block mt-2 text-lg font-extrabold text-slate-100 line-clamp-1">
                {insights.favoriteProduct || "—"}
              </span>
              <span className="block mt-1 text-[10px] text-slate-500 font-semibold">
                {insights.favoriteProductShare}% {t('analytics.ofYourOrders')}
              </span>
            </div>

            {/* Top Growing Product (System-wide) */}
            {insights.topSystemGrowingProduct && (
              <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-emerald-500 hover:border-l-emerald-400 transition-all">
                <div className="flex justify-between items-center text-slate-400">
                  <span className="text-[10px] font-bold uppercase tracking-wider">
                    {t('analytics.topGrowingProduct')}
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
                  {t('analytics.favoriteSkuShare')}
                </span>
                <Percent className="h-4 w-4 text-violet-400" />
              </div>
              <span className="block mt-2 text-3xl font-extrabold text-slate-100">
                {insights.favoriteProductShare}%
              </span>
              <span className="block mt-1 text-[10px] text-slate-500 font-semibold">
                {t('analytics.accountsFor')} {insights.favoriteProduct || "—"}
              </span>
            </div>

            {/* Check Dynamics */}
            <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-rose-500 hover:border-l-rose-400 transition-all">
              <div className="flex justify-between items-center text-slate-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  {t('analytics.averageCheckDynamics')}
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
                  {t('analytics.comparedToLastMonth')}
                </span>
              </div>
            </div>

            {/* Boxes stats */}
            <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-sky-500 hover:border-l-sky-400 transition-all sm:col-span-2 lg:col-span-1">
              <div className="flex justify-between items-center text-slate-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">
                  {t('analytics.casesPurchased')}
                </span>
                <Box className="h-4 w-4 text-sky-400" />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-4">
                <div>
                  <span className="block text-[9px] text-slate-500 font-bold uppercase">
                    {t('analytics.allTime')}
                  </span>
                  <span className="block text-lg font-extrabold text-slate-100 mt-0.5">
                    {insights.casesAllTime}
                  </span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500 font-bold uppercase">
                    {t('analytics.thisYear')}
                  </span>
                  <span className="block text-lg font-extrabold text-slate-100 mt-0.5">
                    {insights.casesThisYear}
                  </span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500 font-bold uppercase">
                    {t('analytics.thisMonth')}
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
                  {t('analytics.ordersHistory')}
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
              {t('analytics.orders')}
            </span>
            <Hash className="h-4 w-4 text-indigo-400" />
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-extrabold text-slate-100">
              {summary.totalOrders}
            </span>
            {renderGrowthBadge(summary.ordersGrowth)}
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-emerald-500">
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">
              {t('analytics.revenue')}
            </span>
            <DollarSign className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-extrabold text-slate-100">
              {summary.totalRevenue.toLocaleString()}
            </span>
            {renderGrowthBadge(summary.revenueGrowth)}
          </div>
          <span className="block text-[9px] text-slate-500 font-semibold mt-1">
            UZS
          </span>
        </div>

        <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-cyan-500">
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">
              {t('analytics.averageCheck')}
            </span>
            <DollarSign className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-extrabold text-slate-100">
              {summary.averageCheck.toLocaleString()}
            </span>
            {renderGrowthBadge(summary.averageCheckGrowth)}
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-amber-500">
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">
              {t('analytics.totalCases')}
            </span>
            <Package className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl font-extrabold text-slate-100">
              {summary.totalCases}
            </span>
            {renderGrowthBadge(summary.casesGrowth)}
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-violet-500">
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">
              {t('analytics.avgCases')}
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
              {t('analytics.avgSkus')}
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
              {t('analytics.uniqueSkus')}
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
            <span>
              {data.chartGranularity === 'day'
                ? t('analytics.dailyDynamics')
                : t('analytics.monthlyDynamics')}
            </span>
          </h2>

          {/* Chart type toggle */}
          <div className="flex items-center gap-1.5 bg-slate-950/40 p-1.5 rounded-xl border border-white/5">
            {(
              [
                { key: "revenue", label: t('analytics.revenue') },
                { key: "orders", label: t('analytics.orders') },
                { key: "cases", label: t('analytics.totalCases') },
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
          {t('analytics.clickToDetail')}
        </p>
      </div>

      {/* Month Detail Section */}
      {selectedMonth && (
        <div className="glass-panel rounded-3xl p-5 sm:p-6 border border-white/5 space-y-5 animate-fade-in">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-bold text-slate-200 flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-cyan-400" />
              <span>
                {t('analytics.detailFor')}{" "}
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
                {t('analytics.orders')}
              </span>
              <span className="block text-xl font-extrabold text-slate-100 mt-1">
                {selectedMonth.orders}
              </span>
            </div>
            <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4">
              <span className="block text-[9px] text-slate-500 font-bold uppercase">
                {t('analytics.averageCheck')}
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
                {t('analytics.totalCases')}
              </span>
              <span className="block text-xl font-extrabold text-slate-100 mt-1">
                {Math.round(selectedMonth.cases * 100) / 100}
              </span>
            </div>
            <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4">
              <span className="block text-[9px] text-slate-500 font-bold uppercase">
                {t('analytics.revenue')}
              </span>
              <span className="block text-xl font-extrabold text-emerald-400 mt-1">
                {selectedMonth.revenue.toLocaleString()}
              </span>
            </div>
            <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4">
              <span className="block text-[9px] text-slate-500 font-bold uppercase">
                {t('analytics.uniqueSkus')}
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
                  {t('analytics.ordersHistoryFor')} {selectedMonth.month}
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
            <span>{t('analytics.skuSalesAll')}</span>
          </h2>
          <MonthDetailTable products={products} />
        </div>
      )}

      {/* Customer Rankings (Admin/Seller/Manager only) */}
      {!isCustomer && customers && customers.length > 0 && (
        <div className="glass-panel rounded-3xl p-5 sm:p-6 border border-white/5 space-y-4">
          <h2 className="text-base font-bold text-slate-200 flex items-center gap-2">
            <Users className="h-5 w-5 text-violet-400" />
            <span>{t('analytics.dealerRankings')}</span>
          </h2>
          <div className="glass-panel rounded-2xl overflow-hidden border border-white/5">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 bg-slate-950/40 text-[10px] text-slate-400 uppercase tracking-wider font-extrabold">
                    <th className="py-3 px-5">#</th>
                    <th className="py-3 px-5">{t('analytics.dealer')}</th>
                    <th className="py-3 px-5 text-right">{t('analytics.orders')}</th>
                    <th className="py-3 px-5 text-right">{t('analytics.revenue')}</th>
                    <th className="py-3 px-5 text-right">
                      {t('analytics.averageCheck')}
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
