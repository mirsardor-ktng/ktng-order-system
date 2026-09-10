'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Star, Layers, Package, Grid, Plus, Minus, FileText, Check, AlertCircle, ShoppingCart, Loader2 } from 'lucide-react';
import confetti from 'canvas-confetti';
import { UnitMode, packsToUnit, unitToPacks, breakdownPacks } from '@/lib/conversion';
import CustomerKpiDashboard from '@/components/CustomerKpiDashboard';

interface TagItem {
  id: string;
  name: string;
  color: string;
}

interface SkuItem {
  id: string;
  sku: string;
  name: string;
  stockPacks: number;
  priority: number;
  isActive: boolean;
  basePrice: number;
  imageUrl?: string;
  tags?: TagItem[];
}

interface Product {
  id: string;
  sku: string;
  name: string;
  displayName?: string;
  imageUrl: string;
  basePrice: number;
  isActive: boolean;
  isFavorite: boolean;
  stockPacks: number;
  tags?: TagItem[];
  groupId?: string | null;
  isGroup?: boolean;
  skus?: SkuItem[];
}

/**
 * Calculates total packs in cart belonging to a product group or standalone product.
 * Ensures each SKU or product ID is counted exactly once (no duplicate counting).
 */
function getProductCartPacks(prod: Product, cartState: { [productId: string]: number }): number {
  let total = 0;
  const counted = new Set<string>();

  if (prod.skus && prod.skus.length > 0) {
    for (const s of prod.skus) {
      if (s.id && !counted.has(s.id)) {
        counted.add(s.id);
        total += (cartState[s.id] || 0);
      }
    }
  }

  // Only check prod.id for standalone products (not groups) if not already accounted for
  if (!prod.isGroup && prod.id && !counted.has(prod.id)) {
    total += cartState[prod.id] || 0;
  }

  return total;
}

/**
 * Allocates total target packs across active SKUs in priority order (matching ProductGroupService.allocatePacks).
 * Prevents collapsing into groupId and avoids arbitrary single-SKU selection.
 */
function setGroupPacksInCart(
  prod: Product,
  targetPacks: number,
  prevCart: { [productId: string]: number }
): { [productId: string]: number } {
  const nextCart = { ...prevCart };

  // Remove any legacy group ID key if this is a group
  if (prod.isGroup) {
    delete nextCart[prod.id];
  }

  const skus = prod.skus && prod.skus.length > 0
    ? [...prod.skus].filter(s => s.isActive).sort((a, b) => a.priority - b.priority)
    : [];

  if (skus.length === 0) {
    if (!prod.isGroup) {
      if (targetPacks > 0) {
        nextCart[prod.id] = targetPacks;
      } else {
        delete nextCart[prod.id];
      }
    }
    return nextCart;
  }

  let remaining = Math.max(0, targetPacks);
  for (const sku of skus) {
    if (remaining <= 0) {
      delete nextCart[sku.id];
      continue;
    }
    const alloc = Math.min(remaining, sku.stockPacks);
    if (alloc > 0) {
      nextCart[sku.id] = alloc;
      remaining -= alloc;
    } else {
      delete nextCart[sku.id];
    }
  }

  return nextCart;
}

