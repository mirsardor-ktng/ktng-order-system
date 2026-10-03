'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Briefcase, Download, Filter, Search, UserCheck, AlertCircle, 
  Loader2, DollarSign, Package, Layers, TrendingUp, ShoppingBag, Eye, MessageSquare, 
  BarChart3, Edit, Plus, Trash2, Check, X, Shield, RefreshCw, FileSpreadsheet, Upload, CheckCircle2, Calendar, XCircle,
  ChevronDown, ChevronUp
} from 'lucide-react';
import { breakdownPacks, formatCaseQuantity } from '@/lib/conversion';
import { getTashkentTodayString, getTashkentWeekAgoString } from '@/lib/date-utils';
import { useTranslation } from '@/i18n/context';
import { DocumentPreviewModal } from '@/components/DocumentPreviewModal';

interface CommentItem {
  id: string;
  orderId: string;
  userId: string | null;
  userName: string;
  text: string;
  createdAt: string;
}

export interface OrderDocumentItem {
  id: string;
  orderId: string;
  type: string;
  fileId: string | null;
  fileName: string;
  fileUrl: string;
  mimeType?: string | null;
  fileSize?: number | null;
  createdByUserId?: string | null;
  createdAt: string;
  metadata?: any;
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
  documents?: OrderDocumentItem[];
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
  const router = useRouter();
  const { t, language, localizeError } = useTranslation();
  const locale = language === 'uz' ? 'uz-UZ' : language === 'en' ? 'en-US' : 'ru-RU';

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'DRAFT': return t('orders.statusDraft');
      case 'NEW': return t('orders.statusNew');
      case 'ACCEPTED': return t('orders.statusAccepted');
      case 'ASSEMBLY': return t('orders.statusAssembly');
      case 'SHIPPED': return t('orders.statusShipped');
      case 'COMPLETED': return t('orders.statusCompleted');
      case 'CANCELLED': return t('orders.statusCancelled');
      default: return status;
    }
  };

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
  const [timeFilter, setTimeFilter] = useState<'ALL' | 'TODAY' | 'WEEK' | 'CUSTOM'>('ALL');
  const [draftStartDate, setDraftStartDate] = useState('');
  const [draftEndDate, setDraftEndDate] = useState('');
  const [appliedStartDate, setAppliedStartDate] = useState('');
  const [appliedEndDate, setAppliedEndDate] = useState('');
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
  const [generatingRequestId, setGeneratingRequestId] = useState<string | null>(null);
  const [acceptingOrderId, setAcceptingOrderId] = useState<string | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [totalOrders, setTotalOrders] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);

  const canViewValidation = isSuperadmin || permissions.includes('orders:validation:view') || permissions.includes('*');
  const canAcceptOrder = isSuperadmin || permissions.includes('orders:validation:accept') || permissions.includes('*');
  const canChangeStatus = isSuperadmin || permissions.includes('orders:status_change');
  const canCancelOrder = canChangeStatus;
  const canEditOrders = isSuperadmin || permissions.includes('orders:edit') || permissions.includes('orders:create');
  const canUpdateStock = isSuperadmin || permissions.includes('products:stock_update') || permissions.includes('products:manage');
  const canExportExcel = isSuperadmin || permissions.includes('orders:export');
  const canAddComments = isSuperadmin || permissions.includes('orders:comments') || permissions.length === 0;
  const canCreateWarehouseRequest = isSuperadmin || permissions.includes('orders:warehouse_request:create');
  const canViewWarehouseRequest = isSuperadmin || permissions.includes('orders:warehouse_request:view');
  const canDownloadWarehouseRequest = isSuperadmin || permissions.includes('orders:warehouse_request:download');

  const canUploadLogisticsCodes = isSuperadmin || permissions.includes('orders:logistics_codes:upload');
  const canViewLogisticsCodes = isSuperadmin || permissions.includes('orders:logistics_codes:view');
  const canDownloadLogisticsCodes = isSuperadmin || permissions.includes('orders:logistics_codes:download');

  const canUploadTransportDocs = isSuperadmin || permissions.includes('orders:transport_docs:upload');
  const canViewTransportDocs = isSuperadmin || permissions.includes('orders:transport_docs:view');
  const canDownloadTransportDocs = isSuperadmin || permissions.includes('orders:transport_docs:download');

  const canSeeOrderDocuments =
    canViewWarehouseRequest || canCreateWarehouseRequest || canDownloadWarehouseRequest ||
    canUploadLogisticsCodes || canViewLogisticsCodes || canDownloadLogisticsCodes ||
    canUploadTransportDocs || canViewTransportDocs || canDownloadTransportDocs;

  const [uploadingDocOrderId, setUploadingDocOrderId] = useState<string | null>(null);
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);

  const [previewDoc, setPreviewDoc] = useState<{
    id: string;
    fileName: string;
    uploadedAt?: string;
    fileSize?: number | null;
  } | null>(null);

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes || bytes <= 0) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleUploadDocument = async (orderId: string, type: string, file: File) => {
    try {
      setUploadingDocOrderId(orderId);
      setUploadingDocType(type);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', type);

      const res = await fetch(`/api/orders/${orderId}/documents`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || t('documents.uploadError'));
      }

      showToast(t('documents.uploadSuccess'), 'success');

      // Update state in-place without reloading orders!
      setOrders(prev => prev.map(o => {
        if (o.id === orderId) {
          return {
            ...o,
            documents: [data.document, ...(o.documents || [])]
          };
        }
        return o;
      }));
    } catch (err: any) {
      console.error('Error uploading document:', err);
      showToast(err.message || t('documents.uploadError'), 'error');
    } finally {
      setUploadingDocOrderId(null);
      setUploadingDocType(null);
    }
  };

  const handleGenerateWarehouseRequest = async (orderId: string) => {
    try {
      setGeneratingRequestId(orderId);
      const res = await fetch(`/api/orders/${orderId}/warehouse-request`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate warehouse request');
      }
      showToast(t('documents.warehouseRequestGenerated'), 'success');
      setOrders(prev => prev.map(o => {
        if (o.id === orderId) {
          const docs = o.documents ? [...o.documents.filter(d => d.type !== 'WAREHOUSE_ASSEMBLY_REQUEST')] : [];
          return {
            ...o,
            documents: [data.document, ...docs]
          };
        }
        return o;
      }));
    } catch (err: any) {
      console.error('Error generating warehouse request:', err);
      showToast(err.message || 'Error generating warehouse request', 'error');
    } finally {
      setGeneratingRequestId(null);
    }
  };

  const handleAcceptOrder = async (orderId: string) => {
    try {
      setAcceptingOrderId(orderId);
      const res = await fetch(`/api/orders/${orderId}/accept`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401 && data.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
          router.push('/login?reason=session_expired');
          return;
        }
        throw new Error(data.error || 'Failed to accept order');
      }
      showToast(t('seller.orderAcceptedSuccess'), 'success');
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'ACCEPTED' } : o));
    } catch (err: any) {
      console.error('Error accepting order:', err);
      showToast(err.message || 'Error accepting order', 'error');
    } finally {
      setAcceptingOrderId(null);
    }
  };

  const handleCancelOrder = async (order: Order) => {
    if (order.status === 'SHIPPED' || order.status === 'COMPLETED') {
      showToast('Нельзя отменить исполненный заказ в статусе ' + order.status + '.', 'error');
      return;
    }
    if (order.status === 'CANCELLED') {
      showToast('Заказ уже отменен.', 'error');
      return;
    }

    const reasonPrompt = window.prompt('Укажите причину отмены заказа:', 'Отмена через панель управления');
    if (reasonPrompt === null) return;

    setCancellingOrderId(order.id);
    try {
      const res = await fetch('/api/orders/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, status: 'CANCELLED', reason: reasonPrompt || 'Отмена через панель управления' })
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401 && data.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
          router.push('/login?reason=session_expired');
          return;
        }
        throw new Error(data.error || 'Ошибка отмены заказа');
      }

      showToast(data.message || `Заказ ${order.orderNumber} успешно отменен`, 'success');
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'CANCELLED' } : o));
    } catch (err: any) {
      console.error('Error cancelling order:', err);
      showToast(err.message || 'Ошибка сети при отмене заказа', 'error');
    } finally {
      setCancellingOrderId(null);
    }
  };

  const loadAllOrders = async (
    overrideStart?: string,
    overrideEnd?: string,
    pageOverride?: number,
    sizeOverride?: number,
    statusOverride?: string
  ) => {
    try {
      setLoading(true);
      const start = overrideStart !== undefined ? overrideStart : appliedStartDate;
      const end = overrideEnd !== undefined ? overrideEnd : appliedEndDate;

      const activePage = pageOverride !== undefined ? pageOverride : currentPage;
      const activeSize = sizeOverride !== undefined ? sizeOverride : pageSize;
      const activeStatus = statusOverride !== undefined ? statusOverride : statusFilter;

      const params = new URLSearchParams();
      if (start) params.set('startDate', start);
      if (end) params.set('endDate', end);
      if (activeStatus && activeStatus !== 'ALL') params.set('status', activeStatus);
      params.set('page', String(activePage));
      params.set('pageSize', String(activeSize));

      const qs = params.toString();
      const url = qs ? `/api/orders?${qs}` : '/api/orders';

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data && data.pagination) {
          setOrders(data.orders || []);
          setTotalOrders(data.pagination.total);
          setTotalPages(data.pagination.totalPages);
          setCurrentPage(data.pagination.page);
        } else if (Array.isArray(data)) {
          setOrders(data);
          setTotalOrders(data.length);
          setTotalPages(Math.max(1, Math.ceil(data.length / activeSize)));
        }
      } else if (res.status === 401) {
        const data = await res.json().catch(() => ({}));
        if (data.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
          router.push('/login?reason=session_expired');
        }
      }
    } catch (err) {
      console.error('Failed to load orders', err);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyDateFilter = () => {
    if (draftStartDate && draftEndDate && draftStartDate > draftEndDate) {
      showToast('Дата "От" не может быть позже даты "До"', 'error');
      return;
    }
    setAppliedStartDate(draftStartDate);
    setAppliedEndDate(draftEndDate);
    setTimeFilter('CUSTOM');
    setCurrentPage(1);
    setExpandedOrders(new Set());
    loadAllOrders(draftStartDate, draftEndDate, 1, pageSize, statusFilter);
  };

  const handleResetDateFilter = () => {
    setDraftStartDate('');
    setDraftEndDate('');
    setAppliedStartDate('');
    setAppliedEndDate('');
    setTimeFilter('ALL');
    setCurrentPage(1);
    setExpandedOrders(new Set());
    loadAllOrders('', '', 1, pageSize, statusFilter);
  };

  const handlePresetPeriod = (preset: 'ALL' | 'TODAY' | 'WEEK') => {
    setTimeFilter(preset);
    let start = '';
    let end = '';
    if (preset === 'TODAY') {
      start = getTashkentTodayString();
      end = getTashkentTodayString();
    } else if (preset === 'WEEK') {
      start = getTashkentWeekAgoString();
      end = getTashkentTodayString();
    }
    setDraftStartDate(start);
    setDraftEndDate(end);
    setAppliedStartDate(start);
    setAppliedEndDate(end);
    setCurrentPage(1);
    setExpandedOrders(new Set());
    loadAllOrders(start, end, 1, pageSize, statusFilter);
  };

  const handleStatusFilterChange = (status: string) => {
    setStatusFilter(status);
    setCurrentPage(1);
    setExpandedOrders(new Set());
    loadAllOrders(appliedStartDate, appliedEndDate, 1, pageSize, status);
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
        } else if (meRes.status === 401) {
          const meData = await meRes.json().catch(() => ({}));
          if (meData.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
            router.push('/login?reason=session_expired');
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
        const data = await res.json().catch(() => ({}));
        showToast(data.message || t('seller.statusUpdated', { status: getStatusLabel(newStatus) }));
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus as any, ...(data.order ? { status: data.order.status, updatedAt: data.order.updatedAt } : {}) } : o));
      } else {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 && data.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
          router.push('/login?reason=session_expired');
          return;
        }
        showToast(localizeError(data.error) || t('seller.statusUpdateError'), 'error');
      }
    } catch {
      showToast(t('seller.networkError'), 'error');
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
        showToast(t('seller.stockUpdated', { product: editingStockProduct.name }));
        setEditingStockProduct(null);
        loadProducts();
      } else {
        showToast(localizeError(data.error) || t('seller.stockUpdateError'), 'error');
      }
    } catch {
      showToast(t('seller.networkError'), 'error');
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
      name: i.productNameSnapshot || i.product?.name || t('seller.product'),
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
      setOrderEditError(t('seller.atLeastOneItemRequired'));
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
      setOrderEditError(t('seller.specifyQuantityError'));
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
        showToast(t('seller.orderUpdatedSuccess', { orderNumber: editingOrder.orderNumber }));
        setEditingOrder(null);
        loadAllOrders();
      } else {
        setOrderEditError(localizeError(data.error) || t('seller.orderUpdateError'));
      }
    } catch {
      setOrderEditError(t('seller.networkError'));
    } finally {
      setSavingOrder(false);
    }
  };

  // Live calculation for order edit modal
  const editOrderTotals = useMemo(() => {
    const totalPacks = orderEditItems.reduce((sum, i) => sum + i.quantityPacks, 0);
    const totalBlocks = Math.floor(totalPacks / 10);
    const totalCases = Math.round((totalPacks / 500) * 100) / 100;
    const totalPrice = Math.round(orderEditItems.reduce((sum, i) => {
      const unitPrice = Math.round((Number(i.price) || 0) * 100) / 100;
      const lineTotal = Math.round(i.quantityPacks * unitPrice * 100) / 100;
      return sum + lineTotal;
    }, 0) * 100) / 100;
    return { totalPacks, totalBlocks, totalCases, totalPrice };
  }, [orderEditItems]);

  // Filtered orders list (date filtering is performed server-side)
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchSearch = order.customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          order.customer.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          order.orderNumber.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchStatus = statusFilter === 'ALL' || order.status === statusFilter;

      return matchSearch && matchStatus;
    });
  }, [orders, searchTerm, statusFilter]);

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
        return <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">{t('orders.statusDraft')}</span>;
      case 'NEW':
        return <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">{t('orders.statusNew')}</span>;
      case 'ACCEPTED':
        return <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-blue-500/10 border border-blue-500/20 text-blue-400">{t('orders.statusAccepted')}</span>;
      case 'ASSEMBLY':
        return <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-500/10 border border-amber-500/20 text-amber-400">{t('orders.statusAssembly')}</span>;
      case 'SHIPPED':
        return <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">{t('orders.statusShipped')}</span>;
      case 'COMPLETED':
        return <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">{t('orders.statusCompleted')}</span>;
      case 'CANCELLED':
        return <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-red-500/10 border border-red-500/20 text-red-400">{t('orders.statusCancelled')}</span>;
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
          <span>{t('seller.incomingOrders')}</span>
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
          <span>{t('seller.skuMonitoring')}</span>
        </button>
        <a
          href="/analytics"
          className="px-5 py-3 text-xs font-extrabold uppercase tracking-wider transition-all border-b-2 border-transparent text-slate-400 hover:text-white hover:bg-white/5 flex items-center gap-2"
        >
          <BarChart3 className="w-4 h-4 text-cyan-400" />
          <span>{t('navigation.analytics')}</span>
        </a>
      </div>

      {activeTab === 'orders' ? (
        <>
          {/* 1. Dashboard Sales metrics cards grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-indigo-500">
              <div className="flex justify-between items-center text-slate-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">{t('seller.totalSalesVolume')}</span>
                <DollarSign className="h-4.5 w-4.5 text-indigo-400" />
              </div>
              <span className="block mt-2 text-xl font-extrabold text-slate-100">{metrics.revenue.toLocaleString(locale)} so'm</span>
              <span className="block mt-1 text-[9px] text-slate-500 font-semibold">{t('seller.activeOrdersSum')}</span>
            </div>

            <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-cyan-500">
              <div className="flex justify-between items-center text-slate-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">{t('seller.casesShipped')}</span>
                <Package className="h-4.5 w-4.5 text-cyan-400" />
              </div>
              <span className="block mt-2 text-xl font-extrabold text-slate-100">{metrics.cases} {t('units.casesShort')}</span>
              <span className="block mt-1 text-[9px] text-slate-500 font-semibold">{t('seller.casesConversionHint')}</span>
            </div>

            <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-emerald-500">
              <div className="flex justify-between items-center text-slate-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">{t('orders.orders')}</span>
                <ShoppingBag className="h-4.5 w-4.5 text-emerald-400" />
              </div>
              <span className="block mt-2 text-xl font-extrabold text-slate-100">{totalOrders.toLocaleString(locale)}</span>
              <span className="block mt-1 text-[9px] text-slate-500 font-semibold">{language === 'uz' ? 'Jami buyurtmalar soni' : language === 'en' ? 'Total orders count' : 'Всего оформлено заказов'}</span>
            </div>

            <div className="glass-panel rounded-2xl p-5 border-l-4 border-l-amber-500">
              <div className="flex justify-between items-center text-slate-400">
                <span className="text-[10px] font-bold uppercase tracking-wider">{t('seller.activeClients')}</span>
                <UserCheck className="h-4.5 w-4.5 text-amber-400" />
              </div>
              <span className="block mt-2 text-xl font-extrabold text-slate-100">{metrics.uniqueClients} {t('seller.companiesCount')}</span>
              <span className="block mt-1 text-[9px] text-slate-500 font-semibold">{t('seller.madeAtLeastOneOrder')}</span>
            </div>
          </div>

          {/* 2. Control Filter Bar */}
          <div className="glass-panel rounded-2xl p-4 flex flex-col xl:flex-row gap-4 items-center justify-between">
            <div className="relative w-full xl:w-80 flex-shrink-0">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                className="w-full rounded-xl pl-9 pr-4 py-2.5 text-xs glass-input"
                placeholder={t('seller.searchOrdersPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto xl:justify-end">
              <div className="flex items-center gap-1.5 bg-slate-950/40 p-1.5 rounded-xl border border-white/5 overflow-x-auto max-w-full">
                <span className="text-[9px] text-slate-500 font-bold uppercase px-1.5 whitespace-nowrap">{t('orders.status')}:</span>
                {['ALL', 'NEW', 'ACCEPTED', 'ASSEMBLY', 'SHIPPED', 'COMPLETED', 'CANCELLED'].map(status => (
                  <button
                    key={status}
                    onClick={() => handleStatusFilterChange(status)}
                    className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all whitespace-nowrap ${
                      statusFilter === status 
                        ? 'bg-cyan-600 text-white shadow-glass-sm' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {status === 'ALL' ? t('common.all') : getStatusLabel(status)}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5 bg-slate-950/40 p-1.5 rounded-xl border border-white/5 flex-shrink-0">
                <span className="text-[9px] text-slate-500 font-bold uppercase px-1.5">{t('seller.period')}:</span>
                {(['ALL', 'TODAY', 'WEEK'] as const).map(time => (
                  <button
                    key={time}
                    onClick={() => handlePresetPeriod(time)}
                    className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all ${
                      timeFilter === time 
                        ? 'bg-cyan-600 text-white shadow-glass-sm' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {time === 'ALL' ? t('common.all') : time === 'TODAY' ? t('seller.today') : t('seller.week')}
                  </button>
                ))}
              </div>

              {/* Date Filter Inputs - ALWAYS VISIBLE */}
              <div className="flex flex-wrap items-center gap-2 bg-slate-950/40 p-1.5 rounded-xl border border-white/5 flex-shrink-0 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-400 font-medium">{language === 'uz' ? 'Dan:' : language === 'en' ? 'From:' : 'От:'}</span>
                  <input
                    type="date"
                    value={draftStartDate}
                    onChange={(e) => setDraftStartDate(e.target.value)}
                    className="bg-slate-900/80 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-400 font-medium">{language === 'uz' ? 'Gacha:' : language === 'en' ? 'To:' : 'До:'}</span>
                  <input
                    type="date"
                    value={draftEndDate}
                    onChange={(e) => setDraftEndDate(e.target.value)}
                    className="bg-slate-900/80 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleApplyDateFilter}
                  className="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-glass-sm"
                >
                  {t('common.apply')}
                </button>
                {(draftStartDate || draftEndDate || appliedStartDate || appliedEndDate) && (
                  <button
                    type="button"
                    onClick={handleResetDateFilter}
                    className="px-2 py-1 text-[10px] font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all"
                  >
                    {language === 'uz' ? 'Bekor qilish' : language === 'en' ? 'Reset' : 'Сбросить'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 3. Orders Board Table List */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-200 text-base flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-cyan-400" />
                <span>{t('seller.incomingOrdersJournal', { count: totalOrders || filteredOrders.length })}</span>
              </h3>
            </div>

            {filteredOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center glass-panel rounded-2xl animate-fade-in">
                <AlertCircle className="h-10 w-10 text-slate-500 mb-4" />
                <h3 className="text-lg font-bold text-slate-300">{t('seller.ordersNotFound')}</h3>
                <p className="text-xs text-slate-400 mt-2">{t('seller.ordersNotFoundDesc')}</p>
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

                  const isEditable = order.status === 'DRAFT' || order.status === 'NEW';
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
                          <span className="text-xs text-slate-300 font-semibold">
                            {order.customer.name}
                          </span>
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
                          {/* Customer line */}
                          <div className="text-[11px] text-slate-400 font-semibold">
                            {t('orders.customer')}: <span className="text-slate-200 font-bold">{order.customer.name}</span> ({order.customer.email})
                          </div>

                          {/* SKU breakdown details grid */}
                      <div className="py-1">
                        <span className="block text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-2">{t('seller.purchaseList')}</span>
                        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                          {order.items.map((item) => {
                            const breakdown = breakdownPacks(item.quantityPacks, {
                              cases: t('units.casesShort'),
                              blocks: t('units.blocksShort')
                            });
                            return (
                              <div key={item.id} className="bg-slate-950/20 border border-white/5 rounded-xl p-2.5 flex justify-between items-center text-xs">
                                <div>
                                  <span className="block font-bold text-slate-300 line-clamp-1">{item.productNameSnapshot || item.product?.name || t('common.unknown')}</span>
                                  <span className="block text-[9px] text-slate-500 font-semibold mt-0.5">{item.skuSnapshot || item.product?.sku || t('common.unknown')}</span>
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
                            <span>{t('orders.comment')}</span>
                          </h4>
                          
                          {order.comments && order.comments.length > 0 ? (
                            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                              {order.comments.map((comment) => {
                                const commentDate = new Date(comment.createdAt).toLocaleString(locale, {
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
                            <p className="text-[10px] text-slate-500 italic px-1">{t('seller.noCommentsYet')}</p>
                          )}

                          <div className="flex gap-2">
                            <input 
                              type="text"
                              placeholder={t('orders.commentPlaceholder')}
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
                              {t('orders.sendComment')}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Actions & Summary breakdown footer */}
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-3 border-t border-white/5 w-full">
                        <div className="text-[10px] text-slate-400 font-semibold">
                          {t('seller.volume')}: <span className="text-slate-200 font-bold">{formatCaseQuantity(totalOrderPacks)} {t('units.cases')}</span>
                          <span className="ml-3 text-slate-500">({date})</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto sm:justify-end">
                          {/* Order Edit button if authorized */}
                          {canEditOrders && isEditable && (
                            <button
                              onClick={() => openEditOrderModal(order)}
                              className="px-3 py-1.5 rounded-xl border border-indigo-500/25 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 text-xs font-bold flex items-center gap-1.5 transition-all"
                              title={t('seller.editOrder')}
                            >
                              <Edit className="h-3.5 w-3.5" />
                              <span>{t('seller.editOrder')}</span>
                            </button>
                          )}

                          {/* Accept button for order validation */}
                          {canAcceptOrder && order.status === 'NEW' && (
                            <button
                              onClick={() => handleAcceptOrder(order.id)}
                              disabled={acceptingOrderId === order.id}
                              className="px-3 py-1.5 rounded-xl border border-blue-500/30 bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
                              title={t('seller.acceptOrder')}
                            >
                              {acceptingOrderId === order.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              )}
                              <span>{acceptingOrderId === order.id ? t('seller.acceptingOrder') : t('seller.acceptOrder')}</span>
                            </button>
                          )}

                          {/* Cancel button if authorized */}
                          {canCancelOrder && order.status !== 'SHIPPED' && order.status !== 'COMPLETED' && order.status !== 'CANCELLED' && (
                            <button
                              onClick={() => handleCancelOrder(order)}
                              disabled={cancellingOrderId === order.id}
                              className="px-3 py-1.5 rounded-xl border border-rose-500/30 bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
                              title="Отменить заказ"
                            >
                              {cancellingOrderId === order.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5" />
                              )}
                              <span>{cancellingOrderId === order.id ? 'Отмена...' : 'Отменить'}</span>
                            </button>
                          )}

                          {/* Status changer select if authorized */}
                          {order.status !== 'DRAFT' && (
                            canChangeStatus ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-slate-500 font-bold uppercase whitespace-nowrap">{t('orders.status')}:</span>
                                <select
                                  value={order.status}
                                  onChange={(e) => handleStatusChange(order.id, e.target.value)}
                                  className="bg-slate-900 border border-white/10 rounded-lg py-1 px-2.5 text-[10px] font-bold text-slate-300 focus:outline-none focus:border-cyan-500/50 transition-all cursor-pointer"
                                >
                                  <option value="NEW">{t('orders.statusNew')}</option>
                                  <option value="ACCEPTED">{t('orders.statusAccepted')}</option>
                                  <option value="ASSEMBLY">{t('orders.statusAssembly')}</option>
                                  <option value="SHIPPED">{t('orders.statusShipped')}</option>
                                  <option value="COMPLETED">{t('orders.statusCompleted')}</option>
                                  <option value="CANCELLED">{t('orders.statusCancelled')}</option>
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
                                title={t('seller.downloadExcel')}
                              >
                                <Download className="h-3.5 w-3.5" />
                                <span>Excel</span>
                              </a>
                            ) : order.status === 'DRAFT' ? (
                              <span className="text-slate-500 text-[10px] py-1 px-2.5 border border-dashed border-white/5 rounded-lg whitespace-nowrap">
                                {t('orders.statusDraft')}
                              </span>
                            ) : (
                              <span className="text-red-400 bg-red-500/10 border border-red-500/20 text-[10px] font-bold py-1 px-2.5 rounded-lg whitespace-nowrap">
                                {t('seller.noExcel')}
                              </span>
                            )
                          )}
                        </div>
                      </div>

                      {/* Order Documents Section */}
                      {canSeeOrderDocuments && (
                        <div className="pt-3 border-t border-white/5 w-full bg-slate-950/30 p-4 rounded-xl border border-white/5 space-y-4">
                          <div className="flex items-center gap-2">
                            <FileSpreadsheet className="h-4 w-4 text-emerald-400 shrink-0" />
                            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                              {t('documents.orderDocuments')}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                            {/* 1. Запрос на сборку (Warehouse Assembly Request) */}
                            {(canViewWarehouseRequest || canCreateWarehouseRequest || canDownloadWarehouseRequest) && (
                              <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 flex flex-col justify-between gap-3">
                                <div>
                                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                                    <span>{t('documents.warehouseAssemblyRequest')}</span>
                                  </div>
                                  {(() => {
                                    const whDoc = order.documents?.find(d => d.type === 'WAREHOUSE_ASSEMBLY_REQUEST');
                                    if (whDoc) {
                                      const outboundNum = (whDoc.metadata as any)?.outboundNumber;
                                      return (
                                        <div className="space-y-1">
                                          <div className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono font-bold">
                                            {t('documents.outboundNumber')}: {outboundNum || whDoc.fileName}
                                          </div>
                                          <div className="text-[11px] text-slate-400">
                                            {new Date(whDoc.createdAt).toLocaleString(locale)}
                                          </div>
                                        </div>
                                      );
                                    }
                                    return <div className="text-xs text-slate-500 italic">{t('documents.noFiles')}</div>;
                                  })()}
                                </div>

                                <div className="flex items-center gap-2 flex-wrap">
                                  {canCreateWarehouseRequest && (
                                    <button
                                      onClick={() => handleGenerateWarehouseRequest(order.id)}
                                      disabled={generatingRequestId === order.id}
                                      className="px-2.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
                                      title={t('documents.generateWarehouseRequest')}
                                    >
                                      {generatingRequestId === order.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <FileSpreadsheet className="h-3.5 w-3.5" />
                                      )}
                                      <span>
                                        {generatingRequestId === order.id
                                          ? t('documents.generatingWarehouseRequest')
                                          : t('documents.generateWarehouseRequest')}
                                      </span>
                                    </button>
                                  )}

                                  {canDownloadWarehouseRequest && (() => {
                                    const whDoc = order.documents?.find(d => d.type === 'WAREHOUSE_ASSEMBLY_REQUEST');
                                    if (!whDoc) return null;
                                    return (
                                      <a
                                        href={`/api/orders/documents/${whDoc.id}/download`}
                                        download
                                        className="btn-primary flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-bold"
                                        title={t('documents.downloadWarehouseRequest')}
                                      >
                                        <Download className="h-3.5 w-3.5" />
                                        <span>{t('documents.downloadWarehouseRequest')}</span>
                                      </a>
                                    );
                                  })()}
                                </div>
                              </div>
                            )}

                            {/* 2. Коды от Логистики (Logistics Codes) */}
                            {(canViewLogisticsCodes || canUploadLogisticsCodes || canDownloadLogisticsCodes) && (
                              <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 flex flex-col justify-between gap-3">
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                                      {t('documents.logisticsCodes')}
                                    </span>
                                    {canUploadLogisticsCodes && (
                                      <label className="cursor-pointer inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 border border-indigo-500/30 text-xs font-medium transition-colors">
                                        <Upload className="h-3 w-3" />
                                        <span>{uploadingDocOrderId === order.id && uploadingDocType === 'LOGISTICS_CODES' ? t('documents.uploading') : t('documents.uploadFile')}</span>
                                        <input
                                          type="file"
                                          accept=".xlsx,.xls,.csv,.pdf"
                                          className="hidden"
                                          disabled={uploadingDocOrderId === order.id}
                                          onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            if (f) {
                                              handleUploadDocument(order.id, 'LOGISTICS_CODES', f);
                                              e.target.value = '';
                                            }
                                          }}
                                        />
                                      </label>
                                    )}
                                  </div>

                                  {/* List of Logistics Codes Files */}
                                  {(() => {
                                    const codeDocs = order.documents?.filter(d => d.type === 'LOGISTICS_CODES') || [];
                                    if (codeDocs.length === 0) {
                                      return <div className="text-xs text-slate-500 italic">{t('documents.noFiles')}</div>;
                                    }
                                    return (
                                      <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                                        {codeDocs.map(doc => (
                                          <div
                                            key={doc.id}
                                            className="flex items-center justify-between gap-2 p-1.5 rounded bg-slate-950/40 border border-slate-800 text-xs"
                                          >
                                            <div className="min-w-0 flex-1">
                                              <p className="text-slate-200 truncate font-medium" title={doc.fileName}>
                                                {doc.fileName}
                                              </p>
                                              <p className="text-[10px] text-slate-400 flex items-center gap-2">
                                                <span>{new Date(doc.createdAt).toLocaleDateString(locale)}</span>
                                                {doc.fileSize ? <span>{formatFileSize(doc.fileSize)}</span> : null}
                                              </p>
                                            </div>
                                            {canDownloadLogisticsCodes && (
                                              <a
                                                href={`/api/orders/documents/${doc.id}/download`}
                                                download
                                                className="p-1 rounded text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors shrink-0"
                                                title={t('documents.download')}
                                              >
                                                <Download className="h-3.5 w-3.5" />
                                              </a>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            )}

                            {/* 3. Транспортные документы (Transport Docs: Driver License & Vehicle Reg) */}
                            {(canViewTransportDocs || canUploadTransportDocs || canDownloadTransportDocs) && (
                              <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 flex flex-col justify-between gap-3">
                                <div className="space-y-3">
                                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                                    {t('documents.driverLicense')} / {t('documents.vehicleRegistration')}
                                  </div>

                                  {/* Sub-section: Driver License */}
                                  <div className="space-y-1.5">
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="text-slate-300 font-semibold">{t('documents.driverLicense')}</span>
                                      {canUploadTransportDocs && (
                                        <label className="cursor-pointer inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 border border-indigo-500/30 text-[11px] font-medium transition-colors">
                                          <Upload className="h-2.5 w-2.5" />
                                          <span>{uploadingDocOrderId === order.id && uploadingDocType === 'DRIVER_LICENSE_PHOTO' ? t('documents.uploading') : t('documents.uploadFile')}</span>
                                          <input
                                            type="file"
                                            accept="image/jpeg,image/png,image/webp"
                                            className="hidden"
                                            disabled={uploadingDocOrderId === order.id}
                                            onChange={(e) => {
                                              const f = e.target.files?.[0];
                                              if (f) {
                                                handleUploadDocument(order.id, 'DRIVER_LICENSE_PHOTO', f);
                                                e.target.value = '';
                                              }
                                            }}
                                          />
                                        </label>
                                      )}
                                    </div>
                                    {(() => {
                                      const driverDocs = order.documents?.filter(d => d.type === 'DRIVER_LICENSE_PHOTO') || [];
                                      if (driverDocs.length === 0) {
                                        return <div className="text-[11px] text-slate-500 italic">{t('documents.noFiles')}</div>;
                                      }
                                      return (
                                        <div className="space-y-1">
                                          {driverDocs.map(doc => (
                                            <div
                                              key={doc.id}
                                              className="flex items-center justify-between gap-2 p-1 rounded bg-slate-950/40 border border-slate-800 text-xs"
                                            >
                                              <span className="text-slate-300 truncate font-mono text-[11px] flex-1" title={doc.fileName}>
                                                {doc.fileName}
                                              </span>
                                              <div className="flex items-center gap-1 shrink-0">
                                                {canViewTransportDocs && (
                                                  <button
                                                    onClick={() => setPreviewDoc({ id: doc.id, fileName: doc.fileName, uploadedAt: doc.createdAt, fileSize: doc.fileSize })}
                                                    className="p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-800 transition-colors"
                                                    title={t('documents.preview')}
                                                  >
                                                    <Eye className="h-3.5 w-3.5" />
                                                  </button>
                                                )}
                                                {canDownloadTransportDocs && (
                                                  <a
                                                    href={`/api/orders/documents/${doc.id}/download`}
                                                    download
                                                    className="p-1 rounded text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors"
                                                    title={t('documents.download')}
                                                  >
                                                    <Download className="h-3.5 w-3.5" />
                                                  </a>
                                                )}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      );
                                    })()}
                                  </div>

                                  {/* Sub-section: Vehicle Registration */}
                                  <div className="space-y-1.5 pt-2 border-t border-slate-800">
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="text-slate-300 font-semibold">{t('documents.vehicleRegistration')}</span>
                                      {canUploadTransportDocs && (
                                        <label className="cursor-pointer inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 border border-indigo-500/30 text-[11px] font-medium transition-colors">
                                          <Upload className="h-2.5 w-2.5" />
                                          <span>{uploadingDocOrderId === order.id && uploadingDocType === 'VEHICLE_REGISTRATION_PHOTO' ? t('documents.uploading') : t('documents.uploadFile')}</span>
                                          <input
                                            type="file"
                                            accept="image/jpeg,image/png,image/webp"
                                            className="hidden"
                                            disabled={uploadingDocOrderId === order.id}
                                            onChange={(e) => {
                                              const f = e.target.files?.[0];
                                              if (f) {
                                                handleUploadDocument(order.id, 'VEHICLE_REGISTRATION_PHOTO', f);
                                                e.target.value = '';
                                              }
                                            }}
                                          />
                                        </label>
                                      )}
                                    </div>
                                    {(() => {
                                      const vehicleDocs = order.documents?.filter(d => d.type === 'VEHICLE_REGISTRATION_PHOTO') || [];
                                      if (vehicleDocs.length === 0) {
                                        return <div className="text-[11px] text-slate-500 italic">{t('documents.noFiles')}</div>;
                                      }
                                      return (
                                        <div className="space-y-1">
                                          {vehicleDocs.map(doc => (
                                            <div
                                              key={doc.id}
                                              className="flex items-center justify-between gap-2 p-1 rounded bg-slate-950/40 border border-slate-800 text-xs"
                                            >
                                              <span className="text-slate-300 truncate font-mono text-[11px] flex-1" title={doc.fileName}>
                                                {doc.fileName}
                                              </span>
                                              <div className="flex items-center gap-1 shrink-0">
                                                {canViewTransportDocs && (
                                                  <button
                                                    onClick={() => setPreviewDoc({ id: doc.id, fileName: doc.fileName, uploadedAt: doc.createdAt, fileSize: doc.fileSize })}
                                                    className="p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-slate-800 transition-colors"
                                                    title={t('documents.preview')}
                                                  >
                                                    <Eye className="h-3.5 w-3.5" />
                                                  </button>
                                                )}
                                                {canDownloadTransportDocs && (
                                                  <a
                                                    href={`/api/orders/documents/${doc.id}/download`}
                                                    download
                                                    className="p-1 rounded text-slate-400 hover:text-emerald-400 hover:bg-slate-800 transition-colors"
                                                    title={t('documents.download')}
                                                  >
                                                    <Download className="h-3.5 w-3.5" />
                                                  </a>
                                                )}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Controls */}
        {(totalPages > 1 || totalOrders > 25) && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 glass-panel rounded-2xl border border-white/5 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400">Показывать по:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  const newSize = Number(e.target.value);
                  setPageSize(newSize);
                  setCurrentPage(1);
                  setExpandedOrders(new Set());
                  loadAllOrders(undefined, undefined, 1, newSize, statusFilter);
                }}
                className="bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:border-cyan-500 cursor-pointer"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span className="text-[11px] text-slate-500">из {totalOrders} заказов</span>
            </div>

            <div className="flex items-center gap-3">
              <button
                disabled={currentPage <= 1 || loading}
                onClick={() => {
                  const p = currentPage - 1;
                  setCurrentPage(p);
                  setExpandedOrders(new Set());
                  loadAllOrders(undefined, undefined, p, pageSize, statusFilter);
                }}
                className="px-3 py-1.5 rounded-xl border border-white/10 bg-slate-900/60 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-xs font-semibold text-slate-300"
              >
                {language === 'uz' ? 'Orqaga' : language === 'en' ? 'Previous' : 'Назад'}
              </button>
              <span className="font-bold text-slate-200 text-xs px-2">
                {currentPage} / {totalPages}
              </span>
              <button
                disabled={currentPage >= totalPages || loading}
                onClick={() => {
                  const p = currentPage + 1;
                  setCurrentPage(p);
                  setExpandedOrders(new Set());
                  loadAllOrders(undefined, undefined, p, pageSize, statusFilter);
                }}
                className="px-3 py-1.5 rounded-xl border border-white/10 bg-slate-900/60 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-xs font-semibold text-slate-300"
              >
                {language === 'uz' ? 'Oldinga' : language === 'en' ? 'Next' : 'Вперед'}
              </button>
            </div>
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
                <span>{t('seller.catalogMonitoring')}</span>
              </h3>
              <span className="text-[10px] text-slate-500 font-semibold block mt-0.5">
                {t('seller.catalogMonitoringDesc')}
              </span>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="text"
                className="w-full rounded-xl pl-9 pr-4 py-2 text-xs glass-input"
                placeholder={t('seller.searchCatalogPlaceholder')}
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
              <p className="text-xs text-slate-400">{t('products.noProductsFound')}</p>
            </div>
          ) : (
            <div className="glass-panel rounded-3xl overflow-hidden border border-white/5 animate-fade-in shadow-glass-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 bg-slate-950/40 text-[10px] text-slate-400 uppercase tracking-wider font-extrabold">
                      <th className="py-4 px-6">{t('seller.tableCover')}</th>
                      <th className="py-4 px-6">{t('products.sku')}</th>
                      <th className="py-4 px-6">{t('products.name')}</th>
                      <th className="py-4 px-6">{t('seller.pricePerPack')}</th>
                      <th className="py-4 px-6">{t('seller.pricePerBlock')}</th>
                      <th className="py-4 px-6">{t('seller.stockBalance')}</th>
                      <th className="py-4 px-6">{t('seller.showcase')}</th>
                      {canUpdateStock && <th className="py-4 px-6 text-right">{t('seller.actions')}</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-xs">
                    {filteredProducts.map((p) => {
                      const caseQty = Math.floor(p.stockPacks / 500);
                      const blockQty = Math.floor((p.stockPacks % 500) / 10);
                      const packQty = p.stockPacks % 10;
                      const detailStock = `${caseQty} ${t('units.casesShort')}  ${blockQty} ${t('units.blocksShort')}` + (packQty > 0 ? `  ${packQty} ${t('units.pieces')}` : '');

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
                          <td className="py-4 px-6 font-bold text-slate-300">{p.basePrice.toLocaleString(locale)} so'm</td>
                          <td className="py-4 px-6 font-bold text-primary-focus">{(p.basePrice * 10).toLocaleString(locale)} so'm</td>
                          <td className="py-4 px-6">
                            <div className="font-bold text-slate-100">{p.stockPacks.toLocaleString(locale)} {t('units.pieces')}</div>
                            <div className="text-[10px] text-slate-500 font-semibold mt-0.5">({detailStock})</div>
                          </td>
                          <td className="py-4 px-6">
                            <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-extrabold tracking-wider border ${
                              p.isActive 
                                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                                : 'bg-red-500/10 border-red-500/20 text-red-400'
                            }`}>
                              {p.isActive ? t('seller.statusActive') : t('seller.statusHidden')}
                            </span>
                          </td>
                          {canUpdateStock && (
                            <td className="py-4 px-6 text-right">
                              <button
                                onClick={() => openStockModal(p)}
                                className="px-3 py-1.5 rounded-lg border border-cyan-500/25 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 text-xs font-bold inline-flex items-center gap-1.5 transition-all"
                                title={t('seller.editStock')}
                              >
                                <Edit className="h-3.5 w-3.5" />
                                <span>{t('seller.editStock')}</span>
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
              <span>{t('seller.editStockModalTitle')}</span>
            </h3>

            <div className="bg-slate-900/60 p-3.5 rounded-xl border border-white/5 space-y-1 mb-4">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">{t('seller.product')}</span>
              <p className="text-sm font-extrabold text-slate-100">{editingStockProduct.name}</p>
              <p className="text-xs text-slate-400 font-mono">{t('products.sku')}: {editingStockProduct.sku}</p>
            </div>

            <form onSubmit={handleSaveStock} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {t('seller.newStockPacksLabel')}
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
                    <span className="text-slate-400">{t('seller.inBlocks')}</span>
                    <strong className="text-cyan-400">{Math.floor((Number(stockPacksValue) || 0) / 10)} {t('units.blocks')}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">{t('seller.inCases')}</span>
                    <strong className="text-indigo-400">{Math.round(((Number(stockPacksValue) || 0) / 500) * 100) / 100} {t('units.cases')}</strong>
                  </div>
                </div>

                {/* Quick Add Buttons */}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setStockPacksValue(prev => (Number(prev) || 0) + 100)}
                    className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[10px] font-bold text-slate-300"
                  >
                    +10 {t('units.blocks')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStockPacksValue(prev => (Number(prev) || 0) + 500)}
                    className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[10px] font-bold text-slate-300"
                  >
                    +1 {t('units.perCase')} (500)
                  </button>
                  <button
                    type="button"
                    onClick={() => setStockPacksValue(prev => (Number(prev) || 0) + 2500)}
                    className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[10px] font-bold text-slate-300"
                  >
                    +5 {t('units.cases')}
                  </button>
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setEditingStockProduct(null)}
                  className="flex-1 py-2.5 rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-slate-300 hover:bg-white/10"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={savingStock}
                  className="btn-primary flex-1 py-2.5 text-xs font-bold flex items-center justify-center gap-2"
                >
                  {savingStock ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  <span>{t('seller.saveStock')}</span>
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
                    {t('seller.editOrderModalTitle', { orderNumber: editingOrder.orderNumber })}
                  </h3>
                  <span className="block text-xs text-slate-400">
                    {t('orders.customer')}: <strong className="text-slate-200">{editingOrder.customer.name}</strong> • {t('orders.status')}: {getStatusLabel(editingOrder.status)}
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
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">{t('seller.orderItemsHeader')}</span>
                
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
                                {t('seller.bonusFree')}
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
                          title={t('seller.removeItemTitle')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Controls grid */}
                      <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                        {/* 1. Quantity in blocks / packs */}
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">{t('seller.quantityBlocksLabel')}</label>
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
                            <span className="text-[10px] text-slate-500 font-bold pr-1">{t('units.blocksShort')} ({item.quantityPacks} {t('units.pieces')})</span>
                          </div>
                        </div>

                        {/* 2. Price per pack & bonus toggle */}
                        <div className="space-y-1">
                          <div className="flex justify-between items-center">
                            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">{t('seller.pricePerPackLabel')}</label>
                            <button
                              type="button"
                              onClick={() => handleToggleBonus(index)}
                              className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded transition-all ${
                                isBonus 
                                  ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' 
                                  : 'bg-white/5 text-slate-400 hover:text-white'
                              }`}
                            >
                              {isBonus ? t('seller.makePaid') : t('seller.makeBonus')}
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
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">{t('seller.itemTotalLabel')}</span>
                          <span className="text-sm font-extrabold text-emerald-400 block">
                            {isBonus ? t('seller.giftZeroSum') : `${itemTotal.toLocaleString(locale, { maximumFractionDigits: 2 })} so'm`}
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
                    <option value="">{t('seller.selectProductToAdd')}</option>
                    {products.filter(p => p.isActive).map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku}) — {p.basePrice.toLocaleString(locale, { maximumFractionDigits: 2 })} so'm
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
                    <span>{t('common.add')}</span>
                  </button>
                </div>
              </div>

              {/* Totals Summary */}
              <div className="rounded-2xl border border-white/5 bg-slate-950/60 p-4 space-y-2">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>{t('seller.totalBlocksSummary')}:</span>
                  <strong className="text-slate-200">{editOrderTotals.totalBlocks} {t('units.blocks')} ({editOrderTotals.totalCases} {t('units.cases')})</strong>
                </div>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>{t('seller.totalPacksSummary')}:</span>
                  <strong className="text-slate-200">{editOrderTotals.totalPacks} {t('units.pieces')}</strong>
                </div>
                <div className="flex justify-between text-sm font-bold pt-2 border-t border-white/5">
                  <span className="text-slate-300">{t('seller.recalculatedOrderTotal')}:</span>
                  <span className="text-emerald-400 font-extrabold">{editOrderTotals.totalPrice.toLocaleString(locale, { maximumFractionDigits: 2 })} so'm</span>
                </div>
              </div>

              {/* Footer Buttons */}
              <div className="pt-2 flex items-center justify-end gap-3 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingOrder(null)}
                  className="px-5 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition-all"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={savingOrder}
                  className="btn-primary px-6 py-2.5 text-xs font-bold flex items-center gap-2"
                >
                  {savingOrder ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  <span>{t('seller.saveChanges')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transport Document Preview Modal */}
      <DocumentPreviewModal
        isOpen={!!previewDoc}
        onClose={() => setPreviewDoc(null)}
        documentId={previewDoc?.id || ''}
        fileName={previewDoc?.fileName || ''}
        uploadedAt={previewDoc?.uploadedAt}
        fileSize={previewDoc?.fileSize}
        canDownload={canDownloadTransportDocs}
      />
    </div>
  );
}
