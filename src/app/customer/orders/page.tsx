'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { History, Download, RefreshCw, FileText, CheckCircle2, Clock, Ban, Loader2, ArrowRight, Edit, MessageSquare, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { breakdownPacks, formatCaseQuantity } from '@/lib/conversion';
import CustomerKpiDashboard from '@/components/CustomerKpiDashboard';
import { useTranslation } from '@/i18n/context';
import { PeriodPreset } from '@/lib/date-utils';
import OrderPeriodFilter from '@/components/OrderPeriodFilter';
import DeleteDraftModal from '@/components/DeleteDraftModal';


interface CommentItem {
  id: string;
  orderId: string;
  userId: string | null;
  userName: string;
  text: string;
  createdAt: string;
}

interface OrderItemSku {
  id: string;
  orderItemId: string;
  productId: string;
  packs: number;
  sku: string;
  name: string;
  product?: {
    priority: number;
  } | null;
}

interface OrderItem {
  id: string;
  productId: string;
  groupId?: string | null;
  baseQuantityPacks?: number;
  bonusQuantityPacks?: number;
  totalQuantityPacks?: number;
  baseQuantityBlocks?: number;
  bonusQuantityBlocks?: number;
  totalQuantityBlocks?: number;
  quantityPacks: number;
  quantityBlocks: number;
  quantityCases: number;
  price: number;
  effectivePrice?: number;
  itemTotalPrice?: number;
  isBonus?: boolean;
  promotionNote?: string | null;
  productNameSnapshot: string | null;
  skuSnapshot: string | null;
  product: {
    sku: string;
    name: string;
  } | null;
  skuAllocations?: OrderItemSku[];
}

interface Order {
  id: string;
  orderNumber: string;
  status: 'DRAFT' | 'NEW' | 'ACCEPTED' | 'ASSEMBLY' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED';
  totalPacks: number;
  totalBlocks: number;
  totalCases: number;
  totalPrice: number;
  fileUrl: string | null;
  fileId: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  comments?: CommentItem[];
}

function CustomerOrdersContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, language } = useTranslation();
  const filterMonth = searchParams.get('month'); // e.g. "2026-06" or "2026-06-15"
  const locale = language === 'uz' ? 'uz-UZ' : language === 'en' ? 'en-US' : 'ru-RU';

  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>(() => {
    if (filterMonth) return 'CUSTOM';
    return 'ALL';
  });
  const [appliedStartDate, setAppliedStartDate] = useState<string>(() => {
    if (filterMonth && /^\d{4}-\d{2}-\d{2}$/.test(filterMonth)) return filterMonth;
    if (filterMonth && /^\d{4}-\d{2}$/.test(filterMonth)) return `${filterMonth}-01`;
    return '';
  });
  const [appliedEndDate, setAppliedEndDate] = useState<string>(() => {
    if (filterMonth && /^\d{4}-\d{2}-\d{2}$/.test(filterMonth)) return filterMonth;
    if (filterMonth && /^\d{4}-\d{2}$/.test(filterMonth)) {
      const [y, m] = filterMonth.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      return `${filterMonth}-${String(lastDay).padStart(2, '0')}`;
    }
    return '';
  });
  const [deletingDraftOrder, setDeletingDraftOrder] = useState<Order | null>(null);
  const [isDeletingDraft, setIsDeletingDraft] = useState(false);

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalOrders, setTotalOrders] = useState(0);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());

  const toggleOrderExpand = (orderId: string) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const [repetitionLoading, setRepetitionLoading] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [commentSending, setCommentSending] = useState<Record<string, boolean>>({});
  const [commentStatus, setCommentStatus] = useState<Record<string, 'success' | 'error'>>({});

  const handleSendComment = async (orderId: string) => {
    const text = (commentDrafts[orderId] || '').trim();
    if (!text || commentSending[orderId]) return;

    setCommentSending((prev) => ({ ...prev, [orderId]: true }));
    setCommentStatus((prev) => {
      const next = { ...prev };
      delete next[orderId];
      return next;
    });

    try {
      const res = await fetch('/api/orders/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, text })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.comment) {
          setOrders((prev) =>
            prev.map((o) => {
              if (o.id === orderId) {
                return {
                  ...o,
                  comments: [...(o.comments || []), data.comment]
                };
              }
              return o;
            })
          );
          setCommentDrafts((prev) => ({ ...prev, [orderId]: '' }));
          setCommentStatus((prev) => ({ ...prev, [orderId]: 'success' }));
        } else {
          setCommentStatus((prev) => ({ ...prev, [orderId]: 'error' }));
        }
      } else {
        setCommentStatus((prev) => ({ ...prev, [orderId]: 'error' }));
      }
    } catch (err) {
      console.error('Failed to post comment', err);
      setCommentStatus((prev) => ({ ...prev, [orderId]: 'error' }));
    } finally {
      setCommentSending((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    }
  };

  const handleDeleteDraft = async () => {
    if (!deletingDraftOrder) return;
    setIsDeletingDraft(true);
    try {
      const res = await fetch(`/api/orders?id=${deletingDraftOrder.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || t('orders.deleteDraftError'));
      }
      setOrders((prev) => prev.filter((o) => o.id !== deletingDraftOrder.id));
      setTotalOrders((prev) => Math.max(0, prev - 1));
      setDeletingDraftOrder(null);
    } catch (err: any) {
      console.error('Delete draft error', err);
      alert(err.message || t('orders.deleteDraftError'));
    } finally {
      setIsDeletingDraft(false);
    }
  };

  const loadOrders = async (targetPage: number = 1, append: boolean = false, overrideStart?: string, overrideEnd?: string) => {
    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      const params = new URLSearchParams();
      params.set('page', String(targetPage));
      params.set('pageSize', '25');

      const sDate = overrideStart !== undefined ? overrideStart : appliedStartDate;
      const eDate = overrideEnd !== undefined ? overrideEnd : appliedEndDate;

      if (sDate) params.set('startDate', sDate);
      if (eDate) params.set('endDate', eDate);

      const res = await fetch(`/api/orders?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const incomingOrders: Order[] = Array.isArray(data) ? data : (data.orders || []);
        const pagination = data.pagination;

        if (append) {
          setOrders((prev) => {
            const existingIds = new Set(prev.map((o) => o.id));
            const uniqueIncoming = incomingOrders.filter((o) => !existingIds.has(o.id));
            return [...prev, ...uniqueIncoming];
          });
        } else {
          setOrders(incomingOrders);
          setExpandedOrders(new Set());
        }

        setPage(targetPage);

        if (pagination) {
          setTotalOrders(pagination.total);
          setHasMore(targetPage < pagination.totalPages);
        } else {
          setTotalOrders(incomingOrders.length);
          setHasMore(false);
        }
      } else if (res.status === 401) {
        const data = await res.json().catch(() => ({}));
        if (data.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
          window.location.href = '/login?reason=session_expired';
        }
      }
    } catch (err) {
      console.error('Failed to load orders history', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    loadOrders(1, false);
  }, []);

  const handleLoadMore = () => {
    if (loadingMore || !hasMore) return;
    loadOrders(page + 1, true);
  };

  const filteredOrders = orders;

  // Repeat Previous Order: loads concrete SKU items into localStorage and sends them to catalog
  const handleRepeatOrder = (order: Order) => {
    setRepetitionLoading(order.id);

    try {
      const cartPreload: { [productId: string]: number } = {};

      order.items.forEach((item) => {
        // 1. Exclude 100% bonus line items awarded by promotions
        if (item.isBonus) return;

        // 2. Extract base non-bonus packs
        const itemBasePacks = item.baseQuantityPacks !== undefined && item.baseQuantityPacks > 0
          ? item.baseQuantityPacks
          : Math.max(0, (item.quantityPacks || item.totalQuantityPacks || 0) - (item.bonusQuantityPacks || 0));

        if (itemBasePacks <= 0) return;

        // 3. If item has concrete per-SKU allocation snapshots, restore each SKU's exact base quantity
        if (item.skuAllocations && item.skuAllocations.length > 0) {
          // Sort allocations strictly in allocator priority order (lower priority number consumed first)
          const sortedAllocs = [...item.skuAllocations].sort((a, b) => {
            const prioA = a.product?.priority ?? 0;
            const prioB = b.product?.priority ?? 0;
            if (prioA !== prioB) return prioA - prioB;
            return a.id.localeCompare(b.id);
          });

          // OrderItemSku.packs contains total allocated packs (including promotional bonuses).
          // Since ProductGroupService.allocatePacks fills SKUs sequentially by priority, the base
          // ordered packs were consumed by the first SKUs, and bonus packs were appended to the tail.
          // Sequential deduction restores the exact base packs per SKU without any proportional distortion.
          let remainingBase = itemBasePacks;
          for (const alloc of sortedAllocs) {
            if (remainingBase <= 0) break;
            if (!alloc.productId || alloc.packs <= 0) continue;

            const skuBasePacks = Math.min(alloc.packs, remainingBase);
            if (skuBasePacks > 0) {
              cartPreload[alloc.productId] = (cartPreload[alloc.productId] || 0) + skuBasePacks;
              remainingBase -= skuBasePacks;
            }
          }
        } else if (item.productId) {
          // 4. Standalone SKU or order without allocation snapshots: use exact Product.id
          cartPreload[item.productId] = (cartPreload[item.productId] || 0) + itemBasePacks;
        }
      });

      // Write parameters to local storage for main catalog retrieval
      localStorage.setItem('b2b_cart_preload', JSON.stringify(cartPreload));

      // Delay slightly for nice UX feel
      setTimeout(() => {
        router.push('/customer');
      }, 600);
    } catch (err) {
      console.error('Repeat order failed', err);
      setRepetitionLoading(null);
    }
  };

  // Helper to render nice status badges
  const renderStatusBadge = (status: Order['status']) => {
    switch (status) {
      case 'DRAFT':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 border border-slate-700 px-2.5 py-1 text-xs font-bold text-slate-300">
            <FileText className="h-3.5 w-3.5" />
            <span>{t('orders.statusDraft')}</span>
          </span>
        );
      case 'NEW':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 text-xs font-bold text-indigo-400 glow-text-primary">
            <Clock className="h-3.5 w-3.5 animate-pulse-slow" />
            <span>{t('orders.statusNew')}</span>
          </span>
        );
      case 'ACCEPTED':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 text-xs font-bold text-blue-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{t('orders.statusAccepted')}</span>
          </span>
        );
      case 'ASSEMBLY':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 text-xs font-bold text-amber-400">
            <Clock className="h-3.5 w-3.5 animate-pulse-slow" />
            <span>{t('orders.statusProcessing')}</span>
          </span>
        );
      case 'SHIPPED':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 text-xs font-bold text-cyan-400">
            <Clock className="h-3.5 w-3.5 animate-pulse-slow" />
            <span>{t('orders.statusShipped')}</span>
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-400 glow-text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{t('orders.statusDelivered')}</span>
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 border border-red-500/20 px-2.5 py-1 text-xs font-bold text-red-400">
            <Ban className="h-3.5 w-3.5" />
            <span>{t('orders.statusCancelled')}</span>
          </span>
        );
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
    <div className="space-y-6 animate-fade-in">
      {/* ── CUSTOMER KPI DASHBOARD ── */}
      <CustomerKpiDashboard orders={orders} totalOrdersCount={totalOrders} />

      <div className="flex items-center gap-3 justify-between pt-2">
        <div className="flex items-center gap-3">
          <History className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-bold text-slate-100">
            {t('orders.historyTitle')}
          </h2>
        </div>
      </div>

      <OrderPeriodFilter
        startDate={appliedStartDate}
        endDate={appliedEndDate}
        activePreset={periodPreset}
        onSelectPreset={(preset, start, end) => {
          setPeriodPreset(preset);
          if (preset === 'CUSTOM') {
            if (start || end) {
              setAppliedStartDate(start);
              setAppliedEndDate(end);
              setPage(1);
              setExpandedOrders(new Set());
              loadOrders(1, false, start, end);
            }
            return;
          }
          setAppliedStartDate(start);
          setAppliedEndDate(end);
          setPage(1);
          setExpandedOrders(new Set());
          loadOrders(1, false, start, end);
        }}
        onApplyCustom={(start, end) => {
          setPeriodPreset('CUSTOM');
          setAppliedStartDate(start);
          setAppliedEndDate(end);
          setPage(1);
          setExpandedOrders(new Set());
          loadOrders(1, false, start, end);
        }}
        onReset={() => {
          setPeriodPreset('ALL');
          setAppliedStartDate('');
          setAppliedEndDate('');
          setPage(1);
          setExpandedOrders(new Set());
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('month');
          window.history.pushState({}, '', cleanUrl.toString());
          loadOrders(1, false, '', '');
        }}
      />

      {filteredOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center glass-panel rounded-2xl">
          <History className="h-10 w-10 text-slate-500 mb-4" />
          <h3 className="text-lg font-bold text-slate-300">{t('orders.emptyOrders')}</h3>
          <button
            onClick={() => router.push('/customer')}
            className="btn-primary mt-6 px-5 py-2.5 text-xs flex items-center gap-2"
          >
            <span>{t('navigation.catalog')}</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (

        <div className="space-y-4">
          {filteredOrders.map((order) => {
            const date = new Date(order.createdAt).toLocaleString(locale, {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });

            const isExpanded = expandedOrders.has(order.id);

            let totalOrderPacks = order.totalPacks || 0;
            const uniqueSkus = new Set<string>();

            order.items?.forEach((item) => {
              const packs = item.quantityPacks || 0;
              if (!order.totalPacks) totalOrderPacks += packs;

              if (item.skuAllocations && item.skuAllocations.length > 0) {
                item.skuAllocations.forEach((a: any) => {
                  if (a.sku) uniqueSkus.add(a.sku);
                });
              } else if (item.skuSnapshot || item.product?.sku) {
                uniqueSkus.add(item.skuSnapshot || item.product?.sku || '');
              }
            });
            const uniqueSkuCount = uniqueSkus.size;

            return (
              <div key={order.id} className="glass-panel rounded-2xl border border-white/5 hover:border-white/10 transition-all overflow-hidden">
                {/* Collapsible Header */}
                <div
                  onClick={() => toggleOrderExpand(order.id)}
                  className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer select-none hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-sm sm:text-base text-slate-200">{order.orderNumber}</span>
                      {renderStatusBadge(order.status)}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 font-semibold text-[11px]">
                        {formatCaseQuantity(totalOrderPacks)} {t('units.casesShort')}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-purple-500/10 border border-purple-500/20 text-purple-300 font-semibold text-[11px]">
                        {uniqueSkuCount} SKU
                      </span>
                    </div>

                    <span className="font-extrabold text-sm sm:text-base text-emerald-400">
                      {order.totalPrice.toLocaleString(locale)} so'm
                    </span>

                    <span className="text-[11px] text-slate-400">
                      {date}
                    </span>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleOrderExpand(order.id);
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                      title={isExpanded ? 'Свернуть' : 'Развернуть'}
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="border-t border-white/5 p-5 sm:p-6 pt-4 flex flex-col gap-4 animate-fade-in">

                {/* Items Breakdown list */}
                <div className="py-2">
                  <span className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">{t('orders.items')}:</span>
                  <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {order.items.map((item) => {
                      const baseBlocks = item.baseQuantityBlocks ?? Math.floor((item.baseQuantityPacks ?? item.quantityPacks) / 10);
                      const bonusBlocks = item.bonusQuantityBlocks ?? Math.floor((item.bonusQuantityPacks ?? 0) / 10);
                      const totalBlocks = item.totalQuantityBlocks ?? item.quantityBlocks ?? Math.floor(item.quantityPacks / 10);
                      const name = item.productNameSnapshot || item.product?.name || 'Item';
                      const sku = item.skuSnapshot || item.product?.sku || 'SKU';

                      const quantityLabel = bonusBlocks > 0
                        ? `${totalBlocks} ${t('units.blocksShort')} (${baseBlocks} + ${bonusBlocks} ${t('orders.bonusItem')})`
                        : breakdownPacks(item.quantityPacks, {
                            cases: t('units.casesShort'),
                            blocks: t('units.blocksShort')
                          }).label;

                      return (
                        <div key={item.id} className="bg-slate-950/30 border border-white/5 rounded-xl p-3 flex justify-between items-center text-xs">
                          <div>
                            <span className="block font-bold text-slate-300 line-clamp-1">{name}</span>
                            <span className="block text-[9px] text-slate-500 font-semibold mt-0.5">
                              {sku} {item.promotionNote ? `· ${item.promotionNote}` : ''}
                            </span>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span className="font-extrabold text-primary-focus">{quantityLabel}</span>
                            <span className="block text-[9px] text-slate-500 font-semibold mt-0.5">
                              {(item.effectivePrice || item.price).toLocaleString()} so'm
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Comments Section */}
                <div className="mt-2 pt-4 border-t border-white/5 space-y-3">
                  <h4 className="text-[10px] font-bold text-slate-450 uppercase tracking-wider flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5 text-indigo-400" />
                    <span>{t('orders.comment')}</span>
                  </h4>

                  {order.comments && order.comments.length > 0 ? (
                    <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                      {order.comments.map((comment) => {
                        const commentDate = new Date(comment.createdAt).toLocaleString(locale, {
                          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                        });
                        return (
                          <div key={comment.id} className="bg-slate-950/40 border border-white/5 rounded-xl p-3 text-[11px] leading-relaxed">
                            <div className="flex justify-between items-center text-slate-400 font-bold mb-1 text-[10px]">
                              <span>{comment.userName}</span>
                              <span>{commentDate}</span>
                            </div>
                            <p className="text-slate-200">{comment.text}</p>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {/* Add comment input */}
                  <div className="flex gap-2 pt-1">
                    <input
                      type="text"
                      value={commentDrafts[order.id] || ''}
                      onChange={(e) => {
                        setCommentDrafts((prev) => ({ ...prev, [order.id]: e.target.value }));
                        if (commentStatus[order.id]) {
                          setCommentStatus((prev) => {
                            const next = { ...prev };
                            delete next[order.id];
                            return next;
                          });
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSendComment(order.id);
                        }
                      }}
                      placeholder={t('orders.commentPlaceholder')}
                      disabled={Boolean(commentSending[order.id])}
                      className="flex-1 rounded-xl px-3 py-2 text-xs glass-input border border-white/10 bg-slate-900/60 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => handleSendComment(order.id)}
                      disabled={
                        Boolean(commentSending[order.id]) ||
                        !(commentDrafts[order.id]?.trim())
                      }
                      className="btn-primary px-3.5 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                    >
                      {commentSending[order.id] ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <span>{t('orders.sendComment')}</span>
                      )}
                    </button>
                  </div>

                  {/* Comment status notification */}
                  {commentStatus[order.id] === 'success' && (
                    <span className="block text-[11px] text-emerald-400 font-medium px-1">
                      {t('orders.commentAdded')}
                    </span>
                  )}
                  {commentStatus[order.id] === 'error' && (
                    <span className="block text-[11px] text-rose-400 font-medium px-1">
                      {t('orders.commentAddError')}
                    </span>
                  )}
                </div>

                {/* Bottom Actions panel */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-4 border-t border-white/5 w-full">
                  <div className="text-xs text-slate-400 font-semibold">
                    {t('common.total')}: <span className="text-slate-200 font-bold">{formatCaseQuantity(totalOrderPacks)} {t('units.cases')}</span>
                  </div>

                  <div className="flex gap-2.5 w-full sm:w-auto">
                    {order.status !== 'DRAFT' && (
                      <a
                        href={`/api/orders/download?id=${order.id}`}
                        download
                        className="flex-1 sm:flex-initial btn-secondary flex items-center justify-center gap-2 px-4 py-2.5 text-xs text-slate-300"
                        title={t('orders.downloadExcel')}
                      >
                        <Download className="h-4 w-4" />
                        <span>{t('orders.downloadExcel')}</span>
                      </a>
                    )}

                    {order.status === 'DRAFT' ? (
                      <div className="flex items-center gap-2 flex-1 sm:flex-initial">
                        <button
                          onClick={() => router.push(`/customer?editDraftId=${order.id}`)}
                          className="flex-1 sm:flex-initial bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl flex items-center justify-center gap-2 px-4 py-2.5 text-xs transition-all"
                        >
                          <Edit className="h-4 w-4" />
                          <span>{t('orders.draft')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingDraftOrder(order)}
                          className="p-2.5 rounded-xl text-rose-400 hover:text-white hover:bg-rose-500/20 border border-rose-500/20 transition-all flex items-center justify-center"
                          title={t('orders.deleteDraft')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleRepeatOrder(order)}
                        disabled={repetitionLoading === order.id}
                        className="flex-1 sm:flex-initial btn-primary flex items-center justify-center gap-2 px-4 py-2.5 text-xs"
                      >
                        {repetitionLoading === order.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        <span>{t('orders.newOrder')}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
          })}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center pt-6 pb-2">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="btn-secondary px-6 py-3 text-xs font-semibold flex items-center gap-2 rounded-xl transition-all"
          >
            {loadingMore ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                <span>{t('common.loading')}</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 text-cyan-400" />
                <span>{t('common.loadMore')}</span>
                <span className="text-[10px] text-slate-500 font-normal">({orders.length} / {totalOrders})</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Delete Draft Confirmation Modal */}
      <DeleteDraftModal
        isOpen={!!deletingDraftOrder}
        orderNumber={deletingDraftOrder?.orderNumber}
        isDeleting={isDeletingDraft}
        onConfirm={handleDeleteDraft}
        onCancel={() => setDeletingDraftOrder(null)}
      />
    </div>
  );
}

function OrdersFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex h-64 w-full flex-col items-center justify-center text-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="mt-4 text-xs font-semibold text-slate-400">{t('orders.loadingHistory')}</p>
    </div>
  );
}

export default function CustomerOrders() {
  return (
    <Suspense fallback={<OrdersFallback />}>
      <CustomerOrdersContent />
    </Suspense>
  );
}