export default function CustomerCatalog() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // Catalog Search & Favorites Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([]);

  // B2B Unit Selection Mode: PACKS (Пачки), BLOCKS (Блоки), CASES (Коробки)
  const [unitMode, setUnitMode] = useState<UnitMode>('BLOCKS');

  // Cart Quantities: Maps [productId] -> quantity in packs (always multiples of 10)
  const [cart, setCart] = useState<{ [productId: string]: number }>({});

  // Real-time Promotion Engine Calculated Order state
  const [calculatedOrder, setCalculatedOrder] = useState<any | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [saveDrafting, setSaveDrafting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Active Draft editing states
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [activeDraftNumber, setActiveDraftNumber] = useState<string | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);

  // Request sequence counter for stale response protection
  const calculateSeqRef = useRef<number>(0);

  // Real-time calculation effect via Promotion Engine API (Debounced 350ms + AbortController)
  useEffect(() => {
    const items = Object.keys(cart)
      .filter(pId => (cart[pId] || 0) > 0)
      .map(pId => {
        const prod = products.find(p => p.id === pId || p.skus?.some(s => s.id === pId));
        return {
          groupId: prod?.groupId || (prod?.isGroup ? prod.id : undefined),
          productId: pId,
          baseQuantityPacks: cart[pId]
        };
      });

    if (items.length === 0) {
      setCalculatedOrder(null);
      return;
    }

    const currentSeq = ++calculateSeqRef.current;
    const controller = new AbortController();

    const timeoutId = setTimeout(() => {
      fetch('/api/orders/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
        signal: controller.signal
      })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (calculateSeqRef.current === currentSeq && data) {
            setCalculatedOrder(data);
          }
        })
        .catch(err => {
          if (err.name !== 'AbortError') {
            console.error('Failed to calculate promotions:', err);
          }
        });
    }, 350);

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [cart, products]);

  // Fetch product catalog on mount
  useEffect(() => {
    async function loadCatalog() {
      try {
        const res = await fetch('/api/products');
        if (res.ok) {
          const data = await res.json();
          setProducts(data);
          return data;
        }
      } catch (err) {
        console.error('Failed to load catalog', err);
      } finally {
        setLoading(false);
      }
    }

    // Helper function to match a draft or repeated item with loaded catalog items
    function matchCatalogProduct(item: { productId?: string; groupId?: string | null; skuSnapshot?: string; sku?: string }, loadedProducts: Product[]): Product | undefined {
      // 1. Group ID matches catalog item ID (groups use group.id as product.id in catalog)
      if (item.groupId) {
        const byGroupId = loadedProducts.find(p => p.id === item.groupId);
        if (byGroupId) return byGroupId;
      }

      // 2. Direct product ID match (for standalone products)
      if (item.productId) {
        const byDirectId = loadedProducts.find(p => p.id === item.productId);
        if (byDirectId) return byDirectId;

        // 3. Child SKU match inside a product group
        const byChildSku = loadedProducts.find(p => p.skus?.some(s => s.id === item.productId));
        if (byChildSku) return byChildSku;
      }

      // 4. Match by SKU code snapshot
      const skuCode = item.skuSnapshot || item.sku;
      if (skuCode) {
        const byChildSkuCode = loadedProducts.find(p => p.skus?.some(s => s.sku === skuCode));
        if (byChildSkuCode) return byChildSkuCode;

        const bySku = loadedProducts.find(p => p.sku === skuCode);
        if (bySku) return bySku;
      }

      return undefined;
    }

    // Check if there is a saved draft or repeated order to load
    async function checkDraftsAndPreload(loadedProducts: Product[]) {
      try {
        // First check URL query parameters for draft ID to edit
        const params = new URLSearchParams(window.location.search);
        const urlDraftId = params.get('editDraftId') || params.get('draftId');

        if (urlDraftId) {
          setLoadingDraft(true);
          const res = await fetch('/api/orders');
          if (res.ok) {
            const orders = await res.json();
            const draftToEdit = orders.find((o: any) => o.id === urlDraftId && o.status === 'DRAFT');
            if (draftToEdit) {
              const draftCart: { [key: string]: number } = {};
              draftToEdit.items.forEach((item: any) => {
                if (item.isBonus) return;
                const basePacks = item.baseQuantityPacks !== undefined && item.baseQuantityPacks > 0
                  ? item.baseQuantityPacks
                  : Math.max(0, (item.quantityPacks || item.totalQuantityPacks || 0) - (item.bonusQuantityPacks || 0));

                // Key by concrete SKU productId to prevent different SKUs from collapsing into group ID
                let key = item.productId;
                if (key) {
                  const matchedGroup = loadedProducts.find(p => p.id === key && p.isGroup && p.skus && p.skus.length > 0);
                  if (matchedGroup && matchedGroup.skus && matchedGroup.skus.length > 0) {
                    const primary = matchedGroup.skus.find(s => s.isActive) || matchedGroup.skus[0];
                    key = primary.id;
                  }
                } else if (item.groupId) {
                  const matched = matchCatalogProduct(item, loadedProducts);
                  if (matched) {
                    const primary = matched.skus?.find(s => s.isActive) || matched.skus?.[0];
                    key = primary?.id || matched.id;
                  }
                }

                if (key && basePacks > 0) {
                  draftCart[key] = (draftCart[key] || 0) + basePacks;
                }
              });
              setCart(draftCart);
              setActiveDraftId(draftToEdit.id);
              setActiveDraftNumber(draftToEdit.orderNumber);
              setMessage({
                type: 'success',
                text: `Вы вошли в режим редактирования черновика ${draftToEdit.orderNumber}.`
              });
              setLoadingDraft(false);
              return;
            }
          }
          setLoadingDraft(false);
        }

        // If no URL parameter, check localStorage preloads (for repeated orders)
        const preloadStr = localStorage.getItem('b2b_cart_preload');
        if (preloadStr) {
          const preloadedRaw = JSON.parse(preloadStr);
          const normalizedPreloadCart: { [key: string]: number } = {};
          for (const [keyId, qty] of Object.entries(preloadedRaw)) {
            const numQty = Number(qty) || 0;
            if (numQty > 0) {
              const matchedGroup = loadedProducts.find(p => p.id === keyId && p.isGroup && p.skus && p.skus.length > 0);
              const actualKey = (matchedGroup?.skus?.find(s => s.isActive)?.id) || keyId;
              normalizedPreloadCart[actualKey] = (normalizedPreloadCart[actualKey] || 0) + numQty;
            }
          }
          setCart(normalizedPreloadCart);
          localStorage.removeItem('b2b_cart_preload');
          setMessage({ type: 'success', text: 'Заказ успешно загружен для повторного оформления.' });
          return;
        }
      } catch (err) {
        console.error('Preload verification failed', err);
      } finally {
        setLoadingDraft(false);
      }
    }

    loadCatalog().then((data) => {
      if (data) checkDraftsAndPreload(data);
    });
  }, []);

  // Compute all available tags dynamically from products catalog
  const allAvailableTags = useMemo(() => {
    const tagsMap: { [id: string]: TagItem } = {};
    products.forEach(p => {
      if (p.tags) {
        p.tags.forEach(t => {
          tagsMap[t.id] = t;
        });
      }
    });
    return Object.values(tagsMap);
  }, [products]);

  // Filter products based on search term, favorites, and tags
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          p.sku.toLowerCase().includes(searchTerm.toLowerCase());
      const matchFav = !favoritesOnly || p.isFavorite;
      const matchTags = selectedTagFilters.length === 0 ||
                        (p.tags && selectedTagFilters.every(tagId => p.tags!.some(t => t.id === tagId)));
      return matchSearch && matchFav && matchTags;
    });
  }, [products, searchTerm, favoritesOnly, selectedTagFilters]);

  // Order Totals math
  const orderTotals = useMemo(() => {
    let packs = 0;
    let price = 0;

    Object.keys(cart).forEach((pId) => {
      const q = cart[pId] || 0;
      if (q > 0) {
        const prod = products.find(p => p.id === pId || p.skus?.some(s => s.id === pId));
        if (prod) {
          const skuItem = prod.isGroup ? prod.skus?.find(s => s.id === pId) : prod;
          const unitPrice = skuItem?.basePrice ?? prod.basePrice;
          packs += q;
          price += q * unitPrice;
        }
      }
    });

    const blocks = packs / 10;
    const cases = packs / 500;
    const breakdown = breakdownPacks(packs);

    return {
      packs,
      blocks,
      cases: Math.round(cases * 100) / 100,
      price,
      breakdownLabel: breakdown.label
    };
  }, [cart, products]);

  // Memoized O(1) lookup map for calculated promotion order items
  const calculatedItemMap = useMemo(() => {
    const map = new Map<string, any>();
    if (!calculatedOrder?.items || calculatedOrder.items.length === 0) return map;

    for (const item of calculatedOrder.items) {
      if (item.productId && !map.has(item.productId)) {
        map.set(item.productId, item);
      }
      if (item.groupId && !map.has(item.groupId)) {
        map.set(item.groupId, item);
      }
      if (item.skuAllocations && Array.isArray(item.skuAllocations)) {
        for (const alloc of item.skuAllocations) {
          if (alloc.productId && !map.has(alloc.productId)) {
            map.set(alloc.productId, item);
          }
        }
      }
    }
    return map;
  }, [calculatedOrder]);

  // Increments cart item (Stock Capped, Allocates across SKUs in priority order)
  const handleIncrement = (targetId: string) => {
    const prod = products.find(p => p.id === targetId || p.skus?.some(s => s.id === targetId));
    if (!prod) return;

    const currentPacks = getProductCartPacks(prod, cart);
    let increment = 10;

    if (unitMode === 'BLOCKS') {
      increment = 10;
    } else if (unitMode === 'CASES') {
      increment = 500;
    }

    const nextVal = currentPacks + increment;

    if (nextVal > prod.stockPacks) {
      const maxAllowed = Math.floor(prod.stockPacks / 10) * 10;
      if (currentPacks >= maxAllowed) {
        setMessage({ type: 'error', text: `Превышен доступный лимит запаса для позиции: ${prod.name}` });
        return;
      }
      setMessage({ type: 'error', text: `Достигнут лимит запаса для позиции: ${prod.name}` });
      setCart((prev) => setGroupPacksInCart(prod, maxAllowed, prev));
      return;
    }

    setCart((prev) => setGroupPacksInCart(prod, nextVal, prev));
  };

  // Decrements cart item (Deallocates across SKUs in priority order)
  const handleDecrement = (targetId: string) => {
    const prod = products.find(p => p.id === targetId || p.skus?.some(s => s.id === targetId));
    if (!prod) return;

    const currentPacks = getProductCartPacks(prod, cart);
    if (currentPacks <= 0) return;

    let decrement = 10;
    if (unitMode === 'BLOCKS') {
      decrement = 10;
    } else if (unitMode === 'CASES') {
      decrement = 500;
    }

    const nextVal = Math.max(0, currentPacks - decrement);
    setCart((prev) => setGroupPacksInCart(prod, nextVal, prev));
  };

  // Handles raw number input by user (Stock Capped, Allocates across SKUs in priority order)
  const handleInputChange = (targetId: string, rawVal: string) => {
    const prod = products.find(p => p.id === targetId || p.skus?.some(s => s.id === targetId));
    if (!prod) return;

    const val = parseFloat(rawVal) || 0;
    if (val <= 0) {
      setCart((prev) => setGroupPacksInCart(prod, 0, prev));
      return;
    }

    let packs = unitToPacks(val, unitMode);

    if (packs > prod.stockPacks) {
      packs = Math.floor(prod.stockPacks / 10) * 10;
      setMessage({
        type: 'error',
        text: `Запрошенное количество превышает остатки на складе. Установлен доступный максимум.`
      });
    }

    setCart((prev) => setGroupPacksInCart(prod, packs, prev));
  };

  // Submits Draft (Save or Update)
  const handleSaveDraft = async () => {
    setSaveDrafting(true);
    setMessage(null);

    const items = Object.keys(cart)
      .filter(pId => cart[pId] > 0)
      .map(pId => {
        const prod = products.find(p => p.id === pId || p.skus?.some(s => s.id === pId));
        return {
          groupId: prod?.groupId || (prod?.isGroup ? prod.id : undefined),
          productId: pId,
          baseQuantityPacks: cart[pId],
          quantityPacks: cart[pId]
        };
      });

    if (items.length === 0) {
      setMessage({ type: 'error', text: 'Для сохранения черновика добавьте товары в корзину.' });
      setSaveDrafting(false);
      return;
    }

    try {
      const url = '/api/orders';
      const method = activeDraftId ? 'PUT' : 'POST';
      const payload = activeDraftId
        ? { orderId: activeDraftId, items, status: 'DRAFT' }
        : { items, status: 'DRAFT' };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: data.message || 'Черновик сохранён.' });
        if (!activeDraftId && data.order) {
          // If first time save, set to active edit mode
          setActiveDraftId(data.order.id);
          setActiveDraftNumber(data.order.orderNumber);
        }
      } else {
        setMessage({ type: 'error', text: data.error });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Ошибка при сохранении черновика.' });
    } finally {
      setSaveDrafting(false);
    }
  };

  // Submits final Order (Save or Convert Draft)
  const handleSubmitOrder = async () => {
    setSubmitting(true);
    setMessage(null);

    const items = Object.keys(cart)
      .filter(pId => cart[pId] > 0)
      .map(pId => {
        const prod = products.find(p => p.id === pId || p.skus?.some(s => s.id === pId));
        return {
          groupId: prod?.groupId || (prod?.isGroup ? prod.id : undefined),
          productId: pId,
          baseQuantityPacks: cart[pId],
          quantityPacks: cart[pId]
        };
      });

    if (items.length === 0) {
      setMessage({ type: 'error', text: 'Корзина заказа пуста.' });
      setSubmitting(false);
      return;
    }

    try {
      const url = '/api/orders';
      const method = activeDraftId ? 'PUT' : 'POST';
      const payload = activeDraftId
        ? { orderId: activeDraftId, items, status: 'NEW' }
        : { items, status: 'NEW' };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (res.ok) {
        setMessage({ type: 'success', text: data.message });
        setCart({});

        if (activeDraftId) {
          setActiveDraftId(null);
          setActiveDraftNumber(null);
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('editDraftId');
          cleanUrl.searchParams.delete('draftId');
          window.history.pushState({}, '', cleanUrl.toString());
        }

        confetti({
          particleCount: 150,
          spread: 80,
          origin: { y: 0.6 }
        });

        const prodRes = await fetch('/api/products');
        if (prodRes.ok) {
          const freshProds = await prodRes.json();
          setProducts(freshProds);
        }
      } else {
        setMessage({ type: 'error', text: data.error });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Ошибка отправки заказа на сервер.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 w-full flex-col items-center justify-center text-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-xs font-semibold text-slate-400">Формируем витрину сигаретной продукции...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in pb-28">
      {/* ── CUSTOMER KPI DASHBOARD ── */}
      <CustomerKpiDashboard />

      {/* Draft Loading Indicator */}
      {loadingDraft && (
        <div className="rounded-2xl border border-indigo-500/25 bg-indigo-500/10 p-4 text-xs sm:text-sm text-indigo-300 flex items-center gap-3 animate-pulse">
          <Loader2 className="h-5 w-5 animate-spin flex-shrink-0 text-indigo-400" />
          <span>Загружаем сохраненный черновик и восстанавливаем позиции...</span>
        </div>
      )}

      {/* Active Edit Draft Banner */}
      {activeDraftId && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-xs sm:text-sm text-amber-400 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 flex-shrink-0" />
            <span>
              Режим редактирования черновика <strong className="text-slate-100">{activeDraftNumber}</strong>. Изменения сохранятся в этот же черновик.
            </span>
          </div>
          <button
            onClick={() => {
              setActiveDraftId(null);
              setActiveDraftNumber(null);
              setCart({});
              setMessage(null);
              const url = new URL(window.location.href);
              url.searchParams.delete('editDraftId');
              url.searchParams.delete('draftId');
              window.history.pushState({}, '', url.toString());
            }}
            className="text-xs text-slate-350 hover:text-white border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-lg bg-slate-900/50 font-bold transition-all"
          >
            Сбросить и выйти
          </button>
        </div>
      )}

      {/* Dynamic Alert Message */}
      {message && (
        <div className={`flex items-center gap-3 rounded-2xl border p-4 text-xs sm:text-sm animate-fade-in ${
          message.type === 'success'
            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
            : 'border-red-500/25 bg-red-500/10 text-red-400'
        }`}>
          {message.type === 'success' ? <Check className="h-5 w-5 flex-shrink-0" /> : <AlertCircle className="h-5 w-5 flex-shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Control Filter Bar, Search, Switchers & Tags */}
      <div className="space-y-4">
        <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
            {/* Search bar */}
            <div className="relative flex-1 sm:w-80">
              <Search className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-slate-400" />
              <input
                type="text"
                className="w-full rounded-xl pl-11 pr-4 py-3 text-xs glass-input"
                placeholder="Поиск марки, SKU или артикула..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            {/* Favorites filter toggle */}
            <button
              onClick={() => setFavoritesOnly(!favoritesOnly)}
              className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-xs font-bold transition-all ${
                favoritesOnly
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                  : 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              <Star className={`h-4 w-4 ${favoritesOnly ? 'fill-amber-400 text-amber-400' : 'text-slate-400'}`} />
              <span>Только Избранное</span>
            </button>
          </div>

          {/* B2B Unit Selection Mode Switcher */}
          <div className="flex items-center gap-2.5 bg-slate-900/50 p-1.5 rounded-xl border border-white/5 w-full sm:w-auto overflow-x-auto">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-2 whitespace-nowrap">Единицы измерения:</span>

            <button
              onClick={() => setUnitMode('PACKS')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                unitMode === 'PACKS'
                  ? 'bg-indigo-600 text-white shadow-glass-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Package className="h-3.5 w-3.5" />
              <span>Пачки</span>
            </button>

            <button
              onClick={() => setUnitMode('BLOCKS')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                unitMode === 'BLOCKS'
                  ? 'bg-indigo-600 text-white shadow-glass-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Блоки</span>
            </button>

            <button
              onClick={() => setUnitMode('CASES')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                unitMode === 'CASES'
                  ? 'bg-indigo-600 text-white shadow-glass-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Grid className="h-3.5 w-3.5" />
              <span>Коробки</span>
            </button>
          </div>
        </div>

        {/* Tags filter line */}
        {allAvailableTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/5">
            <span className="text-[10px] font-bold text-slate-550 uppercase tracking-wider">Теги:</span>
            <div className="flex flex-wrap gap-1.5">
              {allAvailableTags.map(tag => {
                const isSelected = selectedTagFilters.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedTagFilters(selectedTagFilters.filter(id => id !== tag.id));
                      } else {
                        setSelectedTagFilters([...selectedTagFilters, tag.id]);
                      }
                    }}
                    className="text-[10px] px-2.5 py-1 rounded-lg font-bold transition-all border flex items-center gap-1 cursor-pointer select-none"
                    style={{
                      backgroundColor: isSelected ? `${tag.color}20` : 'transparent',
                      color: isSelected ? tag.color : '#94a3b8',
                      borderColor: isSelected ? tag.color : 'rgba(255,255,255,0.08)'
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }}></span>
                    <span>{tag.name}</span>
                    {isSelected && <Check className="w-3 h-3 ml-0.5" />}
                  </button>
                );
              })}
              {selectedTagFilters.length > 0 && (
                <button
                  onClick={() => setSelectedTagFilters([])}
                  className="text-[10px] text-slate-400 hover:text-slate-200 px-2 py-1 underline font-bold"
                >
                  Сбросить
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Real-time Applied Bonuses & Promotions Live Banner */}
      {calculatedOrder && (calculatedOrder.totalBonusBlocks > 0 || (calculatedOrder.appliedPromotions && calculatedOrder.appliedPromotions.length > 0)) && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 animate-fade-in shadow-glow-sm">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300 font-bold text-xs">
                  🎁
                </span>
                <h4 className="font-extrabold text-xs sm:text-sm text-emerald-300">
                  Вам начислены акционные бонусы и коммерческие скидки!
                </h4>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-slate-300 pl-8">
                {calculatedOrder.totalBonusBlocks > 0 && (
                  <span className="font-bold text-emerald-400">
                    Подарочный объем: +{calculatedOrder.totalBonusBlocks} бл. ({calculatedOrder.totalBonusPacks} пач.) бесплатно
                  </span>
                )}
                {calculatedOrder.totalDiscount > 0 && (
                  <span className="font-bold text-cyan-300">
                    Экономия на заказе: -{calculatedOrder.totalDiscount.toLocaleString()} so'm
                  </span>
                )}
              </div>
            </div>

            {/* List of applied promotions pills */}
            <div className="flex flex-wrap gap-1.5 sm:justify-end">
              {calculatedOrder.appliedPromotions?.map((p: any, idx: number) => (
                <span
                  key={idx}
                  className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/35 text-emerald-200"
                >
                  {p.note || p.promotionName}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Cigarette Product Catalog Grid */}
      {filteredProducts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center glass-panel rounded-2xl">
          <AlertCircle className="h-10 w-10 text-slate-500 mb-4" />
          <h3 className="text-lg font-bold text-slate-300">Товары не найдены</h3>
          <p className="text-xs text-slate-400 mt-2">Попробуйте ввести другой поисковый запрос или сбросить фильтры.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4">
          {filteredProducts.map((prod) => {
            const quantityInPacks = getProductCartPacks(prod, cart);
            const uiQuantity = packsToUnit(quantityInPacks, unitMode);
            const inCart = quantityInPacks > 0;
            const isOutOfStock = prod.stockPacks <= 0;
            let calcItem = calculatedItemMap.get(prod.id);
            if (!calcItem && prod.groupId) {
              calcItem = calculatedItemMap.get(prod.groupId);
            }
            if (!calcItem && prod.skus) {
              for (const s of prod.skus) {
                const found = calculatedItemMap.get(s.id);
                if (found) {
                  calcItem = found;
                  break;
                }
              }
            }

            // Price according to the selected UnitMode and SKU price variation
            const activeSkus = prod.skus && prod.skus.length > 0 ? prod.skus.filter(s => s.isActive) : [];
            const skuPrices = activeSkus.length > 0 ? activeSkus.map(s => s.basePrice) : [prod.basePrice];
            const minBasePrice = Math.min(...skuPrices);
            const maxBasePrice = Math.max(...skuPrices);
            const hasPriceRange = minBasePrice !== maxBasePrice;

            const displayPrice = unitMode === 'PACKS'
              ? minBasePrice
              : unitMode === 'BLOCKS'
                ? minBasePrice * 10
                : minBasePrice * 500;

            const unitName = unitMode === 'PACKS'
              ? 'пачку'
              : unitMode === 'BLOCKS'
                ? 'блок'
                : 'коробку';

            let baseItemTotal = 0;
            const countedPrice = new Set<string>();
            if (prod.skus && prod.skus.length > 0) {
              for (const s of prod.skus) {
                if (s.id && !countedPrice.has(s.id)) {
                  countedPrice.add(s.id);
                  baseItemTotal += (cart[s.id] || 0) * (s.basePrice ?? prod.basePrice);
                }
              }
            }
            if (!prod.isGroup && prod.id && !countedPrice.has(prod.id)) {
              baseItemTotal += (cart[prod.id] || 0) * prod.basePrice;
            }
            if (!prod.skus || prod.skus.length === 0) {
              baseItemTotal = quantityInPacks * prod.basePrice;
            }

            const finalItemTotal = calcItem && calcItem.itemTotalPrice !== undefined && calcItem.itemTotalPrice > 0
              ? calcItem.itemTotalPrice
              : baseItemTotal;

            return (
              <div
                key={prod.id}
                className={`glass-card rounded-2xl p-3 sm:p-4 flex flex-col justify-between transition-all ${
                  inCart ? 'border-primary/45 shadow-glow-primary bg-indigo-950/5' : ''
                } ${isOutOfStock ? 'opacity-60' : ''}`}
              >
                <div>
                  {/* Card Header */}
                  <div className="flex justify-between items-start gap-1.5 mb-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[9px] sm:text-[10px] font-extrabold px-1.5 sm:px-2 py-0.5 rounded bg-slate-800 text-slate-300 tracking-wider">
                        {prod.sku}
                      </span>
                      {calcItem && calcItem.bonusQuantityPacks > 0 && (
                        <span className="flex items-center gap-1 text-[8px] sm:text-[9px] font-extrabold px-1.5 sm:px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 shadow-glow-sm">
                          🎁 +{calcItem.bonusQuantityBlocks} бл.
                        </span>
                      )}
                    </div>
                    {prod.isFavorite && (
                      <span className="flex h-4 w-4 sm:h-5 sm:w-5 items-center justify-center rounded-full bg-amber-500/10 text-amber-400 shrink-0">
                        <Star className="h-3 w-3 sm:h-3.5 sm:w-3.5 fill-amber-400" />
                      </span>
                    )}
                  </div>

                  {/* Cigarette Cover Image - 4:5 vertical proportion with object-contain */}
                  <div className="relative aspect-[4/5] w-full rounded-xl bg-gradient-to-b from-slate-800/40 to-slate-900/60 flex items-center justify-center mb-2.5 sm:mb-3 overflow-hidden border border-white/5 p-1.5 sm:p-2">
                    {prod.imageUrl && prod.imageUrl !== 'default-pack' ? (
                      <img
                        src={prod.imageUrl}
                        alt={prod.name}
                        className="w-full h-full object-contain drop-shadow-md"
                      />
                    ) : (
                      <>
                        <div className={`absolute top-0 left-0 w-2 sm:w-2.5 h-full ${
                          prod.name.includes('Parliament') ? 'bg-blue-600' :
                          prod.name.includes('Marlboro') ? 'bg-red-600' :
                          prod.name.includes('Sobranie') ? 'bg-yellow-600' : 'bg-emerald-600'
                        }`} />
                        <div className="flex flex-col items-center p-2 text-center">
                          <span className="text-[9px] sm:text-[10px] text-slate-500 font-extrabold uppercase tracking-widest leading-none">CIGARETTES</span>
                          <span className="font-extrabold text-xs sm:text-sm text-slate-200 mt-1.5 select-none leading-tight">{prod.name.split(' ')[0]}</span>
                          <span className="text-[8px] sm:text-[9px] text-slate-400 select-none mt-1 line-clamp-1">{prod.name.split(' ').slice(1).join(' ')}</span>
                        </div>
                      </>
                    )}

                    {isOutOfStock && (
                      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-2 text-center">
                        <span className="text-red-400 font-extrabold text-[10px] sm:text-xs uppercase tracking-wider px-2 sm:px-3 py-1 border border-red-500/20 rounded bg-red-500/10">
                          Нет в наличии
                        </span>
                      </div>
                    )}
                  </div>

                  {/* SKU Name */}
                  <h4 className="font-bold text-slate-200 text-xs sm:text-sm tracking-tight line-clamp-1" title={prod.name}>{prod.name}</h4>

                  {/* Card Tags list */}
                  {prod.tags && prod.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1 mb-2">
                      {prod.tags.slice(0, 3).map(t => (
                        <span
                          key={t.id}
                          className="text-[8px] sm:text-[9px] px-1.5 py-0.5 rounded font-extrabold uppercase tracking-wider"
                          style={{ backgroundColor: `${t.color}20`, color: t.color, border: `1px solid ${t.color}30` }}
                        >
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Price display per units (so'm currency) */}
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-baseline gap-0.5 mt-1.5 mb-2.5 sm:mb-4">
                    <span className="text-[9px] sm:text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Цена за {unitName}:</span>
                    <span className="font-bold text-xs sm:text-sm text-slate-100">
                      {hasPriceRange ? `от ${displayPrice.toLocaleString()}` : displayPrice.toLocaleString()} so'm
                    </span>
                  </div>
                </div>

                {/* Shopping Controls */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1 bg-slate-950/50 p-1 rounded-xl border border-white/5">
                    <button
                      onClick={() => handleDecrement(prod.id)}
                      disabled={isOutOfStock}
                      className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg bg-white/5 border border-white/5 text-slate-300 hover:bg-white/10 active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                    >
                      <Minus className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                    </button>

                    <input
                      type="text"
                      className="flex-1 w-full min-w-0 text-center bg-transparent border-0 text-slate-100 text-xs font-bold focus:outline-none disabled:opacity-30"
                      value={uiQuantity || ''}
                      onChange={(e) => handleInputChange(prod.id, e.target.value)}
                      placeholder="0"
                      disabled={isOutOfStock}
                    />

                    <button
                      onClick={() => handleIncrement(prod.id)}
                      disabled={isOutOfStock}
                      className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg bg-white/5 border border-white/5 text-slate-300 hover:bg-white/10 active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                    >
                      <Plus className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                    </button>
                  </div>

                  {/* Item total price helper (so'm currency) */}
                  {inCart && (
                    <div className="space-y-1.5 pt-1">
                      <div className="flex justify-between items-center text-[10px] text-slate-400 px-1 font-semibold">
                        <span>Сумма:</span>
                        <div className="text-right">
                          {calcItem && calcItem.promotionDiscount > 0 && (
                            <span className="line-through text-slate-500 mr-1.5 text-[9px]">
                              {baseItemTotal.toLocaleString()} so'm
                            </span>
                          )}
                          <span className="text-primary font-bold">
                            {finalItemTotal.toLocaleString()} so'm
                          </span>
                        </div>
                      </div>

                      {/* Promotion Discount Badge */}
                      {calcItem && calcItem.promotionDiscount > 0 && (
                        <div className="flex justify-between items-center text-[9px] px-1 text-emerald-400 font-bold">
                          <span>Скидка по акции:</span>
                          <span>-{Math.round(calcItem.promotionDiscount).toLocaleString()} so'm</span>
                        </div>
                      )}

                      {/* Real-time Promotion Engine Bonus Breakdown */}
                      {calcItem && calcItem.bonusQuantityPacks > 0 && (
                        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-2 text-[10px] space-y-0.5">
                          <div className="flex justify-between text-slate-300">
                            <span>Выбрано:</span>
                            <span className="font-bold text-white">
                              {unitMode === 'BLOCKS' ? `${calcItem.baseQuantityBlocks} бл.` : unitMode === 'CASES' ? `${calcItem.baseQuantityCases} кор.` : `${calcItem.baseQuantityPacks} пач.`}
                            </span>
                          </div>
                          <div className="flex justify-between text-emerald-400 font-bold">
                            <span>Бонус:</span>
                            <span>
                              +{unitMode === 'BLOCKS' ? `${calcItem.bonusQuantityBlocks} бл.` : unitMode === 'CASES' ? `${calcItem.bonusQuantityCases} кор.` : `${calcItem.bonusQuantityPacks} пач.`}
                            </span>
                          </div>
                          <div className="flex justify-between text-amber-300 font-extrabold border-t border-amber-500/20 pt-0.5">
                            <span>Итого:</span>
                            <span>
                              {unitMode === 'BLOCKS' ? `${calcItem.totalQuantityBlocks} бл.` : unitMode === 'CASES' ? `${calcItem.totalQuantityCases} кор.` : `${calcItem.totalQuantityPacks} пач.`}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Promotion Note */}
                      {calcItem && calcItem.promotionNote && !calcItem.bonusQuantityPacks && (
                        <div className="text-[9px] px-1 text-emerald-400/90 font-medium">
                          {calcItem.promotionNote}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating Bottom Shopping Cart for Desktop and Mobile */}
      {orderTotals.packs > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/85 backdrop-blur-xl border-t border-white/10 py-3.5 shadow-glass-lg animate-slide-up">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-4">
            {/* Total items stats breakdown */}
            <div className="flex items-center gap-4 w-full md:w-auto">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-tr from-primary to-accent shadow-glow-primary text-white flex-shrink-0 animate-pulse-slow">
                <ShoppingCart className="h-6 w-6" />
              </div>
              <div className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-x-2 text-slate-400 text-xs font-semibold">
                  <span>Активный заказ:</span>
                  <span className="text-primary-focus font-bold">
                    {calculatedOrder
                      ? `${calculatedOrder.totalBlocks} бл. (${calculatedOrder.totalCases} кор.)`
                      : orderTotals.breakdownLabel}
                  </span>
                  {calculatedOrder && calculatedOrder.totalBonusBlocks > 0 && (
                    <span className="text-emerald-400 font-bold text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                      +{calculatedOrder.totalBonusBlocks} бл. бонус
                    </span>
                  )}
                </div>

                {/* Total Price display with promotion discount info */}
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-slate-200 text-base font-extrabold tracking-tight">
                    Итого: <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                      {(calculatedOrder && calculatedOrder.totalPrice > 0 ? calculatedOrder.totalPrice : orderTotals.price).toLocaleString()} so'm
                    </span>
                  </span>

                  {calculatedOrder && calculatedOrder.totalDiscount > 0 && (
                    <span className="text-xs text-emerald-400 font-bold">
                      (скидка -{calculatedOrder.totalDiscount.toLocaleString()} so'm)
                    </span>
                  )}
                </div>

                {/* Active Applied Promotions Badges */}
                {calculatedOrder?.appliedPromotions && calculatedOrder.appliedPromotions.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {calculatedOrder.appliedPromotions.map((p: any, idx: number) => (
                      <span key={idx} className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                        {p.note || p.promotionName}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex gap-3 w-full md:w-auto">
              <button
                onClick={handleSaveDraft}
                disabled={saveDrafting || submitting}
                className="flex-1 md:flex-initial btn-secondary flex items-center justify-center gap-2 px-5 py-3 text-xs"
              >
                {saveDrafting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                <span>Сохранить черновик</span>
              </button>

              <button
                onClick={handleSubmitOrder}
                disabled={submitting || saveDrafting}
                className="flex-2 md:flex-initial btn-success flex items-center justify-center gap-2 px-6 py-3 text-xs"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                <span>{activeDraftId ? 'Оформить заказ' : 'Отправить заказ в Excel'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
