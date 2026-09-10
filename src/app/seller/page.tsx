'use client';

import { useState, useEffect, useMemo } from 'react';
import { 
  Briefcase, Download, Filter, Search, UserCheck, AlertCircle, 
  Loader2, DollarSign, Package, Layers, TrendingUp, ShoppingBag, Eye, MessageSquare, 
  BarChart3, Edit, Plus, Trash2, Check, X, Shield, RefreshCw
} from 'lucide-react';
import { breakdownPacks } from '@/lib/conversion';

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
  quantityPacks: number;
  quantityBlocks: number;
  quantityCases: number;
  price: number;
  productNameSnapshot: string | null;
  skuSnapshot: string | null;
  product: {
    id?: string;
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
  customer: {
    id?: string;
    name: string;
    email: string;
  };
  items: OrderItem[];
  comments?: CommentItem[];
}

interface ProductItem {
  id: string;
  sku: string;
  name: string;
  imageUrl: string;
  basePrice: number;
  stockPacks: number;
  isActive: boolean;
  isFavorite: boolean;
  tags?: Array<{ id: string; name: string; color: string }>;
}

interface EditOrderItemState {
  productId: string;
  sku: string;
  name: string;
  price: number | string;
  quantityPacks: number;
}

export default function SellerDashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Permissions state
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isSuperadmin, setIsSuperadmin] = useState(false);

  // Tab state: 'orders' | 'products'
  const [activeTab, setActiveTab] = useState<'orders' | 'products'>('orders');

  // Filtering states for Orders
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [timeFilter, setTimeFilter] = useState<string>('ALL');

  // Search state for Products
  const [productSearch, setProductSearch] = useState('');

  // --- Quick Stock Edit Modal State ---
  const [editingStockProduct, setEditingStockProduct] = useState<ProductItem | null>(null);
  const [stockPacksValue, setStockPacksValue] = useState<number | ''>('');
  const [savingStock, setSavingStock] = useState(false);

  // --- Order Edit Modal State ---
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [orderEditItems, setOrderEditItems] = useState<EditOrderItemState[]>([]);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderEditError, setOrderEditError] = useState('');
  const [selectedAddProductId, setSelectedAddProductId] = useState('');

  const canEditOrders = isSuperadmin || permissions.includes('orders:edit') || permissions.includes('orders:create');
  const canChangeStatus = isSuperadmin || permissions.includes('orders:status_change');
  const canUpdateStock = isSuperadmin || permissions.includes('products:stock_update') || permissions.includes('products:manage');
  const canExportExcel = isSuperadmin || permissions.includes('orders:export');
  const canAddComments = isSuperadmin || permissions.includes('orders:comments') || permissions.length === 0;

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const loadAllOrders = async () => {
    try {
      const res = await fetch('/api/orders');
      if (res.ok) {
        const data = await res.json();
        setOrders(data);
      }
    } catch (err) {
      console.error('Failed to load orders', err);
    } finally {
      setLoading(false);
    }
  };

  const loadProducts = async () => {
    setLoadingProducts(true);
    try {
      const res = await fetch('/api/products');
      if (res.ok) {
        setProducts(await res.json());
      }
    } catch (err) {
      console.error('Failed to load products', err);
    } finally {
      setLoadingProducts(false);
    }
  };

  useEffect(() => {
    async function initAuth() {
      try {
        const meRes = await fetch('/api/auth/me');
        if (meRes.ok) {
          const meData = await meRes.json();
          if (meData.authenticated && meData.user) {
            const isSuper = meData.user.role === 'ADMIN' || meData.user.roleName === 'Суперадминистратор' || (meData.user.permissions || []).includes('*');
            setIsSuperadmin(isSuper);
            setPermissions(meData.user.permissions || []);
          }
        }
      } catch (e) {}
    }

    initAuth();
    loadAllOrders();
    loadProducts();
  }, []);

  useEffect(() => {
    if (activeTab === 'products') {
      loadProducts();
    }
  }, [activeTab]);

  // Handle order status change
  const handleStatusChange = async (orderId: string, newStatus: string) => {
    try {
      const res = await fetch('/api/orders/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, status: newStatus })
      });
      if (res.ok) {
        showToast(`Статус заказа изменен на "${newStatus}"`);
        loadAllOrders();
      } else {
        const data = await res.json();
        showToast(data.error || 'Не удалось изменить статус заказа.', 'error');
      }
    } catch {
      showToast('Ошибка соединения с сервером.', 'error');
    }
  };

  // --- STOCK EDIT HANDLERS ---
  const openStockModal = (product: ProductItem) => {
    setEditingStockProduct(product);
    setStockPacksValue(product.stockPacks);
  };

  const handleSaveStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStockProduct) return;
    setSavingStock(true);

    try {
      const res = await fetch('/api/admin/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingStockProduct.id,
          stockPacks: stockPacksValue !== '' ? Number(stockPacksValue) : 0
        })
      });

      const data = await res.json();
      if (res.ok) {
        showToast(`Остаток для "${editingStockProduct.name}" успешно обновлен!`);
        setEditingStockProduct(null);
        loadProducts();
      } else {
        showToast(data.error || 'Ошибка при обновлении остатка.', 'error');
      }
    } catch {
      showToast('Ошибка связи с сервером.', 'error');
    } finally {
      setSavingStock(false);
    }
  };

  // --- ORDER EDIT HANDLERS ---
  const openEditOrderModal = (order: Order) => {
    setEditingOrder(order);
    setOrderEditError('');
    setSelectedAddProductId('');
    
    // Map items to editable state
    const mappedItems: EditOrderItemState[] = order.items.map(i => ({
      productId: i.productId,
      sku: i.skuSnapshot || i.product?.sku || '',
      name: i.productNameSnapshot || i.product?.name || 'Товар',
      price: i.effectivePrice !== undefined ? i.effectivePrice : i.price,
      quantityPacks: i.quantityPacks
    }));
    
    setOrderEditItems(mappedItems);
  };

  const handleItemQtyChange = (index: number, newPacks: number) => {
    setOrderEditItems(prev => {
      const next = [...prev];
      next[index] = { ...next[index], quantityPacks: Math.max(0, newPacks) };
      return next;
    });
  };

  const handleItemPriceChange = (index: number, val: string) => {
    setOrderEditItems(prev => {
      const next = [...prev];
      next[index] = { ...next[index], price: val };
      return next;
    });
  };

  const handleToggleBonus = (index: number) => {
    setOrderEditItems(prev => {
      const next = [...prev];
      const current = next[index];
      const currentPriceNum = Number(current.price) || 0;
      if (currentPriceNum === 0) {
        // Restore catalog base price
        const catalogProd = products.find(p => p.id === current.productId);
        next[index] = { ...current, price: catalogProd?.basePrice || 10000 };
      } else {
        // Set to 0 (Bonus position)
        next[index] = { ...current, price: 0 };
      }
      return next;
    });
  };

  const handleRemoveOrderItem = (index: number) => {
    if (orderEditItems.length <= 1) {
      setOrderEditError('В заказе должен оставаться хотя бы один товар.');
      return;
    }
    setOrderEditItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddProductToOrder = () => {
    if (!selectedAddProductId) return;
    const prod = products.find(p => p.id === selectedAddProductId);
    if (!prod) return;

    // Check if already in order
    const existingIndex = orderEditItems.findIndex(i => i.productId === prod.id);
    if (existingIndex >= 0) {
      handleItemQtyChange(existingIndex, orderEditItems[existingIndex].quantityPacks + 10);
    } else {
      setOrderEditItems(prev => [
        ...prev,
        {
          productId: prod.id,
          sku: prod.sku,
          name: prod.name,
          price: prod.basePrice,
          quantityPacks: 10 // Default 1 block
        }
      ]);
    }
    setSelectedAddProductId('');
  };

  const handleSaveOrderEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;
    setSavingOrder(true);
    setOrderEditError('');

    const activeItems = orderEditItems.filter(i => i.quantityPacks > 0);
    if (activeItems.length === 0) {
      setOrderEditError('Укажите количество хотя бы для одного товара.');
      setSavingOrder(false);
      return;
    }

    try {
      const res = await fetch('/api/orders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: editingOrder.id,
          status: editingOrder.status,
          items: activeItems.map(i => ({
            productId: i.productId,
            quantityPacks: i.quantityPacks,
            price: Number(i.price) || 0
          }))
        })
      });

      const data = await res.json();
      if (res.ok) {
        showToast(`Заказ ${editingOrder.orderNumber} успешно обновлен!`);
        setEditingOrder(null);
        loadAllOrders();
      } else {
        setOrderEditError(data.error || 'Не удалось обновить заказ.');
      }
    } catch {
      setOrderEditError('Ошибка связи с сервером.');
    } finally {
      setSavingOrder(false);
    }
  };

  // Live calculation for order edit modal
  const editOrderTotals = useMemo(() => {
    const totalPacks = orderEditItems.reduce((sum, i) => sum + i.quantityPacks, 0);
    const totalBlocks = Math.floor(totalPacks / 10);
    const totalCases = Math.round((totalPacks / 500) * 100) / 100;
    const totalPrice = Math.round(orderEditItems.reduce((sum, i) => sum + (i.quantityPacks * (Number(i.price) || 0)), 0) * 100) / 100;
    return { totalPacks, totalBlocks, totalCases, totalPrice };
  }, [orderEditItems]);

  // Filtered orders list
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchSearch = order.customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          order.customer.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          order.orderNumber.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchStatus = statusFilter === 'ALL' || order.status === statusFilter;

      let matchTime = true;
      if (timeFilter !== 'ALL') {
        const orderDate = new Date(order.createdAt);
        const now = new Date();
        if (timeFilter === 'TODAY') {
          matchTime = orderDate.toDateString() === now.toDateString();
        } else if (timeFilter === 'WEEK') {
          const oneWeekAgo = new Date();
          oneWeekAgo.setDate(now.getDate() - 7);
          matchTime = orderDate >= oneWeekAgo;
        }
      }

      return matchSearch && matchStatus && matchTime;
    });
  }, [orders, searchTerm, statusFilter, timeFilter]);

  // Filtered products list
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      return p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
             p.sku.toLowerCase().includes(productSearch.toLowerCase());
    });
  }, [products, productSearch]);

  // Dynamic Sales Metrics Calculations
  const metrics = useMemo(() => {
    const activeOrders = filteredOrders.filter(o => o.status !== 'DRAFT' && o.status !== 'CANCELLED');
    const revenue = activeOrders.reduce((sum, o) => sum + o.totalPrice, 0);
    const blocks = activeOrders.reduce((sum, o) => sum + o.totalBlocks, 0);
    const cases = activeOrders.reduce((sum, o) => sum + o.totalCases, 0);
    const uniqueClients = new Set(filteredOrders.map(o => o.customer.email)).size;

    return {
      revenue,
      blocks,
      cases: Math.round(cases * 100) / 100,
      uniqueClients,
      totalOrders: filteredOrders.length
    };
  }, [filteredOrders]);

  // Order status badge
  const renderStatusBadge = (status: Order['status']) => {
    switch (status) {
      case 'DRAFT':
        return <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">Черновик</span>;
      case 'NEW':
        return <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">Новый заказ</span>;
      case 'ASSEMBLY':
        return <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-500/10 border border-amber-500/20 text-amber-400">Сборка</span>;
      case 'SHIPPED':
        return <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">Отгрузка</span>;
      case 'COMPLETED':
        return <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">Завершен</span>;
      case 'CANCELLED':
        return <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-red-500/10 border border-red-500/20 text-red-400">Отменен</span>;
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 w-full flex-col items-center justify-center text-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-xs font-semibold text-slate-400">Синхронизируем базу данных заказов...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in pb-16">
      {/* Toast Notification */}
      {toastMessage && (
        <div className={`fixed top-6 right-6 z-50 rounded-2xl border px-4 py-3 text-xs font-bold shadow-2xl flex items-center gap-2 animate-slide-down ${
          toastMessage.type === 'success' 
            ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400' 
            : 'border-red-500/30 bg-red-500/15 text-red-400'
        }`}>
          {toastMessage.type === 'success' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Tab Switcher Navigation */}
      <div className="flex border-b border-white/5 gap-2 select-none">
        <button
          onClick={() => setActiveTab('orders')}
          className={`px-5 py-3 text-xs font-extrabold uppercase tracking-wider transition-all border-b-2 flex items-center gap-2 ${
            activeTab === 'orders' 
              ? 'border-cyan-500 text-cyan-400 bg-cyan-500/5' 
              : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Briefcase className="w-4 h-4" />
          <span>Входящие заказы</span>
        </button>
        <button
          onClick={() => setActiveTab('products')}
          className={`px-5 py-3 text-xs font-extrabold uppercase tracking-wider transition-all border-b-2 flex items-center gap-2 ${
            activeTab === 'products' 
              ? 'border-cyan-500 text-cyan-400 bg-cyan-500/5' 
              : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <ShoppingBag className="w-4 h-4" />
          <span>Мониторинг SKU (Цены и остатки)</span>
        </button>
        <a
          href="/analytics"
          className="px-5 py-3 text-xs font-extrabold uppercase tracking-wider transition-all border-b-2 border-transparent text-slate-400 hover:text-white hover:bg-white/5 flex items-center gap-2"
        >
          <BarChart3 className="w-4 h-4 text-cyan-400" />
          <span>Аналитика</span>
        </a>
      </div>

      {activeTab === 'orders' ? (
        <>
          {/* 1. Dashboard Sales metrics cards grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-indigo-500">
              <div className="flex justify-between items-center text-slate-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">Общий объем продаж</span>
                <DollarSign className="h-4.5 w-4.5 text-indigo-400" />
              </div>
              <span className="block mt-2 text-xl font-extrabold text-slate-100">{metrics.revenue.toLocaleString()} so'm</span>
              <span className="block mt-1 text-[9px] text-slate-500 font-semibold">Сумма активных заказов</span>
            </div>

            <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-cyan-500">
              <div className="flex justify-between items-center text-slate-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">Отгружено коробок</span>
                <Package className="h-4.5 w-4.5 text-cyan-400" />
              </div>
              <span className="block mt-2 text-xl font-extrabold text-slate-100">{metrics.cases} кор.</span>
              <span className="block mt-1 text-[9px] text-slate-500 font-semibold">1 коробка = 50 блоков (500 пачек)</span>
            </div>

            <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-emerald-500">
              <div className="flex justify-between items-center text-slate-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">Отгружено блоков</span>
                <Layers className="h-4.5 w-4.5 text-emerald-400" />
              </div>
              <span className="block mt-2 text-xl font-extrabold text-slate-100">{metrics.blocks} бл.</span>
              <span className="block mt-1 text-[9px] text-slate-500 font-semibold">1 блок = 10 пачек</span>
            </div>

            <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-amber-500">
              <div className="flex justify-between items-center text-slate-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">Активные клиенты</span>
                <UserCheck className="h-4.5 w-4.5 text-amber-400" />
              </div>
              <span className="block mt-2 text-xl font-extrabold text-slate-100">{metrics.uniqueClients} компаний</span>
              <span className="block mt-1 text-[9px] text-slate-500 font-semibold">Сделали хотя бы 1 заказ</span>
            </div>
          </div>

          {/* 2. Control Filter Bar */}
          <div className="glass-panel rounded-2xl p-4 flex flex-col xl:flex-row gap-4 items-center justify-between">
            <div className="relative w-full xl:w-80 flex-shrink-0">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                className="w-full rounded-xl pl-9 pr-4 py-2.5 text-xs glass-input"
                placeholder="Поиск по клиенту или № заказа..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto xl:justify-end">
              <div className="flex items-center gap-1.5 bg-slate-950/40 p-1.5 rounded-xl border border-white/5 overflow-x-auto max-w-full">
                <span className="text-[9px] text-slate-500 font-bold uppercase px-1.5 whitespace-nowrap">Статус:</span>
                {['ALL', 'NEW', 'ASSEMBLY', 'SHIPPED', 'COMPLETED', 'CANCELLED'].map(status => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all whitespace-nowrap ${
                      statusFilter === status 
                        ? 'bg-cyan-600 text-white shadow-glass-sm' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {status === 'ALL' ? 'Все' : status === 'NEW' ? 'Новые' : status === 'ASSEMBLY' ? 'Сборка' : status === 'SHIPPED' ? 'Отгрузка' : status === 'COMPLETED' ? 'Вып.' : 'Отм.'}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5 bg-slate-950/40 p-1.5 rounded-xl border border-white/5 flex-shrink-0">
                <span className="text-[9px] text-slate-500 font-bold uppercase px-1.5">Период:</span>
                {['ALL', 'TODAY', 'WEEK'].map(time => (
                  <button
                    key={time}
                    onClick={() => setTimeFilter(time)}
                    className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all ${
                      timeFilter === time 
                        ? 'bg-cyan-600 text-white shadow-glass-sm' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {time === 'ALL' ? 'Все' : time === 'TODAY' ? 'Сегодня' : 'Неделя'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 3. Orders Board Table List */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-200 text-base flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-cyan-400" />
                <span>Журнал входящих B2B заказов ({filteredOrders.length})</span>
              </h3>
            </div>

            {filteredOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center glass-panel rounded-2xl animate-fade-in">
                <AlertCircle className="h-10 w-10 text-slate-500 mb-4" />
                <h3 className="text-lg font-bold text-slate-300">Заказы не найдены</h3>
                <p className="text-xs text-slate-400 mt-2">По заданным фильтрам и поисковым критериям записей в журнале нет.</p>
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

                  const isEditable = order.status === 'DRAFT' || order.status === 'NEW';

                  return (
                    <div key={order.id} className="glass-panel rounded-2xl p-5 sm:p-6 flex flex-col justify-between gap-4 border border-white/5 hover:border-white/10 transition-all">
                      {/* Row header */}
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-white/5">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-sm sm:text-base text-slate-200">{order.orderNumber}</span>
                            {renderStatusBadge(order.status)}
                          </div>
                          <span className="block text-[10px] text-slate-400 mt-1 font-semibold">
                            Клиент: <span className="text-slate-200 font-bold">{order.customer.name}</span> ({order.customer.email})
                          </span>
                        </div>

                        <div className="text-left sm:text-right">
                          <span className="block text-[9px] text-slate-500 font-bold uppercase tracking-wider">Сумма сделки:</span>
                          <span className="block font-extrabold text-base text-emerald-400 mt-0.5 leading-none">{order.totalPrice.toLocaleString()} so'm</span>
                        </div>
                      </div>

                      {/* SKU breakdown details grid */}
                      <div className="py-1">
                        <span className="block text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-2">Перечень закупки:</span>
                        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                          {order.items.map((item) => {
                            const breakdown = breakdownPacks(item.quantityPacks);
                            return (
                              <div key={item.id} className="bg-slate-950/20 border border-white/5 rounded-xl p-2.5 flex justify-between items-center text-xs">
                                <div>
                                  <span className="block font-bold text-slate-300 line-clamp-1">{item.productNameSnapshot || item.product?.name || 'Неизвестно'}</span>
                                  <span className="block text-[9px] text-slate-500 font-semibold mt-0.5">{item.skuSnapshot || item.product?.sku || 'Неизвестно'}</span>
                                </div>
                                <span className="font-extrabold text-cyan-400 flex-shrink-0">{breakdown.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Comments Section */}
                      {canAddComments && (
                        <div className="mt-2 pt-3 border-t border-white/5 space-y-2.5">
                          <h4 className="text-[9px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                            <MessageSquare className="h-3.5 w-3.5 text-cyan-400" />
                            <span>Комментарии</span>
                          </h4>
                          
                          {order.comments && order.comments.length > 0 ? (
                            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                              {order.comments.map((comment) => {
                                const commentDate = new Date(comment.createdAt).toLocaleString('ru-RU', {
                                  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                                });
                                return (
                                  <div key={comment.id} className="bg-slate-950/30 border border-white/5 rounded-lg p-2.5 text-[11px] leading-relaxed">
                                    <div className="flex justify-between items-center text-slate-450 font-bold mb-0.5 text-[9px]">
                                      <span>{comment.userName}</span>
                                      <span>{commentDate}</span>
                                    </div>
                                    <p className="text-slate-350">{comment.text}</p>
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
                                      loadAllOrders();
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
                                    loadAllOrders();
                                  }
                                } catch (err) {
                                  console.error('Failed to post comment', err);
                                }
                              }}
                              className="btn-primary px-3 py-1.5 text-xs flex items-center justify-center"
                            >
                              Отправить
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Actions & Summary breakdown footer */}
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-3 border-t border-white/5 w-full">
                        <div className="text-[10px] text-slate-400 font-semibold">
                          Объем: <span className="text-slate-200 font-bold">{order.totalBlocks} блоков</span> / <span className="text-slate-200 font-bold">{order.totalCases} коробок</span>
                          <span className="ml-3 text-slate-500">({date})</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto sm:justify-end">
                          {/* Order Edit button if authorized */}
                          {canEditOrders && isEditable && (
                            <button
                              onClick={() => openEditOrderModal(order)}
                              className="px-3 py-1.5 rounded-xl border border-indigo-500/25 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 text-xs font-bold flex items-center gap-1.5 transition-all"
                              title="Редактировать позиции заказа"
                            >
                              <Edit className="h-3.5 w-3.5" />
                              <span>Редактировать заказ</span>
                            </button>
                          )}

                          {/* Status changer select if authorized */}
                          {order.status !== 'DRAFT' && (
                            canChangeStatus ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-slate-500 font-bold uppercase whitespace-nowrap">Статус:</span>
                                <select
                                  value={order.status}
                                  onChange={(e) => handleStatusChange(order.id, e.target.value)}
                                  className="bg-slate-900 border border-white/10 rounded-lg py-1 px-2.5 text-[10px] font-bold text-slate-300 focus:outline-none focus:border-cyan-500/50 transition-all cursor-pointer"
                                >
                                  <option value="NEW">Новый</option>
                                  <option value="ASSEMBLY">Сборка</option>
                                  <option value="SHIPPED">Отгрузка</option>
                                  <option value="COMPLETED">Завершен</option>
                                  <option value="CANCELLED">Отменен</option>
                                </select>
                              </div>
                            ) : (
                              renderStatusBadge(order.status)
                            )
                          )}

                          {/* Excel Download button if authorized */}
                          {canExportExcel && (
                            (order.fileUrl || order.fileId) ? (
                              <a
                                href={`/api/orders/download?id=${order.id}`}
                                download
                                className="btn-primary flex items-center justify-center gap-2 px-3.5 py-1.5 text-xs"
                                title="Скачать накладную Excel"
                              >
                                <Download className="h-3.5 w-3.5" />
                                <span>Excel</span>
                              </a>
                            ) : order.status === 'DRAFT' ? (
                              <span className="text-slate-500 text-[10px] py-1 px-2.5 border border-dashed border-white/5 rounded-lg whitespace-nowrap">
                                Черновик
                              </span>
                            ) : (
                              <span className="text-red-400 bg-red-500/10 border border-red-500/20 text-[10px] font-bold py-1 px-2.5 rounded-lg whitespace-nowrap">
                                Нет Excel
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        /* --- PRODUCTS MONITORING TAB --- */
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h3 className="font-bold text-slate-200 text-base flex items-center gap-2">
                <Eye className="h-5 w-5 text-cyan-400" />
                <span>Мониторинг каталога (Цены и остатки на складе)</span>
              </h3>
              <span className="text-[10px] text-slate-500 font-semibold block mt-0.5">
                Просмотр номенклатуры сигарет, цен и физических остатков в реальном времени.
              </span>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="text"
                className="w-full rounded-xl pl-9 pr-4 py-2 text-xs glass-input"
                placeholder="Поиск по марке или артикулу..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
            </div>
          </div>

          {loadingProducts ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center glass-panel rounded-2xl">
              <ShoppingBag className="h-10 w-10 text-slate-600 mb-2" />
              <p className="text-xs text-slate-400">Товары не найдены.</p>
            </div>
          ) : (
            <div className="glass-panel rounded-3xl overflow-hidden border border-white/5 animate-fade-in shadow-glass-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 bg-slate-950/40 text-[10px] text-slate-400 uppercase tracking-wider font-extrabold">
                      <th className="py-4 px-6">Обложка</th>
                      <th className="py-4 px-6">Артикул / SKU</th>
                      <th className="py-4 px-6">Наименование</th>
                      <th className="py-4 px-6">Цена за пачку</th>
                      <th className="py-4 px-6">Цена за блок</th>
                      <th className="py-4 px-6">Остаток на складе</th>
                      <th className="py-4 px-6">Витрина</th>
                      {canUpdateStock && <th className="py-4 px-6 text-right">Действия</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-xs">
                    {filteredProducts.map((p) => {
                      const caseQty = Math.floor(p.stockPacks / 500);
                      const blockQty = Math.floor((p.stockPacks % 500) / 10);
                      const packQty = p.stockPacks % 10;
                      const detailStock = `${caseQty} кор.  ${blockQty} бл.` + (packQty > 0 ? `  ${packQty} пач.` : '');

                      return (
                        <tr key={p.id} className="hover:bg-white/5 transition-all text-slate-300">
                          <td className="py-4 px-6">
                            <div className="w-10 aspect-[4/5] rounded-lg border border-white/5 bg-slate-950/40 overflow-hidden flex items-center justify-center p-0.5">
                              {p.imageUrl && p.imageUrl !== 'default-pack' ? (
                                <img 
                                  src={p.imageUrl} 
                                  alt={p.name} 
                                  className="w-full h-full object-contain"
                                />
                              ) : (
                                <ShoppingBag className="w-4 h-4 text-slate-600" />
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-6 font-mono text-slate-400 font-bold">{p.sku}</td>
                          <td className="py-4 px-6 font-bold text-slate-200">
                            <div>{p.name}</div>
                            {p.tags && p.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {p.tags.map(t => (
                                  <span 
                                    key={t.id} 
                                    className="text-[9px] px-1.5 py-0.5 rounded font-extrabold uppercase tracking-wider"
                                    style={{ backgroundColor: `${t.color}20`, color: t.color, border: `1px solid ${t.color}30` }}
                                  >
                                    {t.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="py-4 px-6 font-bold text-slate-300">{p.basePrice.toLocaleString()} so'm</td>
                          <td className="py-4 px-6 font-bold text-primary-focus">{(p.basePrice * 10).toLocaleString()} so'm</td>
                          <td className="py-4 px-6">
                            <div className="font-bold text-slate-100">{p.stockPacks.toLocaleString()} шт.</div>
                            <div className="text-[10px] text-slate-500 font-semibold mt-0.5">({detailStock})</div>
                          </td>
                          <td className="py-4 px-6">
                            <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-extrabold tracking-wider border ${
                              p.isActive 
                                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                                : 'bg-red-500/10 border-red-500/20 text-red-400'
                            }`}>
                              {p.isActive ? 'АКТИВЕН' : 'СКРЫТ'}
                            </span>
                          </td>
                          {canUpdateStock && (
                            <td className="py-4 px-6 text-right">
                              <button
                                onClick={() => openStockModal(p)}
                                className="px-3 py-1.5 rounded-lg border border-cyan-500/25 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 text-xs font-bold inline-flex items-center gap-1.5 transition-all"
                                title="Изменить количество товара на складе"
                              >
                                <Edit className="h-3.5 w-3.5" />
                                <span>Изменить остаток</span>
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- QUICK STOCK EDIT MODAL --- */}
      {editingStockProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-md rounded-3xl p-6 sm:p-8 relative">
            <button 
              onClick={() => setEditingStockProduct(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-base font-bold text-slate-200 mb-4 flex items-center gap-2">
              <Package className="h-5 w-5 text-cyan-400" />
              <span>Редактирование складского остатка</span>
            </h3>

            <div className="bg-slate-900/60 p-3.5 rounded-xl border border-white/5 space-y-1 mb-4">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Товар</span>
              <p className="text-sm font-extrabold text-slate-100">{editingStockProduct.name}</p>
              <p className="text-xs text-slate-400 font-mono">Артикул / SKU: {editingStockProduct.sku}</p>
            </div>

            <form onSubmit={handleSaveStock} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Новый остаток на складе (в штуках/пачках)
                </label>
                <input
                  type="number"
                  min="0"
                  className="w-full rounded-xl px-4 py-3 text-sm glass-input font-bold text-slate-100"
                  value={stockPacksValue}
                  onChange={(e) => setStockPacksValue(e.target.value !== '' ? Number(e.target.value) : '')}
                  required
                />
                
                {/* Real-time breakdown helper */}
                <div className="p-3 rounded-xl bg-slate-950/40 border border-white/5 text-xs text-slate-300 font-semibold space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400">В блоках (по 10 шт):</span>
                    <strong className="text-cyan-400">{Math.floor((Number(stockPacksValue) || 0) / 10)} блоков</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">В коробках (по 500 шт):</span>
                    <strong className="text-indigo-400">{Math.round(((Number(stockPacksValue) || 0) / 500) * 100) / 100} коробок</strong>
                  </div>
                </div>

                {/* Quick Add Buttons */}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setStockPacksValue(prev => (Number(prev) || 0) + 100)}
                    className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[10px] font-bold text-slate-300"
                  >
                    +10 блоков
                  </button>
                  <button
                    type="button"
                    onClick={() => setStockPacksValue(prev => (Number(prev) || 0) + 500)}
                    className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[10px] font-bold text-slate-300"
                  >
                    +1 коробка (500)
                  </button>
                  <button
                    type="button"
                    onClick={() => setStockPacksValue(prev => (Number(prev) || 0) + 2500)}
                    className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[10px] font-bold text-slate-300"
                  >
                    +5 коробок
                  </button>
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setEditingStockProduct(null)}
                  className="flex-1 py-2.5 rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-slate-300 hover:bg-white/10"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={savingStock}
                  className="btn-primary flex-1 py-2.5 text-xs font-bold flex items-center justify-center gap-2"
                >
                  {savingStock ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  <span>Сохранить остаток</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- ORDER EDIT MODAL --- */}
      {editingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-2xl rounded-3xl p-6 sm:p-8 relative max-h-[92vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-white/5 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Edit className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-200">
                    Редактирование заказа {editingOrder.orderNumber}
                  </h3>
                  <span className="block text-xs text-slate-400">
                    Клиент: <strong className="text-slate-200">{editingOrder.customer.name}</strong> • Статус: {editingOrder.status}
                  </span>
                </div>
              </div>

              <button 
                onClick={() => setEditingOrder(null)}
                className="h-8 w-8 rounded-lg bg-white/5 text-slate-400 hover:text-white flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Error banner */}
            {orderEditError && (
              <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-400 flex items-center gap-2 flex-shrink-0">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{orderEditError}</span>
              </div>
            )}

            {/* Body */}
            <form onSubmit={handleSaveOrderEdit} className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
              <div className="space-y-3">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Позиции в заказе:</span>
                
                {orderEditItems.map((item, index) => {
                  const blocks = Math.floor(item.quantityPacks / 10);
                  const itemPriceNum = Number(item.price) || 0;
                  const isBonus = itemPriceNum === 0;
                  const itemTotal = Math.round(item.quantityPacks * itemPriceNum * 100) / 100;

                  return (
                    <div key={item.productId} className={`rounded-2xl border p-4 transition-all ${
                      isBonus 
                        ? 'border-amber-500/30 bg-amber-500/5' 
                        : 'border-white/5 bg-slate-950/40'
                    }`}>
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-bold text-slate-200 truncate">{item.name}</h4>
                            {isBonus && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-amber-500/10 border border-amber-500/20 text-amber-400">
                                БОНУС / 0 СУМ
                              </span>
                            )}
                          </div>
                          <span className="block text-[10px] font-mono text-slate-500 mt-0.5">{item.sku}</span>
                        </div>

                        {/* Remove item button */}
                        <button
                          type="button"
                          onClick={() => handleRemoveOrderItem(index)}
                          className="h-7 w-7 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 flex items-center justify-center transition-all flex-shrink-0"
                          title="Удалить позицию из заказа"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Controls grid */}
                      <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                        {/* 1. Quantity in blocks / packs */}
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Количество (блоки)</label>
                          <div className="flex items-center gap-1.5 bg-slate-900 border border-white/10 rounded-xl p-1">
                            <button
                              type="button"
                              onClick={() => handleItemQtyChange(index, item.quantityPacks - 10)}
                              className="h-6 w-6 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 font-bold flex items-center justify-center text-sm"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min="1"
                              value={blocks}
                              onChange={(e) => handleItemQtyChange(index, Math.max(1, parseInt(e.target.value) || 0) * 10)}
                              className="w-14 text-center bg-transparent font-bold text-xs text-slate-100 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleItemQtyChange(index, item.quantityPacks + 10)}
                              className="h-6 w-6 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 font-bold flex items-center justify-center text-sm"
                            >
                              +
                            </button>
                            <span className="text-[10px] text-slate-500 font-bold pr-1">бл. ({item.quantityPacks} шт.)</span>
                          </div>
                        </div>

                        {/* 2. Price per pack & bonus toggle */}
                        <div className="space-y-1">
                          <div className="flex justify-between items-center">
                            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Цена/пачка (сум)</label>
                            <button
                              type="button"
                              onClick={() => handleToggleBonus(index)}
                              className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded transition-all ${
                                isBonus 
                                  ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' 
                                  : 'bg-white/5 text-slate-400 hover:text-white'
                              }`}
                            >
                              {isBonus ? 'Сделать платным' : 'Сделать бонусом (0)'}
                            </button>
                          </div>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={item.price}
                            onChange={(e) => handleItemPriceChange(index, e.target.value)}
                            placeholder="0.00"
                            className="w-full rounded-xl px-3 py-1.5 text-xs glass-input font-bold"
                          />
                        </div>

                        {/* 3. Item total sum */}
                        <div className="space-y-1 text-left sm:text-right">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Сумма позиции:</span>
                          <span className="text-sm font-extrabold text-emerald-400 block">
                            {isBonus ? '0 so\'m (Подарок)' : `${itemTotal.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} so'm`}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add New Product to Order */}
              <div className="pt-2">
                <div className="flex gap-2">
                  <select
                    className="flex-1 rounded-xl px-3 py-2.5 text-xs glass-input focus:bg-slate-900"
                    value={selectedAddProductId}
                    onChange={(e) => setSelectedAddProductId(e.target.value)}
                  >
                    <option value="">-- Добавить марку в заказ --</option>
                    {products.filter(p => p.isActive).map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku}) — {p.basePrice.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} so'm
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddProductToOrder}
                    disabled={!selectedAddProductId}
                    className="px-4 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/25 text-cyan-400 hover:bg-cyan-500/20 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-all"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Добавить</span>
                  </button>
                </div>
              </div>

              {/* Totals Summary */}
              <div className="rounded-2xl border border-white/5 bg-slate-950/60 p-4 space-y-2">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Итого блоков:</span>
                  <strong className="text-slate-200">{editOrderTotals.totalBlocks} блоков ({editOrderTotals.totalCases} коробок)</strong>
                </div>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Итого пачек:</span>
                  <strong className="text-slate-200">{editOrderTotals.totalPacks} шт.</strong>
                </div>
                <div className="flex justify-between text-sm font-bold pt-2 border-t border-white/5">
                  <span className="text-slate-300">Пересчитанная сумма заказа:</span>
                  <span className="text-emerald-400 font-extrabold">{editOrderTotals.totalPrice.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} so'm</span>
                </div>
              </div>

              {/* Footer Buttons */}
              <div className="pt-2 flex items-center justify-end gap-3 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingOrder(null)}
                  className="px-5 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition-all"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={savingOrder}
                  className="btn-primary px-6 py-2.5 text-xs font-bold flex items-center gap-2"
                >
                  {savingOrder ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  <span>Сохранить изменения</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
