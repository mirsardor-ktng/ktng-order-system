'use client';

import { useState, useEffect } from 'react';
import {
  ShoppingBag, Plus, Edit, Star, Check, AlertCircle,
  Loader2, X, Trash2, Tag, Layers, RefreshCw
} from 'lucide-react';

interface TagItem {
  id: string;
  name: string;
  color: string;
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
  tags: TagItem[];
}

export default function AdminProducts() {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [allTags, setAllTags] = useState<TagItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  // Active SKU item under modification
  const [activeProduct, setActiveProduct] = useState<ProductItem | null>(null);

  // Form states
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [basePrice, setBasePrice] = useState<number | ''>('');
  const [stockPacks, setStockPacks] = useState<number | ''>('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [deletingImage, setDeletingImage] = useState(false);
  const [newImageFile, setNewImageFile] = useState<File | null>(null);
  const [newImagePreview, setNewImagePreview] = useState<string>('');

  // Single Delete modal state
  const [productToDelete, setProductToDelete] = useState<ProductItem | null>(null);
  const [deletingProduct, setDeletingProduct] = useState(false);

  // Bulk actions states
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [showBulkPriceModal, setShowBulkPriceModal] = useState(false);
  const [showBulkTagsModal, setShowBulkTagsModal] = useState(false);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [bulkPrice, setBulkPrice] = useState<number | ''>('');
  const [bulkSelectedTagIds, setBulkSelectedTagIds] = useState<string[]>([]);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const [permissions, setPermissions] = useState<string[]>([]);
  const [isSuperadmin, setIsSuperadmin] = useState(false);

  const canManageProducts = isSuperadmin || permissions.includes('products:manage');
  const canUpdateStock = isSuperadmin || canManageProducts || permissions.includes('products:stock_update');

  // Load product catalog list
  const loadProducts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/products');
      if (res.ok) {
        const data = await res.json();
        setProducts(data);
      }
    } catch (err) {
      setError('Не удалось загрузить каталог сигаретной продукции.');
    } finally {
      setLoading(false);
    }
  };

  // Load tags list
  const loadTags = async () => {
    try {
      const res = await fetch('/api/admin/tags');
      if (res.ok) {
        const data = await res.json();
        setAllTags(data);
      }
    } catch (err) {
      console.error('Не удалось загрузить теги', err);
    }
  };

  useEffect(() => {
    async function init() {
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
      loadProducts();
      loadTags();
    }
    init();
  }, []);

  const clearForm = () => {
    setSku('');
    setName('');
    setBasePrice('');
    setStockPacks('');
    setIsFavorite(false);
    setIsActive(true);
    setSelectedTagIds([]);
    if (newImagePreview) {
      URL.revokeObjectURL(newImagePreview);
    }
    setNewImageFile(null);
    setNewImagePreview('');
    setError('');
  };

  const handleSelectNewImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Поддерживаются только форматы JPG, PNG и WebP.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('Размер изображения не должен превышать 10 MB.');
      return;
    }

    if (newImagePreview) {
      URL.revokeObjectURL(newImagePreview);
    }

    setNewImageFile(file);
    setNewImagePreview(URL.createObjectURL(file));
    setError('');
  };

  const handleClearNewImage = () => {
    if (newImagePreview) {
      URL.revokeObjectURL(newImagePreview);
    }
    setNewImageFile(null);
    setNewImagePreview('');
  };

  // Add SKU handler
  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      let res: Response;

      if (newImageFile) {
        const formData = new FormData();
        formData.append('sku', sku);
        formData.append('name', name);
        formData.append('basePrice', String(Number(basePrice)));
        formData.append('stockPacks', String(stockPacks !== '' ? Number(stockPacks) : 5000));
        formData.append('isFavorite', String(isFavorite));
        formData.append('isActive', String(isActive));
        formData.append('tagIds', JSON.stringify(selectedTagIds));
        formData.append('file', newImageFile);

        res = await fetch('/api/admin/products', {
          method: 'POST',
          body: formData,
        });
      } else {
        res = await fetch('/api/admin/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sku,
            name,
            basePrice: Number(basePrice),
            stockPacks: stockPacks !== '' ? Number(stockPacks) : 5000,
            isFavorite,
            isActive,
            tagIds: selectedTagIds
          }),
        });
      }

      const data = await res.json();

      if (res.ok) {
        setSuccess(`Марка сигарет "${name}" успешно создана.`);
        setShowAddModal(false);
        clearForm();
        loadProducts();
      } else {
        setError(data.error || 'Ошибка при создании товара.');
      }
    } catch (err) {
      setError('Ошибка связи с сервером.');
    } finally {
      setSubmitting(false);
    }
  };

  // Open edit modal
  const openEditModal = (prod: ProductItem) => {
    setActiveProduct(prod);
    setSku(prod.sku);
    setName(prod.name);
    setBasePrice(prod.basePrice);
    setStockPacks(prod.stockPacks);
    setIsFavorite(prod.isFavorite);
    setIsActive(prod.isActive);
    setSelectedTagIds(prod.tags ? prod.tags.map(t => t.id) : []);
    setShowEditModal(true);
  };

  // Update SKU handler
  const handleEditProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProduct) return;
    setSubmitting(true);
    setError('');
    setSuccess('');

    const payload = !canManageProducts && canUpdateStock
      ? { id: activeProduct.id, stockPacks: stockPacks !== '' ? Number(stockPacks) : 0 }
      : {
          id: activeProduct.id,
          sku,
          name,
          basePrice: Number(basePrice),
          stockPacks: stockPacks !== '' ? Number(stockPacks) : 0,
          isFavorite,
          isActive,
          tagIds: selectedTagIds
        };

    try {
      const res = await fetch('/api/admin/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(`Товар "${name}" успешно обновлен.`);
        setShowEditModal(false);
        clearForm();
        setActiveProduct(null);
        loadProducts();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Ошибка связи с сервером.');
    } finally {
      setSubmitting(false);
    }
  };

  // Image upload handler
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeProduct) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Поддерживаются только форматы JPG, PNG и WebP.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('Размер изображения не должен превышать 10 MB.');
      return;
    }

    setUploadingImage(true);
    setError('');
    setSuccess('');

    const formData = new FormData();
    formData.append('productId', activeProduct.id);
    formData.append('file', file);

    try {
      const res = await fetch('/api/admin/products/upload-image', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess('Изображение успешно загружено.');
        setActiveProduct(prev => prev ? { ...prev, imageUrl: data.imageUrl } : null);
        loadProducts();
      } else {
        setError(data.error || 'Ошибка при загрузке изображения.');
      }
    } catch (err) {
      setError('Ошибка сети при загрузке изображения.');
    } finally {
      setUploadingImage(false);
    }
  };

  // Delete product image handler
  const handleDeleteImage = async () => {
    if (!activeProduct || !activeProduct.imageUrl || activeProduct.imageUrl === 'default-pack') return;
    setDeletingImage(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch(`/api/admin/products/upload-image?productId=${activeProduct.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess('Изображение товара удалено.');
        setActiveProduct(prev => prev ? { ...prev, imageUrl: '' } : null);
        loadProducts();
      } else {
        setError(data.error || 'Не удалось удалить изображение.');
      }
    } catch (err) {
      setError('Ошибка сети при удалении изображения.');
    } finally {
      setDeletingImage(false);
    }
  };

  // Delete product handler
  const handleDeleteProduct = async () => {
    if (!productToDelete) return;
    setDeletingProduct(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch(`/api/admin/products?id=${productToDelete.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();

      if (res.ok) {
        setSuccess(data.message || `Товар "${productToDelete.name}" удален.`);
        setProductToDelete(null);
        setSelectedProductIds(prev => prev.filter(id => id !== productToDelete.id));
        loadProducts();
      } else {
        setError(data.error || 'Не удалось удалить товар.');
      }
    } catch (err) {
      setError('Ошибка сети при удалении товара.');
    } finally {
      setDeletingProduct(false);
    }
  };

  // Bulk Edit Price handler
  const handleBulkEditPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bulkPrice === '') return;
    setBulkSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/admin/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedProductIds, basePrice: Number(bulkPrice) }),
      });
      const data = await res.json();

      if (res.ok) {
        setSuccess(`Успешно обновлена цена для ${selectedProductIds.length} товаров.`);
        setSelectedProductIds([]);
        setShowBulkPriceModal(false);
        loadProducts();
      } else {
        setError(data.error || 'Ошибка массового изменения цен.');
      }
    } catch {
      setError('Ошибка связи с сервером.');
    } finally {
      setBulkSubmitting(false);
    }
  };

  // Bulk Edit Tags handler
  const handleBulkEditTags = async (e: React.FormEvent) => {
    e.preventDefault();
    setBulkSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/admin/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedProductIds, tagIds: bulkSelectedTagIds }),
      });
      const data = await res.json();

      if (res.ok) {
        setSuccess(`Успешно изменены теги для ${selectedProductIds.length} товаров.`);
        setSelectedProductIds([]);
        setShowBulkTagsModal(false);
        loadProducts();
      } else {
        setError(data.error || 'Ошибка массового изменения тегов.');
      }
    } catch {
      setError('Ошибка связи с сервером.');
    } finally {
      setBulkSubmitting(false);
    }
  };

  // Bulk Delete handler
  const handleBulkDelete = async () => {
    setBulkSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch(`/api/admin/products?ids=${selectedProductIds.join(',')}`, {
        method: 'DELETE',
      });
      const data = await res.json();

      if (res.ok) {
        setSuccess(data.message || `Успешно удалено ${selectedProductIds.length} товаров.`);
        setSelectedProductIds([]);
        setShowBulkDeleteModal(false);
        loadProducts();
      } else {
        setError(data.error || 'Ошибка массового удаления.');
      }
    } catch {
      setError('Ошибка связи с сервером.');
    } finally {
      setBulkSubmitting(false);
    }
  };

  // Quick toggle active state
  const handleToggleActive = async (prod: ProductItem) => {
    try {
      const res = await fetch('/api/admin/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: prod.id, isActive: !prod.isActive }),
      });
      if (res.ok) {
        loadProducts();
      }
    } catch (err) {
      console.error('Toggle active failed', err);
    }
  };

  // Quick toggle favorite state
  const handleToggleFavorite = async (prod: ProductItem) => {
    try {
      const res = await fetch('/api/admin/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: prod.id, isFavorite: !prod.isFavorite }),
      });
      if (res.ok) {
        loadProducts();
      }
    } catch (err) {
      console.error('Toggle favorite failed', err);
    }
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* ── STICKY HEADER BAR ── */}
      <div className="flex-shrink-0 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-white/5 bg-background/80 backdrop-blur-sm sticky top-0 z-20 pt-1">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-primary" />
            <span>Номенклатура B2B каталога сигарет</span>
          </h2>
          <span className="block text-xs text-slate-400 mt-1 font-semibold">
            Редактирование цен за пачку, отметка избранных брендов и вывод позиций на витрину
          </span>
        </div>

        {canManageProducts && (
          <button
            onClick={() => { clearForm(); setShowAddModal(true); }}
            className="btn-primary flex items-center gap-2 px-4 py-2.5 text-xs w-full sm:w-auto flex-shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Добавить марку сигарет</span>
          </button>
        )}
      </div>

      {/* Notifications — below header bar, still pinned */}
      <div className="flex-shrink-0 space-y-2">
        {success && (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-xs sm:text-sm text-emerald-400 flex items-center gap-3">
            <Check className="h-5 w-5 flex-shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-xs sm:text-sm text-red-400 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* ── SCROLLABLE TABLE AREA ── */}
      <div className="flex-1 overflow-y-auto min-h-0 pb-24">
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="glass-panel rounded-3xl overflow-hidden border border-white/5 animate-fade-in">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 bg-slate-950/40 text-[10px] text-slate-400 uppercase tracking-wider font-extrabold">
                  <th className="py-4 px-6 w-12 text-center select-none">
                    <input
                      type="checkbox"
                      checked={products.length > 0 && selectedProductIds.length === products.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedProductIds(products.map(p => p.id));
                        } else {
                          setSelectedProductIds([]);
                        }
                      }}
                      className="rounded border-slate-700 bg-slate-800 text-primary-focus h-4 w-4 cursor-pointer"
                    />
                  </th>
                  <th className="py-4 px-6">Обложка</th>
                  <th className="py-4 px-6">Артикул / SKU</th>
                  <th className="py-4 px-6">Наименование марки</th>
                  <th className="py-4 px-6">Цена за пачку (10 шт. = 1 блок)</th>
                  <th className="py-4 px-6">Запас (пачек)</th>
                  <th className="py-4 px-6">Избранное</th>
                  <th className="py-4 px-6">Статус на витрине</th>
                  <th className="py-4 px-6 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs">
                {products.map((p) => (
                  <tr key={p.id} className={`hover:bg-white/5 transition-all text-slate-300 ${selectedProductIds.includes(p.id) ? 'bg-white/5' : ''}`}>
                    <td className="py-4 px-6 w-12 text-center select-none">
                      <input
                        type="checkbox"
                        checked={selectedProductIds.includes(p.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedProductIds([...selectedProductIds, p.id]);
                          } else {
                            setSelectedProductIds(selectedProductIds.filter(id => id !== p.id));
                          }
                        }}
                        className="rounded border-slate-700 bg-slate-800 text-primary-focus h-4 w-4 cursor-pointer"
                      />
                    </td>
                    <td className="py-4 px-6">
                      <div className="w-10 h-10 rounded-lg border border-white/5 bg-slate-950/40 overflow-hidden flex items-center justify-center">
                        {p.imageUrl && p.imageUrl !== 'default-pack' ? (
                          <img
                            src={p.imageUrl}
                            alt={p.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <ShoppingBag className="w-5 h-5 text-slate-600" />
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
                    <td className="py-4 px-6 font-bold text-primary-focus">{p.basePrice.toLocaleString()} UZS</td>
                    <td className="py-4 px-6 font-bold text-slate-300">{p.stockPacks.toLocaleString()} шт.</td>
                    <td className="py-4 px-6">
                      <button
                        onClick={() => handleToggleFavorite(p)}
                        className={`flex h-6 w-6 items-center justify-center rounded-full transition-all ${
                          p.isFavorite
                            ? 'bg-amber-500/10 text-amber-400'
                            : 'bg-white/5 text-slate-600 hover:text-slate-400'
                        }`}
                      >
                        <Star className={`h-4 w-4 ${p.isFavorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                      </button>
                    </td>
                    <td className="py-4 px-6">
                      <button
                        onClick={() => handleToggleActive(p)}
                        className={`inline-flex px-2 py-0.5 rounded text-[9px] font-extrabold tracking-wider border transition-all ${
                          p.isActive
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                            : 'bg-red-500/10 border-red-500/20 text-red-400'
                        }`}
                      >
                        {p.isActive ? 'АКТИВЕН' : 'СКРЫТ'}
                      </button>
                    </td>
                      <td className="py-4 px-6 text-right space-x-2">
                        {canUpdateStock && (
                          <button
                            onClick={() => openEditModal(p)}
                            className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white transition-all inline-flex"
                            title={!canManageProducts ? 'Изменить остаток на складе' : 'Редактировать товар'}
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canManageProducts && (
                          <button
                            onClick={() => setProductToDelete(p)}
                            className="p-1.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 hover:text-red-300 hover:bg-red-500/20 transition-all inline-flex"
                            title="Удалить товар"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>{/* end scrollable area */}


      {selectedProductIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-950/80 backdrop-blur-md border border-white/10 p-4 rounded-2xl shadow-glass-lg flex items-center gap-4 animate-slide-up text-xs font-bold select-none">
          <span className="text-slate-300">
            Выбрано: <strong className="text-primary">{selectedProductIds.length}</strong>
          </span>
          <div className="h-4 w-px bg-white/10" />
          <button
            onClick={() => { setBulkPrice(''); setShowBulkPriceModal(true); }}
            className="px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-all text-slate-200"
          >
            Изменить цену
          </button>
          <button
            onClick={() => { setBulkSelectedTagIds([]); setShowBulkTagsModal(true); }}
            className="px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-all text-slate-200"
          >
            Установить теги
          </button>
          <button
            onClick={() => setShowBulkDeleteModal(true)}
            className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all"
          >
            Удалить выбранные
          </button>
          <div className="h-4 w-px bg-white/10" />
          <button
            onClick={() => setSelectedProductIds([])}
            className="text-slate-500 hover:text-slate-300 transition-all font-extrabold uppercase text-[10px]"
          >
            Сбросить
          </button>
        </div>
      )}

      {/* Bulk Edit Price Modal */}
      {showBulkPriceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-sm rounded-3xl p-6 relative">
            <button
              onClick={() => setShowBulkPriceModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-base font-bold text-slate-200 mb-4 flex items-center gap-2">
              <Edit className="h-5 w-5 text-primary" />
              <span>Массовое изменение цен ({selectedProductIds.length} SKU)</span>
            </h3>
            <form onSubmit={handleBulkEditPrice} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Новая цена за пачку (UZS)</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full rounded-xl px-4 py-2.5 text-xs glass-input"
                  placeholder="16300"
                  value={bulkPrice}
                  onChange={(e) => setBulkPrice(e.target.value !== '' ? Number(e.target.value) : '')}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={bulkSubmitting}
                className="btn-primary w-full py-2.5 text-xs flex items-center justify-center gap-2 mt-4"
              >
                {bulkSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>Применить цены</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Edit Tags Modal */}
      {showBulkTagsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-md rounded-3xl p-6 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowBulkTagsModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-base font-bold text-slate-200 mb-2 flex items-center gap-2">
              <Tag className="h-5 w-5 text-primary" />
              <span>Массовая привязка тегов ({selectedProductIds.length} SKU)</span>
            </h3>
            <p className="text-[10px] text-slate-400 mb-4 font-semibold leading-relaxed">
              Выбранные теги будут установлены для всех выбранных товаров. Прежние теги на этих позициях будут полностью заменены.
            </p>
            <form onSubmit={handleBulkEditTags} className="space-y-4">
              <div className="flex flex-wrap gap-1.5 p-3 rounded-xl bg-slate-950/40 border border-white/5">
                {allTags.map(tag => {
                  const isSelected = bulkSelectedTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => {
                        if (isSelected) {
                          setBulkSelectedTagIds(bulkSelectedTagIds.filter(id => id !== tag.id));
                        } else {
                          setBulkSelectedTagIds([...bulkSelectedTagIds, tag.id]);
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
              </div>
              <button
                type="submit"
                disabled={bulkSubmitting}
                className="btn-primary w-full py-2.5 text-xs flex items-center justify-center gap-2 mt-4"
              >
                {bulkSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>Применить теги</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/85 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-sm rounded-3xl p-6 relative border border-red-500/20">
            <h3 className="text-base font-bold text-slate-200 mb-2 flex items-center gap-2 text-red-400">
              <AlertCircle className="h-5 w-5" />
              <span>Массовое безвозвратное удаление</span>
            </h3>
            <p className="text-xs text-slate-400 mb-6 leading-relaxed">
              Вы действительно хотите безвозвратно удалить <strong className="text-slate-200">{selectedProductIds.length} выбранных товаров</strong> из каталога?
              <br />
              <span className="text-red-400 font-semibold mt-2 block">
                ⚠️ Внимание: это действие удалит данные позиции из истории всех черновиков и завершенных заказов. Рекомендуется использовать скрытие с витрины.
              </span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowBulkDeleteModal(false)}
                className="btn-secondary flex-1 py-2.5 text-xs font-bold"
                disabled={bulkSubmitting}
              >
                Отмена
              </button>
              <button
                onClick={handleBulkDelete}
                className="bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl flex-1 py-2.5 text-xs flex items-center justify-center gap-2 transition-all"
                disabled={bulkSubmitting}
              >
                {bulkSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>Удалить все</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add SKU Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-md rounded-3xl p-6 sm:p-8 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowAddModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-base font-bold text-slate-200 mb-6 flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              <span>Создание новой сигаретной SKU</span>
            </h3>

            <form onSubmit={handleAddProduct} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Код SKU / Артикул</label>
                <div className="relative">
                  <Tag className="absolute left-3 top-3 h-4.5 w-4.5 text-slate-400" />
                  <input
                    type="text"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
                    placeholder="ESSE-CHNG"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Наименование марки</label>
                <div className="relative">
                  <Layers className="absolute left-3 top-3 h-4.5 w-4.5 text-slate-400" />
                  <input
                    type="text"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
                    placeholder="ESSE Change"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Базовая цена за пачку (UZS)</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full rounded-xl px-4 py-2.5 text-xs glass-input"
                  placeholder="23800.00"
                  value={basePrice}
                  onChange={(e) => setBasePrice(e.target.value !== '' ? Number(e.target.value) : '')}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Запас (пачек)</label>
                <input
                  type="number"
                  className="w-full rounded-xl px-4 py-2.5 text-xs glass-input"
                  placeholder="5000"
                  value={stockPacks}
                  onChange={(e) => setStockPacks(e.target.value !== '' ? Number(e.target.value) : '')}
                  required
                />
              </div>

              {/* Tag Selector */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Теги товара</label>
                {allTags.length === 0 ? (
                  <div className="text-[11px] text-slate-500 bg-slate-950/20 p-2 rounded-lg border border-white/5">
                    Теги ещё не добавлены. Создайте их в меню «Теги».
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 p-3 rounded-xl bg-slate-950/40 border border-white/5">
                    {allTags.map(tag => {
                      const isSelected = selectedTagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setSelectedTagIds(selectedTagIds.filter(id => id !== tag.id));
                            } else {
                              setSelectedTagIds([...selectedTagIds, tag.id]);
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
                  </div>
                )}
              </div>

              {/* Cover Image Selector */}
              <div className="space-y-2 border-t border-white/5 pt-4">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Изображение товара (опционально)</label>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-xl border border-white/5 bg-slate-950/40 overflow-hidden flex items-center justify-center flex-shrink-0">
                    {newImagePreview ? (
                      <img
                        src={newImagePreview}
                        alt="Превью"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ShoppingBag className="w-8 h-8 text-slate-600" />
                    )}
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        id="add-product-image"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={handleSelectNewImage}
                        className="hidden"
                        disabled={submitting}
                      />
                      <label
                        htmlFor="add-product-image"
                        className="btn-secondary py-1.5 px-3 text-xs inline-flex items-center gap-1.5 cursor-pointer font-bold border border-white/10 hover:border-white/20 transition-all rounded-lg"
                      >
                        <RefreshCw className="h-3 w-3" />
                        <span>{newImagePreview ? 'Заменить файл' : 'Выбрать изображение'}</span>
                      </label>
                      {newImagePreview && (
                        <button
                          type="button"
                          onClick={handleClearNewImage}
                          className="text-xs text-red-400 hover:text-red-300 py-1.5 px-2 font-bold flex items-center gap-1 transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                          <span>Удалить</span>
                        </button>
                      )}
                    </div>
                    <span className="block text-[10px] text-slate-500">JPG, PNG или WebP до 10 МБ.</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-4 pt-2">
                <label className="flex items-center gap-2 text-xs text-slate-300 font-bold select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isFavorite}
                    onChange={(e) => setIsFavorite(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-800 text-primary-focus h-4 w-4"
                  />
                  <span>В Избранное</span>
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-300 font-bold select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-800 text-primary-focus h-4 w-4"
                  />
                  <span>Активен для заказа</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="btn-primary w-full py-3 text-xs flex items-center justify-center gap-2 mt-6"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>Создать товар</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit SKU Modal */}
      {showEditModal && activeProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-md rounded-3xl p-6 sm:p-8 relative max-h-[95vh] overflow-y-auto">
            <button
              onClick={() => { setShowEditModal(false); setActiveProduct(null); }}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-base font-bold text-slate-200 mb-6 flex items-center gap-2">
              <Edit className="h-5 w-5 text-primary" />
              <span>Редактирование параметров SKU</span>
            </h3>

            <form onSubmit={handleEditProduct} className="space-y-4">
              {!canManageProducts && canUpdateStock ? (
                <>
                  <div className="bg-slate-900/60 p-3.5 rounded-xl border border-white/5 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Товар</span>
                    <p className="text-sm font-extrabold text-slate-100">{name}</p>
                    <p className="text-xs text-slate-400 font-mono">SKU: {sku}</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Текущий запас (пачек)</label>
                    <input
                      type="number"
                      className="w-full rounded-xl px-4 py-2.5 text-xs glass-input font-bold"
                      value={stockPacks}
                      onChange={(e) => setStockPacks(e.target.value !== '' ? Number(e.target.value) : '')}
                      required
                      min="0"
                    />
                    <span className="text-[10px] text-slate-400 block font-semibold">
                      = {Math.floor((Number(stockPacks) || 0) / 10)} блоков ({Math.floor((Number(stockPacks) || 0) / 500)} коробок)
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Код SKU / Артикул</label>
                    <div className="relative">
                      <Tag className="absolute left-3 top-3 h-4.5 w-4.5 text-slate-400" />
                      <input
                        type="text"
                        className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
                        value={sku}
                        onChange={(e) => setSku(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Наименование марки</label>
                    <div className="relative">
                      <Layers className="absolute left-3 top-3 h-4.5 w-4.5 text-slate-400" />
                      <input
                        type="text"
                        className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Цена за пачку (UZS)</label>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full rounded-xl px-4 py-2.5 text-xs glass-input"
                      value={basePrice}
                      onChange={(e) => setBasePrice(e.target.value !== '' ? Number(e.target.value) : '')}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Запас (пачек)</label>
                    <input
                      type="number"
                      className="w-full rounded-xl px-4 py-2.5 text-xs glass-input"
                      value={stockPacks}
                      onChange={(e) => setStockPacks(e.target.value !== '' ? Number(e.target.value) : '')}
                      required
                    />
                  </div>

                  {/* Tag Selector */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Теги товара</label>
                    {allTags.length === 0 ? (
                      <div className="text-[11px] text-slate-500 bg-slate-950/20 p-2 rounded-lg border border-white/5">
                        Теги ещё не добавлены. Создайте их в меню «Теги».
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 p-3 rounded-xl bg-slate-950/40 border border-white/5">
                        {allTags.map(tag => {
                          const isSelected = selectedTagIds.includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedTagIds(selectedTagIds.filter(id => id !== tag.id));
                                } else {
                                  setSelectedTagIds([...selectedTagIds, tag.id]);
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
                      </div>
                    )}
                  </div>

                  {/* Cover Image Upload */}
                  <div className="space-y-2 border-t border-white/5 pt-4">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Обложка товара</label>
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-xl border border-white/5 bg-slate-950/40 overflow-hidden flex items-center justify-center flex-shrink-0">
                        {activeProduct.imageUrl && activeProduct.imageUrl !== 'default-pack' ? (
                          <img
                            src={activeProduct.imageUrl}
                            alt={activeProduct.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <ShoppingBag className="w-8 h-8 text-slate-600" />
                        )}
                      </div>
                      <div className="flex-1 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <input
                            type="file"
                            id="product-image-upload"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={handleImageUpload}
                            className="hidden"
                            disabled={uploadingImage || deletingImage}
                          />
                          <label
                            htmlFor="product-image-upload"
                            className="btn-secondary py-1.5 px-3 text-xs inline-flex items-center gap-1.5 cursor-pointer font-bold border border-white/10 hover:border-white/20 transition-all rounded-lg"
                          >
                            {uploadingImage ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                <span>Загрузка...</span>
                              </>
                            ) : (
                              <>
                                <RefreshCw className="h-3 w-3" />
                                <span>{activeProduct.imageUrl && activeProduct.imageUrl !== 'default-pack' ? 'Заменить изображение' : 'Загрузить изображение'}</span>
                              </>
                            )}
                          </label>
                          {activeProduct.imageUrl && activeProduct.imageUrl !== 'default-pack' && (
                            <button
                              type="button"
                              onClick={handleDeleteImage}
                              disabled={uploadingImage || deletingImage}
                              className="text-xs text-red-400 hover:text-red-300 py-1.5 px-2.5 font-bold flex items-center gap-1.5 transition-colors border border-red-500/20 hover:border-red-500/40 rounded-lg bg-red-500/10"
                            >
                              {deletingImage ? (
                                <>
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  <span>Удаление...</span>
                                </>
                              ) : (
                                <>
                                  <Trash2 className="h-3 w-3" />
                                  <span>Удалить фото</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                        <span className="block text-[10px] text-slate-500">Допустимо: PNG, JPG, WebP. До 10 МБ.</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-4 pt-2">
                    <label className="flex items-center gap-2 text-xs text-slate-300 font-bold select-none cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isFavorite}
                        onChange={(e) => setIsFavorite(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-800 text-primary-focus h-4 w-4"
                      />
                      <span>В Избранное</span>
                    </label>

                    <label className="flex items-center gap-2 text-xs text-slate-300 font-bold select-none cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={(e) => setIsActive(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-800 text-primary-focus h-4 w-4"
                      />
                      <span>Активен</span>
                    </label>
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="btn-primary w-full py-3 text-xs flex items-center justify-center gap-2 mt-6"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>Сохранить</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {productToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/85 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-sm rounded-3xl p-6 relative border border-red-500/20">
            <h3 className="text-base font-bold text-slate-200 mb-2 flex items-center gap-2 text-red-400">
              <AlertCircle className="h-5 w-5" />
              <span>Безвозвратное удаление</span>
            </h3>
            <p className="text-xs text-slate-400 mb-6 leading-relaxed">
              Вы действительно хотите удалить марку сигарет <strong className="text-slate-200">«{productToDelete.name}»</strong> ({productToDelete.sku}) из каталога?
              <br />
              <span className="text-red-400 font-semibold mt-2 block">
                ⚠️ Внимание: это удалит товар из истории всех черновиков и заказов. Для временного скрытия с витрины используйте деактивацию (статус «Скрыт»).
              </span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setProductToDelete(null)}
                className="btn-secondary flex-1 py-2.5 text-xs font-bold"
                disabled={deletingProduct}
              >
                Отмена
              </button>
              <button
                onClick={handleDeleteProduct}
                className="bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl flex-1 py-2.5 text-xs flex items-center justify-center gap-2 transition-all"
                disabled={deletingProduct}
              >
                {deletingProduct && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>Удалить</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
