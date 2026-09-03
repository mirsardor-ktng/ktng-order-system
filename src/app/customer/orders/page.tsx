'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { History, Download, RefreshCw, FileText, CheckCircle2, Clock, Ban, Loader2, ArrowRight, Edit, MessageSquare } from 'lucide-react';
import { breakdownPacks } from '@/lib/conversion';
import CustomerKpiDashboard from '@/components/CustomerKpiDashboard';

interface CommentItem {
  id: string;
  orderId: string;
  userId: string | null;
  userName: string;
  text: string;
  createdAt: string;
}

interface OrderItem {
  id: string;
  productId: string;
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
  const filterMonth = searchParams.get('month'); // e.g. "2026-06"

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [repetitionLoading, setRepetitionLoading] = useState<string | null>(null);

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

  // Repeat Previous Order: loads item ratios into localStorage and sends them to catalog
  const handleRepeatOrder = (order: Order) => {
    setRepetitionLoading(order.id);
    
    try {
      const cartPreload: { [productId: string]: number } = {};
      order.items.forEach((item) => {
        cartPreload[item.productId] = item.quantityPacks;
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
            <span>Черновик</span>
          </span>
        );
      case 'NEW':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 text-xs font-bold text-indigo-400 glow-text-primary">
            <Clock className="h-3.5 w-3.5 animate-pulse-slow" />
            <span>Новый заказ</span>
          </span>
        );
      case 'ASSEMBLY':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 text-xs font-bold text-amber-400">
            <Clock className="h-3.5 w-3.5 animate-pulse-slow" />
            <span>Сборка</span>
          </span>
        );
      case 'SHIPPED':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 text-xs font-bold text-cyan-400">
            <Clock className="h-3.5 w-3.5 animate-pulse-slow" />
            <span>Отгрузка</span>
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-400 glow-text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Завершен</span>
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 border border-red-500/20 px-2.5 py-1 text-xs font-bold text-red-400">
            <Ban className="h-3.5 w-3.5" />
            <span>Отменен</span>
          </span>
        );
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 w-full flex-col items-center justify-center text-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-xs font-semibold text-slate-400">Синхронизируем историю закупок...</p>
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
            {filterMonth ? `Мои закупки за ${filterMonth}` : 'Мои закупки и заказы'}
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
            Показать все
          </button>
        )}
      </div>

      {filteredOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center glass-panel rounded-2xl">
          <History className="h-10 w-10 text-slate-500 mb-4" />
          <h3 className="text-lg font-bold text-slate-300">Заказы не найдены</h3>
          <p className="text-xs text-slate-400 mt-2 max-w-sm">
            {filterMonth 
              ? `В месяце ${filterMonth} вы не оформляли заказов.` 
              : 'Вы еще не оформляли заказов сигаретной продукции. Перейдите на витрину товаров, чтобы собрать вашу первую закупку.'}
          </p>
          <button 
            onClick={() => router.push('/customer')}
            className="btn-primary mt-6 px-5 py-2.5 text-xs flex items-center gap-2"
          >
            <span>Перейти к витрине</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((order) => {
            const date = new Date(order.createdAt).toLocaleString('ru-RU', {
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
                    <span className="block text-[10px] text-slate-400 mt-1 font-semibold">Дата: {date}</span>
                  </div>

                  <div className="text-left sm:text-right">
                    <span className="block text-[9px] text-slate-500 font-bold uppercase tracking-wider">Общая сумма:</span>
                    <span className="block font-extrabold text-base text-emerald-400 leading-none mt-1">{order.totalPrice.toLocaleString()} so'm</span>
                  </div>
                </div>

                {/* Items Breakdown list */}
                <div className="py-2">
                  <span className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Заказанные позиции:</span>
                  <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {order.items.map((item) => {
                      const baseBlocks = item.baseQuantityBlocks ?? Math.floor((item.baseQuantityPacks ?? item.quantityPacks) / 10);
                      const bonusBlocks = item.bonusQuantityBlocks ?? Math.floor((item.bonusQuantityPacks ?? 0) / 10);
                      const totalBlocks = item.totalQuantityBlocks ?? item.quantityBlocks ?? Math.floor(item.quantityPacks / 10);
                      const name = item.productNameSnapshot || item.product?.name || 'Неизвестно';
                      const sku = item.skuSnapshot || item.product?.sku || 'Неизвестно';
                      
                      const quantityLabel = bonusBlocks > 0 
                        ? `${totalBlocks} бл. (${baseBlocks} оплат. + ${bonusBlocks} бонус)` 
                        : breakdownPacks(item.quantityPacks).label;

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
                              {(item.effectivePrice || item.price).toLocaleString()} so'm/пач.
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
                    <span>Комментарии</span>
                  </h4>
                  
                  {order.comments && order.comments.length > 0 ? (
                    <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                      {order.comments.map((comment) => {
                        const commentDate = new Date(comment.createdAt).toLocaleString('ru-RU', {
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
                  ) : (
                    <p className="text-[10px] text-slate-500 italic px-1">Комментариев к заказу пока нет.</p>
                  )}

                  <div className="flex gap-2">
                    <input 
                      type="text"
                      placeholder="Напишите комментарий..."
                      id={`comment-input-${order.id}`}
                      className="flex-1 rounded-xl px-3 py-2 text-xs glass-input"
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          const inputEl = document.getElementById(`comment-input-${order.id}`) as HTMLInputElement;
                          const text = inputEl.value.trim();
                          if (!text) return;
                          try {
                            const res = await fetch('/api/orders/comments', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ orderId: order.id, text })
                            });
                            if (res.ok) {
                              inputEl.value = '';
                              loadOrders();
                            }
                          } catch (err) {
                            console.error('Failed to post comment', err);
                          }
                        }
                      }}
                    />
                    <button
                      onClick={async () => {
                        const inputEl = document.getElementById(`comment-input-${order.id}`) as HTMLInputElement;
                        const text = inputEl.value.trim();
                        if (!text) return;
                        try {
                          const res = await fetch('/api/orders/comments', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ orderId: order.id, text })
                          });
                          if (res.ok) {
                            inputEl.value = '';
                            loadOrders();
                          }
                        } catch (err) {
                          console.error('Failed to post comment', err);
                        }
                      }}
                      className="btn-primary px-4 py-2 text-xs flex items-center justify-center"
                    >
                      Отправить
                    </button>
                  </div>
                </div>

                {/* Bottom Actions panel */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-4 border-t border-white/5 w-full">
                  <div className="text-xs text-slate-400 font-semibold">
                    Итого: <span className="text-slate-200 font-bold">{order.totalBlocks} бл.</span> и <span className="text-slate-200 font-bold">{order.totalCases} кор.</span>
                  </div>

                  <div className="flex gap-2.5 w-full sm:w-auto">
                    {(order.fileUrl || order.fileId) && (
                      <a
                        href={`/api/orders/download?id=${order.id}`}
                        download
                        className="flex-1 sm:flex-initial btn-secondary flex items-center justify-center gap-2 px-4 py-2.5 text-xs text-slate-300"
                        title="Скачать накладную Excel"
                      >
                        <Download className="h-4 w-4" />
                        <span>Накладная Excel</span>
                      </a>
                    )}
                    
                    {order.status === 'DRAFT' ? (
                      <button
                        onClick={() => router.push(`/customer?editDraftId=${order.id}`)}
                        className="flex-1 sm:flex-initial bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl flex items-center justify-center gap-2 px-4 py-2.5 text-xs transition-all"
                      >
                        <Edit className="h-4 w-4" />
                        <span>Редактировать черновик</span>
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
                        <span>Повторить закупку</span>
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

export default function CustomerOrders() {
  return (
    <Suspense fallback={
      <div className="flex h-64 w-full flex-col items-center justify-center text-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-xs font-semibold text-slate-400">Загрузка истории...</p>
      </div>
    }>
      <CustomerOrdersContent />
    </Suspense>
  );
}
