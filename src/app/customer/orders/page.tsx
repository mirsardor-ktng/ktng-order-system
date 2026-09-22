'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { History, Download, RefreshCw, FileText, CheckCircle2, Clock, Ban, Loader2, ArrowRight, Edit, MessageSquare } from 'lucide-react';
import { breakdownPacks } from '@/lib/conversion';
import CustomerKpiDashboard from '@/components/CustomerKpiDashboard';
import { useTranslation } from '@/i18n/context';


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
  status: 'DRAFT' | 'NEW' | 'ASSEMBLY' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED';
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
  const filterMonth = searchParams.get('month'); // e.g. "2026-06"
  const locale = language === 'uz' ? 'uz-UZ' : language === 'en' ? 'en-US' : 'ru-RU';

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

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

  const loadOrders = async () => {
    try {
      const res = await fetch('/api/orders');
      if (res.ok) {
        const data = await res.json();
        setOrders(data);
      }
    } catch (err) {
      console.error('Failed to load orders history', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  // Filter orders by month if query param is set
  const filteredOrders = filterMonth
    ? orders.filter(o => {
        const oDate = new Date(o.createdAt);
        const monthKey = `${oDate.getFullYear()}-${String(oDate.getMonth() + 1).padStart(2, '0')}`;
        return monthKey === filterMonth;
      })
    : orders;

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
      <CustomerKpiDashboard orders={orders} />

      <div className="flex items-center gap-3 justify-between pt-2">
        <div className="flex items-center gap-3">
          <History className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-bold text-slate-100">
            {t('orders.historyTitle')}
          </h2>
        </div>
        {filterMonth && (
          <button
            onClick={() => {
              const cleanUrl = new URL(window.location.href);
              cleanUrl.searchParams.delete('month');
              window.history.pushState({}, '', cleanUrl.toString());
              loadOrders();
              router.replace('/customer/orders');
            }}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-bold"
          >
            {t('common.all')}
          </button>
        )}
      </div>

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

            return (
              <div key={order.id} className="glass-panel rounded-2xl p-5 sm:p-6 flex flex-col justify-between gap-4 border border-white/5">
                {/* Order Header info */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-4 border-b border-white/5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-extrabold text-sm sm:text-base text-slate-200">{order.orderNumber}</span>
                      {renderStatusBadge(order.status)}
                    </div>
                    <span className="block text-[10px] text-slate-400 mt-1 font-semibold">{t('orders.orderDate')}: {date}</span>
                  </div>

                  <div className="text-left sm:text-right">
                    <span className="block text-[9px] text-slate-500 font-bold uppercase tracking-wider">{t('orders.totalSum')}:</span>
                    <span className="block font-extrabold text-base text-emerald-400 leading-none mt-1">{order.totalPrice.toLocaleString()} so'm</span>
                  </div>
                </div>

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
                    {t('common.total')}: <span className="text-slate-200 font-bold">{order.totalBlocks} {t('units.blocksShort')}</span> / <span className="text-slate-200 font-bold">{order.totalCases} {t('units.casesShort')}</span>
                  </div>

                  <div className="flex gap-2.5 w-full sm:w-auto">
                    {(order.fileUrl || order.fileId) && (
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
                      <button
                        onClick={() => router.push(`/customer?editDraftId=${order.id}`)}
                        className="flex-1 sm:flex-initial bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl flex items-center justify-center gap-2 px-4 py-2.5 text-xs transition-all"
                      >
                        <Edit className="h-4 w-4" />
                        <span>{t('orders.draft')}</span>
                      </button>
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
            );
          })}
        </div>
      )}
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
