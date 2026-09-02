'use client';

import { useState, useEffect } from 'react';
import {
  Layers, Plus, Edit, Trash2, Search, Package, Check, AlertCircle,
  Loader2, X, ArrowUpDown, ChevronDown, ChevronRight, Layers3
} from 'lucide-react';

interface Sku {
  id: string;
  sku: string;
  name: string;
  stockPacks: number;
  priority: number;
  isActive: boolean;
  basePrice: number;
}

interface ProductGroup {
  id: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
  totalStock: number;
  skus: Sku[];
}

interface ProductOption {
  id: string;
  sku: string;
  name: string;
  groupId: string | null;
}

export default function AdminProductGroupsPage() {
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [allProducts, setAllProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Group Create/Edit Modal State
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ProductGroup | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [groupActive, setGroupActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // SKU Add Modal State
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedPriority, setSelectedPriority] = useState(0);
  const [showSkuModal, setShowSkuModal] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [groupsRes, productsRes] = await Promise.all([
        fetch('/api/admin/product-groups'),
        fetch('/api/admin/products')
      ]);

      if (groupsRes.ok) {
        const data = await groupsRes.json();
        setGroups(data);
      }
      if (productsRes.ok) {
        const prodData = await productsRes.json();
        setAllProducts(prodData);
      }
    } catch (err) {
      setError('Ошибка загрузки групп товаров.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenCreateModal = () => {
    setEditingGroup(null);
    setDisplayName('');
    setGroupActive(true);
    setShowGroupModal(true);
  };

  const handleOpenEditModal = (group: ProductGroup) => {
    setEditingGroup(group);
    setDisplayName(group.displayName);
    setGroupActive(group.isActive);
    setShowGroupModal(true);
  };

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const url = editingGroup
        ? `/api/admin/product-groups/${editingGroup.id}`
        : '/api/admin/product-groups';
      const method = editingGroup ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          isActive: groupActive
        })
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess(editingGroup ? 'Группа успешно обновлена.' : 'Группа создана.');
        setShowGroupModal(false);
        loadData();
      } else {
        setError(data.error || 'Ошибка при сохранении группы.');
      }
    } catch (err) {
      setError('Не удалось подключиться к серверу.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteGroup = async (groupId: string, name: string) => {
    if (!confirm(`Вы действительно хотите удалить группу "${name}"? Все SKU этой группы будут отвязаны.`)) {
      return;
    }

    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/admin/product-groups/${groupId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setSuccess(`Группа "${name}" удалена.`);
        loadData();
      } else {
        const data = await res.json();
        setError(data.error || 'Ошибка при удалении группы.');
      }
    } catch (err) {
      setError('Сбой подключения.');
    }
  };

  const handleAddSkuToGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroupId || !selectedProductId) return;

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch(`/api/admin/product-groups/${selectedGroupId}/skus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selectedProductId,
          priority: selectedPriority
        })
      });

      if (res.ok) {
        setSuccess('SKU привязан к группе.');
        setShowSkuModal(false);
        setSelectedProductId('');
        loadData();
      } else {
        const data = await res.json();
        setError(data.error || 'Не удалось привязать SKU.');
      }
    } catch (err) {
      setError('Сбой подключения.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveSkuFromGroup = async (groupId: string, productId: string) => {
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/admin/product-groups/${groupId}/skus`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId })
      });
      if (res.ok) {
        setSuccess('SKU отвязан от группы.');
        loadData();
      } else {
        const data = await res.json();
        setError(data.error || 'Не удалось отвязать SKU.');
      }
    } catch (err) {
      setError('Сбой подключения.');
    }
  };

  const handleUpdatePriority = async (groupId: string, productId: string, priority: number) => {
    try {
      await fetch(`/api/admin/product-groups/${groupId}/skus`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, priority })
      });
      loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const filteredGroups = groups.filter(g =>
    g.displayName.toLowerCase().includes(search.toLowerCase()) ||
    g.skus.some(s => s.name.toLowerCase().includes(search.toLowerCase()) || s.sku.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Layers3 className="h-5 w-5 text-primary" />
            <span>Группы товаров (Логические товары)</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1 font-semibold">
            Покупатели видят единый коммерческий товар. Заказ автоматически распределяется по доступным складским SKU по приоритету.
          </p>
        </div>

        <button
          onClick={handleOpenCreateModal}
          className="btn-primary py-2.5 px-4 text-xs flex items-center gap-2 w-fit"
        >
          <Plus className="h-4 w-4" />
          <span>Создать группу</span>
        </button>
      </div>

      {/* Notifications */}
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

      {/* Search Bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder="Поиск групп или SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
        />
      </div>

      {/* Groups List */}
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center glass-panel rounded-2xl">
          <Layers className="h-8 w-8 text-slate-500 mb-2" />
          <p className="text-xs text-slate-400">Группы товаров не найдены.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredGroups.map((group) => (
            <div key={group.id} className="glass-panel rounded-2xl p-5 space-y-4">
              {/* Group Header Row */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-xs">
                    {group.skus.length} SKU
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-extrabold text-slate-100 text-sm">{group.displayName}</h3>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                        group.isActive ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {group.isActive ? 'Активна' : 'Неактивна'}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-semibold block mt-0.5">
                      Общий складской остаток: <strong className="text-slate-200">{Math.floor(group.totalStock / 10)} блоков</strong> ({group.totalStock} пачек)
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  <button
                    onClick={() => {
                      setSelectedGroupId(group.id);
                      setSelectedProductId('');
                      setSelectedPriority(group.skus.length + 1);
                      setShowSkuModal(true);
                    }}
                    className="btn-secondary py-1.5 px-3 text-[10px] flex items-center gap-1.5 text-indigo-300 border-indigo-500/20 hover:bg-indigo-500/10"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Привязать SKU</span>
                  </button>

                  <button
                    onClick={() => handleOpenEditModal(group)}
                    className="btn-secondary p-2 text-slate-400 hover:text-slate-200"
                    title="Редактировать группу"
                  >
                    <Edit className="h-3.5 w-3.5" />
                  </button>

                  <button
                    onClick={() => handleDeleteGroup(group.id, group.displayName)}
                    className="btn-secondary p-2 text-red-400 border-red-500/10 bg-red-500/5 hover:bg-red-500/15"
                    title="Удалить группу"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Associated SKUs Table */}
              {group.skus.length === 0 ? (
                <p className="text-[11px] text-slate-500 italic py-2">
                  К этой группе пока не привязан ни один складской SKU. Покупатель не увидит этот товар в каталоге.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        <th className="py-2 px-3">Приоритет списания</th>
                        <th className="py-2 px-3">Код SKU</th>
                        <th className="py-2 px-3">Название складского товара</th>
                        <th className="py-2 px-3">Остаток (блоков)</th>
                        <th className="py-2 px-3 text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {group.skus.map((sku, index) => (
                        <tr key={sku.id} className="hover:bg-white/5 transition-colors">
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-indigo-400 text-[11px]">#{sku.priority ?? index + 1}</span>
                              <input
                                type="number"
                                value={sku.priority}
                                onChange={(e) => handleUpdatePriority(group.id, sku.id, parseInt(e.target.value) || 0)}
                                className="w-12 rounded bg-slate-900 border border-white/10 px-1.5 py-0.5 text-[10px] text-center font-mono text-slate-200"
                                title="Изменить приоритет (меньше = раньше списывается)"
                              />
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-300">{sku.sku}</td>
                          <td className="py-2.5 px-3 font-semibold text-slate-200">{sku.name}</td>
                          <td className="py-2.5 px-3 font-bold text-slate-300">
                            {Math.floor(sku.stockPacks / 10)} бл.
                            <span className="text-[10px] text-slate-500 ml-1 font-normal">({sku.stockPacks} п.)</span>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              onClick={() => handleRemoveSkuFromGroup(group.id, sku.id)}
                              className="text-[10px] text-red-400 hover:text-red-300 font-semibold hover:underline"
                            >
                              Отвязать
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Group Create/Edit Modal */}
      {showGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel rounded-3xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="font-bold text-slate-100 text-sm">
                {editingGroup ? 'Редактировать группу товаров' : 'Создать группу товаров'}
              </h3>
              <button
                onClick={() => setShowGroupModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveGroup} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Название группы (то, что видит покупатель)
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="например: ESSE Change"
                  className="w-full rounded-xl px-4 py-2.5 text-xs glass-input"
                  required
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="groupActiveCheck"
                  checked={groupActive}
                  onChange={(e) => setGroupActive(e.target.checked)}
                  className="rounded border-slate-700 text-primary focus:ring-0"
                />
                <label htmlFor="groupActiveCheck" className="text-xs font-semibold text-slate-300 cursor-pointer">
                  Группа активна (отображается в каталоге)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowGroupModal(false)}
                  className="btn-secondary px-4 py-2 text-xs"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary px-4 py-2 text-xs flex items-center gap-2"
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>Сохранить</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SKU Attachment Modal */}
      {showSkuModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
          <div className="glass-panel rounded-3xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="font-bold text-slate-100 text-sm">Привязать складской SKU к группе</h3>
              <button
                onClick={() => setShowSkuModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddSkuToGroup} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Выберите складской товар (SKU)
                </label>
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full rounded-xl px-4 py-2.5 text-xs glass-input bg-slate-900 text-slate-200"
                  required
                >
                  <option value="">-- Выберите SKU --</option>
                  {allProducts.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.name} {p.groupId ? '(уже в группе)' : '(не привязан)'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Приоритет списания (меньше число = раньше списывается)
                </label>
                <input
                  type="number"
                  value={selectedPriority}
                  onChange={(e) => setSelectedPriority(parseInt(e.target.value) || 0)}
                  className="w-full rounded-xl px-4 py-2.5 text-xs glass-input"
                  min="0"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSkuModal(false)}
                  className="btn-secondary px-4 py-2 text-xs"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={submitting || !selectedProductId}
                  className="btn-primary px-4 py-2 text-xs flex items-center gap-2"
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>Привязать</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
