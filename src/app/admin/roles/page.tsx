'use client';

import { useState, useEffect } from 'react';
import { 
  Shield, ShieldCheck, ShieldAlert, Plus, Edit2, Trash2, Check, 
  AlertCircle, Loader2, X, Users, Lock, Sparkles, CheckSquare, Square,
  LayoutDashboard, ShoppingCart, Package, Building2, Percent, BarChart3,
  FileSpreadsheet, Database, Eye
} from 'lucide-react';
import { PERMISSION_GROUPS, ALL_PERMISSIONS, PermissionGroup } from '@/lib/permissions';

interface RoleTemplateItem {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  defaultDashboard: string;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
  _count: {
    users: number;
  };
}

export default function AdminRolesPage() {
  const [roles, setRoles] = useState<RoleTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleTemplateItem | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [defaultDashboard, setDefaultDashboard] = useState('/admin');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const loadRoles = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/roles');
      if (res.ok) {
        const data = await res.json();
        setRoles(data);
      } else {
        const err = await res.json();
        setError(err.error || 'Ошибка загрузки шаблонов ролей.');
      }
    } catch (err) {
      setError('Не удалось связаться с сервером.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoles();
  }, []);

  const openCreateModal = () => {
    setEditingRole(null);
    setName('');
    setDescription('');
    setDefaultDashboard('/admin');
    setSelectedPermissions([]);
    setError('');
    setShowModal(true);
  };

  const openEditModal = (role: RoleTemplateItem) => {
    setEditingRole(role);
    setName(role.name);
    setDescription(role.description || '');
    setDefaultDashboard(role.defaultDashboard || '/admin');
    setSelectedPermissions(role.permissions || []);
    setError('');
    setShowModal(true);
  };

  const togglePermission = (code: string) => {
    setSelectedPermissions(prev => 
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  const selectAllGroup = (group: PermissionGroup) => {
    const groupCodes = group.permissions.map(p => p.code);
    const allSelected = groupCodes.every(c => selectedPermissions.includes(c));
    if (allSelected) {
      setSelectedPermissions(prev => prev.filter(c => !groupCodes.includes(c)));
    } else {
      setSelectedPermissions(prev => Array.from(new Set([...prev, ...groupCodes])));
    }
  };

  const selectAllGlobal = () => {
    if (selectedPermissions.length === ALL_PERMISSIONS.length) {
      setSelectedPermissions([]);
    } else {
      setSelectedPermissions([...ALL_PERMISSIONS]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const url = editingRole ? `/api/admin/roles/${editingRole.id}` : '/api/admin/roles';
      const method = editingRole ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          defaultDashboard,
          permissions: selectedPermissions
        })
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess(editingRole ? `Шаблон роли "${name}" обновлен.` : `Шаблон роли "${name}" успешно создан.`);
        setShowModal(false);
        loadRoles();
      } else {
        setError(data.error || 'Ошибка при сохранении шаблона роли.');
      }
    } catch (err) {
      setError('Сетевая ошибка при отправке данных.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (role: RoleTemplateItem) => {
    if (!confirm(`Вы действительно хотите удалить шаблон роли "${role.name}"?`)) {
      return;
    }

    setError('');
    setSuccess('');

    try {
      const res = await fetch(`/api/admin/roles/${role.id}`, { method: 'DELETE' });
      const data = await res.json();

      if (res.ok) {
        setSuccess(`Шаблон роли "${role.name}" удален.`);
        loadRoles();
      } else {
        setError(data.error || 'Не удалось удалить роль.');
      }
    } catch (err) {
      setError('Ошибка соединения при удалении роли.');
    }
  };

  const getModuleIcon = (groupId: string) => {
    switch (groupId) {
      case 'users': return Users;
      case 'companies': return Building2;
      case 'products': return Package;
      case 'orders': return ShoppingCart;
      case 'promotions': return Percent;
      case 'analytics': return BarChart3;
      case 'templates': return FileSpreadsheet;
      case 'system': return Database;
      default: return Shield;
    }
  };

  const totalAssignedUsers = roles.reduce((acc, r) => acc + (r._count?.users || 0), 0);

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <span>Шаблоны ролей и права доступа</span>
          </h2>
          <span className="block text-xs text-slate-400 mt-1 font-semibold">
            Создание настраиваемых ролей с гранулярными правами (RBAC) и прикрепление пользователей
          </span>
        </div>

        <button
          onClick={openCreateModal}
          className="btn-primary flex items-center gap-2 px-4 py-2.5 text-xs w-full sm:w-auto shadow-lg"
        >
          <Plus className="h-4 w-4" />
          <span>Создать шаблон роли</span>
        </button>
      </div>

      {/* Notifications */}
      {success && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-xs sm:text-sm text-emerald-400 flex items-center gap-3 animate-fade-in">
          <Check className="h-5 w-5 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-xs sm:text-sm text-red-400 flex items-center gap-3 animate-fade-in">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-panel p-4 rounded-2xl border border-white/5 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wider font-extrabold text-slate-500">Всего шаблонов</span>
            <span className="text-xl font-extrabold text-slate-100">{roles.length}</span>
          </div>
        </div>

        <div className="glass-panel p-4 rounded-2xl border border-white/5 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wider font-extrabold text-slate-500">Системные роли</span>
            <span className="text-xl font-extrabold text-slate-100">{roles.filter(r => r.isSystem).length}</span>
          </div>
        </div>

        <div className="glass-panel p-4 rounded-2xl border border-white/5 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wider font-extrabold text-slate-500">Пользовательские</span>
            <span className="text-xl font-extrabold text-slate-100">{roles.filter(r => !r.isSystem).length}</span>
          </div>
        </div>

        <div className="glass-panel p-4 rounded-2xl border border-white/5 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wider font-extrabold text-slate-500">Пользователей</span>
            <span className="text-xl font-extrabold text-slate-100">{totalAssignedUsers}</span>
          </div>
        </div>
      </div>

      {/* Role Templates List */}
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {roles.map(role => (
            <div 
              key={role.id} 
              className="glass-panel rounded-3xl p-5 border border-white/5 flex flex-col justify-between hover:border-primary/30 transition-all shadow-glass-sm"
            >
              <div>
                {/* Card Top */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`h-9 w-9 rounded-xl flex items-center justify-center border ${
                      role.isSystem 
                        ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' 
                        : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    }`}>
                      <Shield className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                        <span>{role.name}</span>
                        {role.isSystem && (
                          <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                            Системная
                          </span>
                        )}
                      </h3>
                      <span className="text-[10px] text-slate-500 font-semibold">
                        Дашборд: <strong className="text-slate-400">{role.defaultDashboard || '/admin'}</strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => openEditModal(role)}
                      className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white hover:border-primary/50 transition-all"
                      title="Редактировать права роли"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    {!role.isSystem && (
                      <button
                        onClick={() => handleDelete(role)}
                        className="p-1.5 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                        title="Удалить роль"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Description */}
                <p className="mt-3 text-xs text-slate-400 leading-relaxed line-clamp-2">
                  {role.description || 'Описание отсутствует.'}
                </p>

                {/* Permissions summary */}
                <div className="mt-4 pt-3 border-t border-white/5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2">
                    <span>Разрешения ({role.permissions.length} из {ALL_PERMISSIONS.length})</span>
                    <span className="text-slate-500">
                      {Math.round((role.permissions.length / ALL_PERMISSIONS.length) * 100)}%
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden mb-3">
                    <div 
                      className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
                      style={{ width: `${(role.permissions.length / ALL_PERMISSIONS.length) * 100}%` }}
                    />
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1.5 max-h-20 overflow-hidden">
                    {role.permissions.slice(0, 6).map(p => (
                      <span key={p} className="text-[9px] font-semibold px-2 py-0.5 rounded-md bg-white/5 text-slate-300 border border-white/5">
                        {p}
                      </span>
                    ))}
                    {role.permissions.length > 6 && (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400">
                        +{role.permissions.length - 6} ещё
                      </span>
                    )}
                    {role.permissions.length === 0 && (
                      <span className="text-[10px] text-slate-500 italic">Права не назначены</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Card Footer */}
              <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-slate-400 text-[11px] font-semibold">
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <span>Прикреплено пользователей: <strong className="text-slate-200">{role._count.users}</strong></span>
                </span>
                <button
                  onClick={() => openEditModal(role)}
                  className="text-primary hover:text-primary-focus text-[11px] font-bold inline-flex items-center gap-1"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>Настроить права</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal for Creating / Editing Role Template */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-4xl rounded-3xl p-6 sm:p-8 relative max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-white/5 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-200">
                    {editingRole ? `Настройка шаблона роли: ${editingRole.name}` : 'Создание нового шаблона роли'}
                  </h3>
                  <span className="block text-xs text-slate-400">
                    Определите название, стартовый раздел и набор разрешений для роли
                  </span>
                </div>
              </div>

              <button 
                onClick={() => setShowModal(false)}
                className="h-8 w-8 rounded-lg bg-white/5 text-slate-400 hover:text-white flex items-center justify-center transition-all"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto py-5 space-y-6 pr-1">
              {error && (
                <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3.5 text-xs text-red-400 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Basic Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Название роли <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-xl px-4 py-2.5 text-xs glass-input"
                    placeholder="Например: Оператор склада / Бухгалтер"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Стартовый раздел по умолчанию
                  </label>
                  <select
                    className="w-full rounded-xl px-4 py-2.5 text-xs glass-input focus:bg-slate-900"
                    value={defaultDashboard}
                    onChange={(e) => setDefaultDashboard(e.target.value)}
                  >
                    <option value="/admin">Панель администратора (/admin)</option>
                    <option value="/seller">Консоль продаж (/seller)</option>
                    <option value="/customer">Кабинет клиента (/customer)</option>
                    <option value="/analytics">Дашборд аналитики (/analytics)</option>
                  </select>
                </div>

                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Описание назначения роли
                  </label>
                  <textarea
                    rows={2}
                    className="w-full rounded-xl px-4 py-2 text-xs glass-input resize-none"
                    placeholder="Кратко опишите, какие обязанности выполняет пользователь с этой ролью..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>

              {/* Permissions Matrix Header */}
              <div className="pt-3 border-t border-white/5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                  <div>
                    <h4 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                      <Lock className="h-4 w-4 text-primary" />
                      <span>Матрица гранулярных разрешений</span>
                    </h4>
                    <span className="text-xs text-slate-400">
                      Выбрано разрешений: <strong className="text-primary font-bold">{selectedPermissions.length}</strong> из {ALL_PERMISSIONS.length}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={selectAllGlobal}
                    className="px-3 py-1.5 rounded-xl border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 text-xs font-bold transition-all self-start sm:self-auto"
                  >
                    {selectedPermissions.length === ALL_PERMISSIONS.length ? 'Снять все разрешения' : 'Выбрать все разрешения'}
                  </button>
                </div>

                {/* Modules Grid */}
                <div className="space-y-4">
                  {PERMISSION_GROUPS.map(group => {
                    const GroupIcon = getModuleIcon(group.id);
                    const groupCodes = group.permissions.map(p => p.code);
                    const selectedCount = groupCodes.filter(c => selectedPermissions.includes(c)).length;
                    const isAllSelected = selectedCount === groupCodes.length;

                    return (
                      <div key={group.id} className="rounded-2xl border border-white/5 bg-slate-950/40 p-4 space-y-3">
                        {/* Group Header */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className="h-7 w-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-slate-300">
                              <GroupIcon className="h-3.5 w-3.5" />
                            </div>
                            <div>
                              <span className="text-xs font-bold text-slate-200">{group.name}</span>
                              <span className="block text-[10px] text-slate-500">{group.description}</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => selectAllGroup(group)}
                            className="text-[10px] font-bold text-slate-400 hover:text-primary transition-all flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5"
                          >
                            {isAllSelected ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5" />}
                            <span>{isAllSelected ? 'Снять группу' : 'Вся группа'}</span>
                          </button>
                        </div>

                        {/* Permissions in Group */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
                          {group.permissions.map(perm => {
                            const isChecked = selectedPermissions.includes(perm.code);
                            return (
                              <label
                                key={perm.code}
                                className={`flex items-start gap-3 p-2.5 rounded-xl border cursor-pointer select-none transition-all ${
                                  isChecked 
                                    ? 'border-primary/40 bg-primary/5 text-slate-200' 
                                    : 'border-white/5 bg-white/[0.02] text-slate-400 hover:bg-white/5'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => togglePermission(perm.code)}
                                  className="mt-0.5 rounded border-white/10 bg-slate-900 text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between">
                                    <span className={`text-xs font-bold ${isChecked ? 'text-slate-200' : 'text-slate-300'}`}>
                                      {perm.name}
                                    </span>
                                    <span className="text-[9px] font-mono text-slate-500">{perm.code}</span>
                                  </div>
                                  <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{perm.description}</p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-white/5 flex items-center justify-end gap-3 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-5 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition-all"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary px-6 py-2.5 text-xs font-bold flex items-center gap-2"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  <span>{editingRole ? 'Сохранить изменения' : 'Создать роль'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
