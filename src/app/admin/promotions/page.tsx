'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Sparkles, Plus, Edit, Trash2, Search, Package, Check, AlertCircle,
  Loader2, X, ChevronDown, ChevronRight, ToggleLeft, ToggleRight,
  Building2, ShoppingBag, Zap, ArrowRight, Hash, Calendar
} from 'lucide-react';
import { useTranslation } from '@/i18n/context';

interface ProductRef {
  id: string;
  sku: string;
  name: string;
  basePrice: number;
  imageUrl: string;
}

interface CompanyRef {
  id: string;
  name: string;
  code: string;
}

interface Promotion {
  id: string;
  name: string;
  type: 'SKU_BONUS' | 'ORDER_PERCENTAGE' | 'ORDER_FIXED_AMOUNT';
  isActive: boolean;
  bonusMode: 'SAME_SKU' | 'ANOTHER_SKU';
  minimumBlocks: number;
  bonusBlocks: number;
  discountPercent?: number | null;
  allocatedAmount?: number | null;
  remainingAmount?: number | null;
  maxOrderUsagePercent?: number | null;
  consumedAmount?: number | null;
  applyToAllCompanies: boolean;
  startDate: string | null;
  endDate: string | null;
  sourceProduct: ProductRef | null;
  bonusProduct: ProductRef | null;
  companies: CompanyRef[];
  createdAt: string;
  updatedAt: string;
}

interface FormData {
  name: string;
  type: 'SKU_BONUS' | 'ORDER_PERCENTAGE' | 'ORDER_FIXED_AMOUNT';
  bonusMode: 'SAME_SKU' | 'ANOTHER_SKU';
  minimumBlocks: number;
  bonusBlocks: number;
  sourceProductId: string;
  bonusProductId: string;
  discountPercent: string;
  allocatedAmount: string;
  maxOrderUsagePercent: string;
  applyToAllCompanies: boolean;
  companyIds: string[];
  startDate: string;
  endDate: string;
  isActive: boolean;
}

const defaultForm: FormData = {
  name: '',
  type: 'SKU_BONUS',
  bonusMode: 'SAME_SKU',
  minimumBlocks: 50,
  bonusBlocks: 5,
  sourceProductId: '',
  bonusProductId: '',
  discountPercent: '5',
  allocatedAmount: '10000000',
  maxOrderUsagePercent: '10',
  applyToAllCompanies: true,
  companyIds: [],
  startDate: '',
  endDate: '',
  isActive: true
};

