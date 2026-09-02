'use client';

import { useState, useEffect } from 'react';
import {
  Building2, Plus, Edit, Trash2, Search, Users, ShoppingBag,
  Check, AlertCircle, Loader2, X, ChevronDown, ChevronRight, Hash
} from 'lucide-react';

interface CompanyUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}

interface Company {
  id: string;
  name: string;
  code: string;
  inn: string | null;
  purchasePlanCases: number;
  monthlyTargetCases: number | null;
  createdAt: string;
  _count: { users: number; orders: number };
}

export default function AdminCompanies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedUsers, setExpandedUsers] = useState<CompanyUser[]>([]);
  const [expandedLoading, setExpandedLoading] = useState(false);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [activeCompany, setActiveCompany] = useState<Company | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [inn, setInn] = useState('');
  const [purchasePlanCases, setPurchasePlanCases] = useState('');
  const [monthlyTargetCases, setMonthlyTargetCases] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Load companies
  const loadCompanies = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/companies');
      if (res.ok) {
        const data = await res.json();
        setCompanies(data);
      }
    } catch (err) {
      setError('Не удалось загрузить список компаний.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCompanies();
  }, []);

  const clearForm = () => {
    setName('');
    setInn('');
    setPurchasePlanCases('');
    setMonthlyTargetCases('');
    setError('');
  };

  // Filtered companies
  const filteredCompanies = companies.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Expand row — load users for company
  const handleToggleExpand = async (company: Company) => {
    if (expandedId === company.id) {
      setExpandedId(null);
      setExpandedUsers([]);
      return;
    }

    setExpandedId(company.id);
    setExpandedLoading(true);
    setExpandedUsers([]);

    try {
      const res = await fetch(`/api/admin/companies/${company.id}`);
      if (res.ok) {
        const data = await res.json();
        setExpandedUsers(data.users || []);
      }
    } catch (err) {
      console.error('Failed to load company details', err);
    } finally {
      setExpandedLoading(false);
    }
  };

  // Add company
  const handleAddCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/admin/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          inn: inn || undefined,
          purchasePlanCases: purchasePlanCases ? parseInt(purchasePlanCases) : undefined,
          monthlyTargetCases: monthlyTargetCases ? parseFloat(monthlyTargetCases) : undefined,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(`Компания «${name}» успешно создана.`);
        setShowAddModal(false);
        clearForm();
        loadCompanies();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Не удалось связаться с сервером.');
    } finally {
      setSubmitting(false);
    }
  };

  // Open edit modal
  const openEditModal = (company: Company) => {
    setActiveCompany(company);
    setName(company.name);
    setInn(company.inn || '');
    setPurchasePlanCases(company.purchasePlanCases ? String(company.purchasePlanCases) : '');
    setMonthlyTargetCases(company.monthlyTargetCases ? String(company.monthlyTargetCases) : '');
    setShowEditModal(true);
  };

  // Update company
  const handleEditCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompany) return;
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch(`/api/admin/companies/${activeCompany.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          inn: inn || null,
          purchasePlanCases: purchasePlanCases ? parseInt(purchasePlanCases) : 0,
          monthlyTargetCases: monthlyTargetCases ? parseFloat(monthlyTargetCases) : 0,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(`Компания «${name}» успешно обновлена.`);
        setShowEditModal(false);
        clearForm();
        setActiveCompany(null);
        loadCompanies();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Не удалось связаться с сервером.');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete company
  const handleDeleteCompany = async (company: Company) => {
    if (!confirm(`Вы действительно хотите удалить компанию «${company.name}»?\n\nЭто действие необратимо. Удаление невозможно, если у компании есть пользователи или заказы.`)) {
      return;
    }

    setError('');
    setSuccess('');

    try {
      const res = await fetch(`/api/admin/companies/${company.id}`, {
        method: 'DELETE',
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(`Компания «${company.name}» была успешно удалена.`);
        if (expandedId === company.id) {
          setExpandedId(null);
          setExpandedUsers([]);
        }
        loadCompanies();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Ошибка удаления компании.');
    }
  };

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <span>Управление компаниями</span>
          </h2>
          <span className="block text-xs text-slate-400 mt-1 font-semibold">
            Создание и редактирование B2B компаний, привязка пользователей и управление планами закупок
          </span>
        </div>

        <button
          onClick={() => { clearForm(); setShowAddModal(true); }}
          className="btn-primary flex items-center gap-2 px-4 py-2.5 text-xs w-full sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          <span>Создать компанию</span>
        </button>
      </div>

      {/* Notifications */}
      {success && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-xs sm:text-sm text-emerald-400 flex items-center gap-3">
          <Check className="h-5 w-5 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {success === '' && error && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-xs sm:text-sm text-red-400 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Search Bar */}
      <div className="glass-panel rounded-2xl p-4 border border-white/5">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <input
            type="text"
            className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
            placeholder="Поиск по названию компании..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Companies Table */}
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filteredCompanies.length === 0 ? (
        <div className="glass-panel rounded-3xl border border-white/5 p-12 text-center">
          <Building2 className="h-10 w-10 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400 font-semibold">
            {searchQuery ? 'Компании не найдены по запросу' : 'Список компаний пуст'}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {searchQuery ? 'Попробуйте изменить параметры поиска' : 'Создайте первую компанию, нажав кнопку выше'}
          </p>
        </div>
      ) : (
        <div className="glass-panel rounded-3xl overflow-hidden border border-white/5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 bg-slate-950/40 text-[10px] text-slate-400 uppercase tracking-wider font-extrabold">
                  <th className="py-4 px-6 w-8"></th>
                  <th className="py-4 px-6">Название</th>
                  <th className="py-4 px-6">Код</th>
                  <th className="py-4 px-6">ИНН</th>
                  <th className="py-4 px-6">План (короба)</th>
                  <th className="py-4 px-6">Пользователи</th>
                  <th className="py-4 px-6">Заказы</th>
                  <th className="py-4 px-6">Создана</th>
                  <th className="py-4 px-6 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs">
                {filteredCompanies.map((c) => (
                  <>
                    <tr
                      key={c.id}
                      className="hover:bg-white/5 transition-all text-slate-300 cursor-pointer"
                      onClick={() => handleToggleExpand(c)}
                    >
                      <td className="py-4 px-6">
                        {expandedId === c.id ? (
                          <ChevronDown className="h-4 w-4 text-slate-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-slate-500" />
                        )}
                      </td>
                      <td className="py-4 px-6 font-bold text-slate-200">
                        <span className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-indigo-400 flex-shrink-0" />
                          <span>{c.name}</span>
                        </span>
                      </td>
                      <td className="py-4 px-6 font-mono text-slate-400 font-semibold">{c.code}</td>
                      <td className="py-4 px-6 font-semibold text-slate-400">{c.inn || '—'}</td>
                      <td className="py-4 px-6 font-semibold">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 text-[9px] font-extrabold tracking-wider">
                          <Hash className="h-3 w-3" />
                          {c.purchasePlanCases.toLocaleString()}
                        </span>
                      </td>
                      <td className="py-4 px-6 font-semibold">
                        <span className="inline-flex items-center gap-1.5 text-slate-400">
                          <Users className="h-3.5 w-3.5 text-indigo-400" />
                          <span>{c._count.users}</span>
                        </span>
                      </td>
                      <td className="py-4 px-6 font-semibold">
                        <span className="inline-flex items-center gap-1.5 text-slate-400">
                          <ShoppingBag className="h-3.5 w-3.5 text-emerald-400" />
                          <span>{c._count.orders}</span>
                        </span>
                      </td>
                      <td className="py-4 px-6 text-slate-500 font-semibold">{formatDate(c.createdAt)}</td>
                      <td className="py-4 px-6 text-right space-x-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => openEditModal(c)}
                          className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white transition-all inline-flex"
                          title="Редактировать компанию"
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteCompany(c)}
                          className="p-1.5 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all inline-flex"
                          title="Удалить компанию"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>

                    {/* Expanded Detail Row */}
                    {expandedId === c.id && (
                      <tr key={`${c.id}-detail`} className="bg-slate-950/30">
                        <td colSpan={9} className="px-6 py-5">
                          <div className="animate-slide-down">
                            <div className="flex items-center gap-4 mb-4">
                              <h4 className="text-xs font-bold text-slate-300 flex items-center gap-2">
                                <Users className="h-4 w-4 text-indigo-400" />
                                Пользователи компании ({c._count.users})
                              </h4>
                              <div className="flex-1 border-t border-white/5"></div>
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                                <ShoppingBag className="h-3.5 w-3.5 text-emerald-400" />
                                Заказов: {c._count.orders}
                              </span>
                            </div>

                            {expandedLoading ? (
                              <div className="flex items-center justify-center py-6">
                                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                              </div>
                            ) : expandedUsers.length === 0 ? (
                              <div className="text-center py-6">
                                <p className="text-xs text-slate-500 font-semibold">
                                  В этой компании пока нет пользователей
                                </p>
                              </div>
                            ) : (
                              <div className="rounded-xl border border-white/5 overflow-hidden">
                                <table className="w-full text-left border-collapse">
                                  <thead>
                                    <tr className="border-b border-white/5 bg-slate-900/50 text-[10px] text-slate-500 uppercase tracking-wider font-extrabold">
                                      <th className="py-3 px-4">Имя</th>
                                      <th className="py-3 px-4">Электронная почта</th>
                                      <th className="py-3 px-4">Роль</th>
                                      <th className="py-3 px-4">Статус</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-white/5 text-xs">
                                    {expandedUsers.map((u) => (
                                      <tr key={u.id} className={`hover:bg-white/5 transition-all ${!u.isActive ? 'opacity-60' : ''} text-slate-300`}>
                                        <td className="py-3 px-4 font-bold text-slate-200">{u.name}</td>
                                        <td className="py-3 px-4 font-semibold">{u.email}</td>
                                        <td className="py-3 px-4">
                                          <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-extrabold tracking-wider ${
                                            u.role === 'ADMIN' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' :
                                            u.role === 'SELLER' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' :
                                            u.role === 'MANAGER' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                                            'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                          }`}>
                                            {u.role}
                                          </span>
                                        </td>
                                        <td className="py-3 px-4">
                                          <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-bold ${
                                            u.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                                          }`}>
                                            {u.isActive ? 'Активен' : 'Отключен'}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Company Modal */}
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
              <span>Создание новой компании</span>
            </h3>

            <form onSubmit={handleAddCompany} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Название компании</label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
                    placeholder="ООО «Азия Табак»"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">ИНН (опционально)</label>
                <div className="relative">
                  <Hash className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
                    placeholder="1234567890"
                    value={inn}
                    onChange={(e) => setInn(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">План закупок (короба)</label>
                <div className="relative">
                  <ShoppingBag className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type="number"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
                    placeholder="0"
                    value={purchasePlanCases}
                    onChange={(e) => setPurchasePlanCases(e.target.value)}
                    min="0"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Месячный план (короба)</label>
                <div className="relative">
                  <Hash className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type="number"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
                    placeholder="0"
                    value={monthlyTargetCases}
                    onChange={(e) => setMonthlyTargetCases(e.target.value)}
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="btn-primary w-full py-3 text-xs flex items-center justify-center gap-2 mt-6"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>Создать компанию</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit Company Modal */}
      {showEditModal && activeCompany && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-md rounded-3xl p-6 sm:p-8 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => { setShowEditModal(false); setActiveCompany(null); }}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-base font-bold text-slate-200 mb-6 flex items-center gap-2">
              <Edit className="h-5 w-5 text-primary" />
              <span>Редактирование компании</span>
            </h3>

            <form onSubmit={handleEditCompany} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Название компании</label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
                    placeholder="Название компании"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">ИНН</label>
                <div className="relative">
                  <Hash className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
                    placeholder="1234567890"
                    value={inn}
                    onChange={(e) => setInn(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">План закупок (короба)</label>
                <div className="relative">
                  <ShoppingBag className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type="number"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
                    placeholder="0"
                    value={purchasePlanCases}
                    onChange={(e) => setPurchasePlanCases(e.target.value)}
                    min="0"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Месячный план (короба)</label>
                <div className="relative">
                  <Hash className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input
                    type="number"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
                    placeholder="0"
                    value={monthlyTargetCases}
                    onChange={(e) => setMonthlyTargetCases(e.target.value)}
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="btn-primary w-full py-3 text-xs flex items-center justify-center gap-2 mt-6"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>Сохранить изменения</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