export default function PromotionsPage() {
  const { t } = useTranslation();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [products, setProducts] = useState<ProductRef[]>([]);
  const [companies, setCompanies] = useState<CompanyRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>({ ...defaultForm });
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Product search within modal
  const [sourceSearch, setSourceSearch] = useState('');
  const [bonusSearch, setBonusSearch] = useState('');
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [showBonusDropdown, setShowBonusDropdown] = useState(false);

  const loadPromotions = async () => {
    try {
      const res = await fetch('/api/admin/promotions');
      if (res.ok) setPromotions(await res.json());
    } catch (e) {
      console.error('Failed to load promotions', e);
    } finally {
      setLoading(false);
    }
  };

  const loadProducts = async () => {
    try {
      const res = await fetch('/api/products');
      if (res.ok) {
        const data = await res.json();
        setProducts(data.map((p: any) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          basePrice: p.basePrice,
          imageUrl: p.imageUrl
        })));
      }
    } catch (e) {
      console.error('Failed to load products', e);
    }
  };

  const loadCompanies = async () => {
    try {
      const res = await fetch('/api/admin/companies');
      if (res.ok) {
        const data = await res.json();
        setCompanies(data.map((c: any) => ({
          id: c.id,
          name: c.name,
          code: c.code
        })));
      }
    } catch (e) {
      console.error('Failed to load companies', e);
    }
  };

  useEffect(() => {
    loadPromotions();
    loadProducts();
    loadCompanies();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return promotions;
    const q = search.toLowerCase();
    return promotions.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.sourceProduct && (
        p.sourceProduct.name.toLowerCase().includes(q) ||
        p.sourceProduct.sku.toLowerCase().includes(q)
      )) ||
      (p.bonusProduct && (
        p.bonusProduct.name.toLowerCase().includes(q) ||
        p.bonusProduct.sku.toLowerCase().includes(q)
      ))
    );
  }, [promotions, search]);

  const filteredSourceProducts = useMemo(() => {
    if (!sourceSearch.trim()) return products;
    const q = sourceSearch.toLowerCase();
    return products.filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [products, sourceSearch]);

  const filteredBonusProducts = useMemo(() => {
    if (!bonusSearch.trim()) return products;
    const q = bonusSearch.toLowerCase();
    return products.filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [products, bonusSearch]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...defaultForm });
    setSourceSearch('');
    setBonusSearch('');
    setShowModal(true);
    setError('');
  };

  const openEdit = (promo: Promotion) => {
    setEditingId(promo.id);
    setForm({
      name: promo.name,
      type: promo.type || 'SKU_BONUS',
      bonusMode: promo.bonusMode || 'SAME_SKU',
      minimumBlocks: promo.minimumBlocks || 50,
      bonusBlocks: promo.bonusBlocks || 5,
      sourceProductId: promo.sourceProduct?.id || '',
      bonusProductId: promo.bonusProduct?.id || '',
      discountPercent: promo.discountPercent ? String(promo.discountPercent) : '5',
      allocatedAmount: promo.allocatedAmount ? String(promo.allocatedAmount) : '10000000',
      maxOrderUsagePercent: promo.maxOrderUsagePercent ? String(promo.maxOrderUsagePercent) : '10',
      applyToAllCompanies: promo.applyToAllCompanies,
      companyIds: promo.companies.map(c => c.id),
      startDate: promo.startDate ? promo.startDate.split('T')[0] : '',
      endDate: promo.endDate ? promo.endDate.split('T')[0] : '',
      isActive: promo.isActive
    });
    setSourceSearch(promo.sourceProduct?.name || '');
    setBonusSearch(promo.bonusProduct?.name || '');
    setShowModal(true);
    setError('');
  };

  const isFormValid = useMemo(() => {
    if (!form.name || form.name.trim() === '') return false;
    if (form.type === 'SKU_BONUS') {
      if (!form.sourceProductId) return false;
      if (form.bonusMode === 'ANOTHER_SKU' && !form.bonusProductId) return false;
      return true;
    }
    if (form.type === 'ORDER_PERCENTAGE') {
      const pct = parseFloat(form.discountPercent);
      return !isNaN(pct) && pct > 0 && pct <= 100;
    }
    if (form.type === 'ORDER_FIXED_AMOUNT') {
      const amt = parseFloat(form.allocatedAmount);
      return !isNaN(amt) && amt > 0;
    }
    return true;
  }, [form]);

  const handleSubmit = async () => {
    if (!isFormValid) return;
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const url = editingId
        ? `/api/admin/promotions/${editingId}`
        : '/api/admin/promotions';
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка');

      setSuccess(editingId ? 'Акция обновлена.' : 'Акция создана.');
      setShowModal(false);
      loadPromotions();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (promo: Promotion) => {
    try {
      const res = await fetch(`/api/admin/promotions/${promo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !promo.isActive })
      });
      if (res.ok) {
        setSuccess(`Акция "${promo.name}" ${promo.isActive ? 'деактивирована' : 'активирована'}.`);
        loadPromotions();
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/promotions/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess('Акция удалена.');
      setConfirmDeleteId(null);
      loadPromotions();
    } catch (e: any) {
      setError(e.message);
      setConfirmDeleteId(null);
    }
  };

  const selectedSourceProduct = products.find(p => p.id === form.sourceProductId);
  const selectedBonusProduct = products.find(p => p.id === form.bonusProductId);

  const formatNumber = (n: number) =>
    new Intl.NumberFormat('ru-RU').format(n);

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('ru-RU');
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
    <div className="space-y-6 animate-fade-in">
      {/* Alerts */}
      {success && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
          <Check className="h-4 w-4 text-emerald-400" />
          <span className="text-sm text-emerald-300">{success}</span>
          <button onClick={() => setSuccess('')} className="ml-auto"><X className="h-3 w-3 text-emerald-400" /></button>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-red-400" />
          <span className="text-sm text-red-300">{error}</span>
          <button onClick={() => setError('')} className="ml-auto"><X className="h-3 w-3 text-red-400" /></button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 p-2.5 border border-amber-500/10">
            <Sparkles className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Акции и скидки</h2>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mt-0.5">
              {promotions.length} акци{promotions.length === 1 ? 'я' : promotions.length < 5 ? 'и' : 'й'}
            </p>
          </div>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Новая акция
        </button>
      </div>

      {/* Search */}
      <div className="glass-panel rounded-2xl p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Поиск по названию, SKU товара..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="glass-input pl-10 w-full"
          />
        </div>
      </div>

      {/* Promotions List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="glass-panel rounded-2xl p-12 text-center">
            <Sparkles className="h-10 w-10 text-slate-600 mx-auto" />
            <p className="text-sm text-slate-400 mt-3">Акции не найдены</p>
          </div>
        ) : (
          filtered.map(promo => (
            <div key={promo.id} className="glass-panel rounded-2xl overflow-hidden border border-white/5 transition-all hover:border-white/10">
              {/* Row */}
              <div className="flex items-center gap-4 p-4 cursor-pointer" onClick={() => setExpandedId(expandedId === promo.id ? null : promo.id)}>
                {/* Status indicator */}
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${promo.isActive ? 'bg-emerald-400 shadow-lg shadow-emerald-400/30' : 'bg-slate-600'}`} />

                {/* Mode badge */}
                <div className={`px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider flex-shrink-0 ${
                  promo.type === 'ORDER_PERCENTAGE'
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                    : promo.type === 'ORDER_FIXED_AMOUNT'
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                    : promo.bonusMode === 'SAME_SKU'
                    ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/20'
                    : 'bg-purple-500/15 text-purple-400 border border-purple-500/20'
                }`}>
                  {promo.type === 'ORDER_PERCENTAGE'
                    ? `Скидка ${promo.discountPercent}%`
                    : promo.type === 'ORDER_FIXED_AMOUNT'
                    ? `Фикс. лимит ${formatNumber(promo.remainingAmount || 0)} сум`
                    : promo.bonusMode === 'SAME_SKU' ? 'Тот же SKU' : 'Другой SKU'}
                </div>

                {/* Name & products */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white truncate">{promo.name}</span>
                  </div>
                  {promo.sourceProduct && (
                    <div className="flex items-center gap-1.5 mt-1 text-[10px] text-slate-400">
                      <Package className="h-3 w-3" />
                      <span className="truncate">{promo.sourceProduct.sku} — {promo.sourceProduct.name}</span>
                      {promo.bonusProduct && (
                        <>
                          <ArrowRight className="h-3 w-3 text-amber-400 flex-shrink-0" />
                          <span className="truncate text-amber-300">{promo.bonusProduct.sku}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Metrics */}
                <div className="flex items-center gap-6 flex-shrink-0">
                  {promo.type === 'SKU_BONUS' ? (
                    <>
                      <div className="text-center">
                        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Порог</div>
                        <div className="text-sm font-bold text-white">{promo.minimumBlocks} бл.</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Бонус</div>
                        <div className="text-sm font-bold text-emerald-400">+{promo.bonusBlocks} бл.</div>
                      </div>
                    </>
                  ) : promo.type === 'ORDER_PERCENTAGE' ? (
                    <div className="text-center">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Скидка</div>
                      <div className="text-sm font-bold text-emerald-400">{promo.discountPercent}%</div>
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Остаток лимита</div>
                      <div className="text-sm font-bold text-amber-400">{formatNumber(promo.remainingAmount || 0)} сум</div>
                    </div>
                  )}
                  <div className="text-center">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Компании</div>
                    <div className="text-sm font-bold text-white">
                      {promo.applyToAllCompanies ? 'Все' : promo.companies.length}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => handleToggleActive(promo)}
                    className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
                    title={promo.isActive ? 'Деактивировать' : 'Активировать'}
                  >
                    {promo.isActive
                      ? <ToggleRight className="h-5 w-5 text-emerald-400" />
                      : <ToggleLeft className="h-5 w-5 text-slate-500" />
                    }
                  </button>
                  <button
                    onClick={() => openEdit(promo)}
                    className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
                  >
                    <Edit className="h-4 w-4 text-slate-400 hover:text-white" />
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(promo.id)}
                    className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4 text-slate-400 hover:text-red-400" />
                  </button>
                </div>

                {/* Chevron */}
                <div className="flex-shrink-0">
                  {expandedId === promo.id
                    ? <ChevronDown className="h-4 w-4 text-slate-400" />
                    : <ChevronRight className="h-4 w-4 text-slate-400" />
                  }
                </div>
              </div>

              {/* Expanded detail */}
              {expandedId === promo.id && (
                <div className="border-t border-white/5 p-4 bg-white/[0.02] animate-fade-in">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {/* Source product card */}
                    <div className="space-y-1">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Товар-источник</div>
                      {promo.sourceProduct ? (
                        <div className="flex items-center gap-2">
                          <img src={promo.sourceProduct.imageUrl} alt="" className="w-8 aspect-[4/5] rounded-lg object-contain bg-slate-800 p-0.5" />
                          <div>
                            <div className="text-xs font-semibold text-white">{promo.sourceProduct.name}</div>
                            <div className="text-[10px] text-slate-400">{promo.sourceProduct.sku} · {formatNumber(promo.sourceProduct.basePrice)} сум</div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400">Весь заказ</div>
                      )}
                    </div>

                    {/* Bonus product card */}
                    <div className="space-y-1">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Бонусный товар</div>
                      {promo.bonusProduct ? (
                        <div className="flex items-center gap-2">
                          <img src={promo.bonusProduct.imageUrl} alt="" className="w-8 aspect-[4/5] rounded-lg object-contain bg-slate-800 p-0.5" />
                          <div>
                            <div className="text-xs font-semibold text-white">{promo.bonusProduct.name}</div>
                            <div className="text-[10px] text-slate-400">{promo.bonusProduct.sku} · {formatNumber(promo.bonusProduct.basePrice)} сум</div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500">—</div>
                      )}
                    </div>

                    {/* Date range */}
                    <div className="space-y-1">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Период действия</div>
                      <div className="flex items-center gap-1 text-xs text-white">
                        <Calendar className="h-3 w-3 text-slate-400" />
                        {formatDate(promo.startDate)} — {formatDate(promo.endDate)}
                      </div>
                    </div>

                    {/* Assigned companies */}
                    <div className="space-y-1">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Компании</div>
                      {promo.applyToAllCompanies ? (
                        <div className="text-xs text-emerald-400">Применяется ко всем</div>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {promo.companies.map(c => (
                            <span key={c.id} className="px-1.5 py-0.5 text-[9px] font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 rounded">
                              {c.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Formula preview */}
                  <div className="mt-4 p-3 rounded-xl bg-slate-800/50 border border-white/5">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-2">Описание правила</div>
                    {promo.type === 'SKU_BONUS' && promo.sourceProduct ? (
                      <div className="text-xs text-slate-300">
                        За каждые <span className="text-cyan-400 font-bold">{promo.minimumBlocks}</span> блоков товара
                        <span className="text-white font-bold"> {promo.sourceProduct.sku}</span> →
                        бонус <span className="text-emerald-400 font-bold">+{promo.bonusBlocks}</span> блоков
                        {promo.bonusProduct
                          ? <> товара <span className="text-amber-400 font-bold">{promo.bonusProduct.sku}</span></>
                          : <> того же товара</>
                        }
                      </div>
                    ) : promo.type === 'ORDER_PERCENTAGE' ? (
                      <div className="text-xs text-slate-300">
                        Скидка <span className="text-emerald-400 font-bold">{promo.discountPercent}%</span> на всю сумму заказа.
                      </div>
                    ) : (
                      <div className="text-xs text-slate-300">
                        Выделенный лимит: <span className="text-amber-400 font-bold">{formatNumber(promo.allocatedAmount || 0)} сум</span>.
                        Остаток: <span className="text-emerald-400 font-bold">{formatNumber(promo.remainingAmount || 0)} сум</span>.
                        Макс. списание за заказ: <span className="text-cyan-400 font-bold">{promo.maxOrderUsagePercent || 10}%</span> от суммы заказа.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Delete Confirm Modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDeleteId(null)}>
          <div className="glass-panel rounded-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-white mb-2">Удалить акцию?</h3>
            <p className="text-sm text-slate-400 mb-4">Это действие нельзя отменить. Акция будет удалена навсегда.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDeleteId(null)} className="btn-secondary flex-1">Отмена</button>
              <button onClick={() => handleDelete(confirmDeleteId)} className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold bg-red-500/20 text-red-400 border border-red-500/20 hover:bg-red-500/30 transition-colors">
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)}>
          <div className="glass-panel rounded-3xl p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-white">
                {editingId ? 'Редактировать акцию' : 'Новая акция'}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-white/5 rounded-lg transition-colors">
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 mb-4">
                <AlertCircle className="h-4 w-4 text-red-400" />
                <span className="text-xs text-red-300">{error}</span>
              </div>
            )}

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Название акции *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="glass-input w-full"
                  placeholder="Акция «50+5 блоков» / «Скидка 5% на заказ»"
                />
              </div>

              {/* Promotion Type Selector */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Тип коммерческого условия *</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, type: 'SKU_BONUS' }))}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                      form.type === 'SKU_BONUS'
                        ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                        : 'bg-white/[0.02] border-white/5 text-slate-400 hover:bg-white/5'
                    }`}
                  >
                    SKU Акция (10+1)
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, type: 'ORDER_PERCENTAGE' }))}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                      form.type === 'ORDER_PERCENTAGE'
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                        : 'bg-white/[0.02] border-white/5 text-slate-400 hover:bg-white/5'
                    }`}
                  >
                    Процент от заказа (%)
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, type: 'ORDER_FIXED_AMOUNT' }))}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                      form.type === 'ORDER_FIXED_AMOUNT'
                        ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                        : 'bg-white/[0.02] border-white/5 text-slate-400 hover:bg-white/5'
                    }`}
                  >
                    Фикс. сумма (Лимит)
                  </button>
                </div>
              </div>

              {/* Conditional Fields based on Type */}
              {form.type === 'SKU_BONUS' && (
                <>
                  {/* Bonus Mode */}
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Режим бонуса</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setForm(f => ({ ...f, bonusMode: 'SAME_SKU', bonusProductId: '' }))}
                        className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                          form.bonusMode === 'SAME_SKU'
                            ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300'
                            : 'bg-white/[0.02] border-white/5 text-slate-400 hover:bg-white/5'
                        }`}
                      >
                        <Zap className="h-3.5 w-3.5 inline mr-1.5" />
                        Тот же SKU
                      </button>
                      <button
                        type="button"
                        onClick={() => setForm(f => ({ ...f, bonusMode: 'ANOTHER_SKU' }))}
                        className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                          form.bonusMode === 'ANOTHER_SKU'
                            ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                            : 'bg-white/[0.02] border-white/5 text-slate-400 hover:bg-white/5'
                        }`}
                      >
                        <ArrowRight className="h-3.5 w-3.5 inline mr-1.5" />
                        Другой SKU
                      </button>
                    </div>
                  </div>

                  {/* Source product */}
                  <div className="relative">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                      Товар-источник *
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={sourceSearch}
                        onChange={e => { setSourceSearch(e.target.value); setShowSourceDropdown(true); }}
                        onFocus={() => setShowSourceDropdown(true)}
                        className="glass-input w-full"
                        placeholder="Поиск по SKU или названию..."
                      />
                      {selectedSourceProduct && (
                        <div className="mt-1 flex items-center gap-2 px-2 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                          <img src={selectedSourceProduct.imageUrl} alt="" className="w-5 aspect-[4/5] rounded object-contain" />
                          <span className="text-[10px] font-semibold text-indigo-300">{selectedSourceProduct.sku} — {selectedSourceProduct.name}</span>
                          <button type="button" onClick={() => { setForm(f => ({ ...f, sourceProductId: '' })); setSourceSearch(''); }} className="ml-auto">
                            <X className="h-3 w-3 text-indigo-400" />
                          </button>
                        </div>
                      )}
                    </div>
                    {showSourceDropdown && filteredSourceProducts.length > 0 && (
                      <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-xl bg-slate-800 border border-white/10 shadow-2xl">
                        {filteredSourceProducts.slice(0, 15).map(p => (
                          <button
                            type="button"
                            key={p.id}
                            onClick={() => {
                              setForm(f => ({ ...f, sourceProductId: p.id }));
                              setSourceSearch(p.name);
                              setShowSourceDropdown(false);
                            }}
                            className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-white/5 transition-colors"
                          >
                            <img src={p.imageUrl} alt="" className="w-6 aspect-[4/5] rounded object-contain bg-slate-700 p-0.5" />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-white truncate">{p.name}</div>
                              <div className="text-[10px] text-slate-400">{p.sku} · {formatNumber(p.basePrice)} сум</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Bonus product (only if ANOTHER_SKU) */}
                  {form.bonusMode === 'ANOTHER_SKU' && (
                    <div className="relative">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                        Бонусный товар *
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={bonusSearch}
                          onChange={e => { setBonusSearch(e.target.value); setShowBonusDropdown(true); }}
                          onFocus={() => setShowBonusDropdown(true)}
                          className="glass-input w-full"
                          placeholder="Поиск по SKU или названию..."
                        />
                        {selectedBonusProduct && (
                          <div className="mt-1 flex items-center gap-2 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20">
                            <img src={selectedBonusProduct.imageUrl} alt="" className="w-5 aspect-[4/5] rounded object-contain" />
                            <span className="text-[10px] font-semibold text-amber-300">{selectedBonusProduct.sku} — {selectedBonusProduct.name}</span>
                            <button type="button" onClick={() => { setForm(f => ({ ...f, bonusProductId: '' })); setBonusSearch(''); }} className="ml-auto">
                              <X className="h-3 w-3 text-amber-400" />
                            </button>
                          </div>
                        )}
                      </div>
                      {showBonusDropdown && filteredBonusProducts.length > 0 && (
                        <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-xl bg-slate-800 border border-white/10 shadow-2xl">
                          {filteredBonusProducts.slice(0, 15).map(p => (
                            <button
                              type="button"
                              key={p.id}
                              onClick={() => {
                                setForm(f => ({ ...f, bonusProductId: p.id }));
                                setBonusSearch(p.name);
                                setShowBonusDropdown(false);
                              }}
                              className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-white/5 transition-colors"
                            >
                              <img src={p.imageUrl} alt="" className="w-6 aspect-[4/5] rounded object-contain bg-slate-700 p-0.5" />
                              <div className="flex-1 min-w-0">
                                <div className="text-xs text-white truncate">{p.name}</div>
                                <div className="text-[10px] text-slate-400">{p.sku} · {formatNumber(p.basePrice)} сум</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Blocks thresholds */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Мин. блоков для акции *</label>
                      <input
                        type="number"
                        min="1"
                        value={form.minimumBlocks}
                        onChange={e => setForm(f => ({ ...f, minimumBlocks: parseInt(e.target.value) || 0 }))}
                        className="glass-input w-full"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Бонусных блоков *</label>
                      <input
                        type="number"
                        min="1"
                        value={form.bonusBlocks}
                        onChange={e => setForm(f => ({ ...f, bonusBlocks: parseInt(e.target.value) || 0 }))}
                        className="glass-input w-full"
                      />
                    </div>
                  </div>
                </>
              )}

              {form.type === 'ORDER_PERCENTAGE' && (
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Скидка на заказ (%) *</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="100"
                    value={form.discountPercent}
                    onChange={e => setForm(f => ({ ...f, discountPercent: e.target.value }))}
                    className="glass-input w-full"
                    placeholder="Например: 4 или 7"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Применяется ко всем товарам после SKU-акций.</p>
                </div>
              )}

              {form.type === 'ORDER_FIXED_AMOUNT' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Выделенный лимит скидки (сум) *</label>
                    <input
                      type="number"
                      step="1000"
                      min="1"
                      value={form.allocatedAmount}
                      onChange={e => setForm(f => ({ ...f, allocatedAmount: e.target.value }))}
                      className="glass-input w-full"
                      placeholder="Например: 3655000"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">Расходуемый лимит. Уменьшается автоматически при оформлении заказов.</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Макс. % списания за 1 заказ (по умолчанию 10%)</label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max="100"
                      value={form.maxOrderUsagePercent}
                      onChange={e => setForm(f => ({ ...f, maxOrderUsagePercent: e.target.value }))}
                      className="glass-input w-full"
                      placeholder="10"
                    />
                  </div>
                </div>
              )}

              {/* Date range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Дата начала</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                    className="glass-input w-full"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Дата окончания</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                    className="glass-input w-full"
                  />
                </div>
              </div>

              {/* Company targeting */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">Применение к компаниям</label>
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={() => setForm(f => ({ ...f, applyToAllCompanies: true, companyIds: [] }))}
                    className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                      form.applyToAllCompanies
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        : 'bg-white/[0.02] border-white/5 text-slate-400 hover:bg-white/5'
                    }`}
                  >
                    Все компании
                  </button>
                  <button
                    onClick={() => setForm(f => ({ ...f, applyToAllCompanies: false }))}
                    className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                      !form.applyToAllCompanies
                        ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300'
                        : 'bg-white/[0.02] border-white/5 text-slate-400 hover:bg-white/5'
                    }`}
                  >
                    Выбранные
                  </button>
                </div>
                {!form.applyToAllCompanies && (
                  <div className="max-h-32 overflow-y-auto rounded-xl bg-slate-800/50 border border-white/5 p-2 space-y-1">
                    {companies.map(c => (
                      <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer transition-colors">
                        <input
                          type="checkbox"
                          checked={form.companyIds.includes(c.id)}
                          onChange={e => {
                            setForm(f => ({
                              ...f,
                              companyIds: e.target.checked
                                ? [...f.companyIds, c.id]
                                : f.companyIds.filter(id => id !== c.id)
                            }));
                          }}
                          className="rounded border-white/20"
                        />
                        <span className="text-xs text-white">{c.name}</span>
                        <span className="text-[9px] text-slate-500 ml-auto">{c.code}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Active toggle */}
              <div className="flex items-center justify-between py-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Статус</label>
                <button
                  onClick={() => setForm(f => ({ ...f, isActive: !f.isActive }))}
                  className="flex items-center gap-2"
                >
                  {form.isActive
                    ? <><ToggleRight className="h-6 w-6 text-emerald-400" /><span className="text-xs text-emerald-400 font-semibold">Активна</span></>
                    : <><ToggleLeft className="h-6 w-6 text-slate-500" /><span className="text-xs text-slate-500 font-semibold">Неактивна</span></>
                  }
                </button>
              </div>
            </div>

            {/* Submit */}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="btn-secondary flex-1">Отмена</button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !isFormValid}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {editingId ? 'Сохранить' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
