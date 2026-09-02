'use client';

import { useState, useEffect } from 'react';
import { 
  Users, UserPlus, Edit, Trash2, ShieldCheck, Mail, Lock, 
  User, Check, AlertCircle, Loader2, X, ShieldAlert, Building2
} from 'lucide-react';

interface CompanyShort {
  id: string;
  name: string;
}

interface UserItem {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'SELLER' | 'CUSTOMER' | 'MANAGER';
  isActive: boolean;
  companyId: string | null;
  company?: CompanyShort | null;
  createdAt: string;
}

export default function AdminUsers() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [companies, setCompanies] = useState<CompanyShort[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  
  // Active User Item under modification
  const [activeUser, setActiveUser] = useState<UserItem | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'SELLER' | 'CUSTOMER' | 'MANAGER'>('CUSTOMER');
  const [companyId, setCompanyId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Load user database list
  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (err) {
      setError('Не удалось загрузить список пользователей.');
    } finally {
      setLoading(false);
    }
  };

  // Load companies for association
  const loadCompanies = async () => {
    try {
      const res = await fetch('/api/admin/companies');
      if (res.ok) {
        const data = await res.json();
        setCompanies(data);
      }
    } catch (err) {
      console.error('Failed to load companies', err);
    }
  };

  useEffect(() => {
    Promise.all([loadUsers(), loadCompanies()]);
  }, []);

  const clearForm = () => {
    setName('');
    setEmail('');
    setPassword('');
    setRole('CUSTOMER');
    setCompanyId('');
    setIsActive(true);
    setError('');
  };

  // Add User handler
  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name, 
          email, 
          password, 
          role,
          companyId: role === 'CUSTOMER' && companyId ? companyId : undefined
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(`Пользователь ${email} успешно создан.`);
        setShowAddModal(false);
        clearForm();
        loadUsers();
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
  const openEditModal = (user: UserItem) => {
    setActiveUser(user);
    setName(user.name);
    setEmail(user.email);
    setRole(user.role);
    setCompanyId(user.companyId || '');
    setIsActive(user.isActive);
    setPassword(''); // keep blank unless updating
    setShowEditModal(true);
  };

  // Update User handler
  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeUser) return;
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: activeUser.id, 
          name, 
          email, 
          role,
          companyId: role === 'CUSTOMER' && companyId ? companyId : null,
          isActive,
          password: password || undefined // only update password if entered
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(`Профиль ${email} успешно обновлен.`);
        setShowEditModal(false);
        clearForm();
        setActiveUser(null);
        loadUsers();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Не удалось связаться с сервером.');
    } finally {
      setSubmitting(false);
    }
  };

  // Toggle user active status directly
  const handleToggleActive = async (user: UserItem) => {
    setError('');
    setSuccess('');
    const newStatus = !user.isActive;

    try {
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: user.id, 
          isActive: newStatus
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(`Статус пользователя ${user.email} изменен на: ${newStatus ? 'Активен' : 'Деактивирован'}.`);
        loadUsers();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Не удалось изменить статус пользователя.');
    }
  };

  // Delete User handler
  const handleDeleteUser = async (user: UserItem) => {
    if (!confirm(`Вы действительно хотите безвозвратно удалить пользователя ${user.name} (${user.email})?`)) {
      return;
    }

    setError('');
    setSuccess('');

    try {
      const res = await fetch(`/api/admin/users?id=${user.id}`, {
        method: 'DELETE',
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(`Пользователь ${user.email} был успешно удален.`);
        loadUsers();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Ошибка удаления пользователя.');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <span>Управление пользователями системы</span>
          </h2>
          <span className="block text-xs text-slate-400 mt-1 font-semibold">
            Регистрация новых B2B заказчиков (Customers), менеджеров (Sellers) и привязка к компаниям
          </span>
        </div>

        <button
          onClick={() => { clearForm(); setShowAddModal(true); }}
          className="btn-primary flex items-center gap-2 px-4 py-2.5 text-xs w-full sm:w-auto"
        >
          <UserPlus className="h-4 w-4" />
          <span>Создать пользователя</span>
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

      {/* Cloud Indicator banner */}
      <div className="rounded-2xl border border-indigo-500/10 bg-indigo-500/5 p-4 flex items-start sm:items-center gap-3.5 text-xs text-slate-400">
        <ShieldCheck className="h-6 w-6 text-indigo-400 flex-shrink-0" />
        <div className="leading-relaxed">
          <span className="font-bold text-slate-300">Безопасность хранения:</span> Все созданные и измененные пользователи автоматически хэшируются по стандарту <strong>bcrypt</strong>, шифруются <strong>AES-256-CBC</strong> с использованием вашего мастер-ключа и резервируются в Google Drive в виде защищенного JSON-пакета.
        </div>
      </div>

      {/* Database User Table */}
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="glass-panel rounded-3xl overflow-hidden border border-white/5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 bg-slate-950/40 text-[10px] text-slate-400 uppercase tracking-wider font-extrabold">
                  <th className="py-4 px-6">ФИО / Название</th>
                  <th className="py-4 px-6">Электронная почта</th>
                  <th className="py-4 px-6">Компания</th>
                  <th className="py-4 px-6">Роль в системе</th>
                  <th className="py-4 px-6">Статус</th>
                  <th className="py-4 px-6 text-right">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs">
                {users.map((u) => (
                  <tr key={u.id} className={`hover:bg-white/5 transition-all ${!u.isActive ? 'opacity-60' : ''} text-slate-300`}>
                    <td className="py-4 px-6 font-bold text-slate-200">{u.name}</td>
                    <td className="py-4 px-6 font-semibold">{u.email}</td>
                    <td className="py-4 px-6 font-semibold text-slate-400">
                      {u.company ? (
                        <span className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-indigo-400" />
                          <span>{u.company.name}</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-4 px-6">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-extrabold tracking-wider ${
                        u.role === 'ADMIN' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' :
                        u.role === 'SELLER' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' :
                        u.role === 'MANAGER' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                        'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="py-4 px-6 font-semibold">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-bold ${
                        u.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                      }`}>
                        {u.isActive ? 'Активен' : 'Отключен'}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right space-x-2">
                      <button
                        onClick={() => handleToggleActive(u)}
                        className={`p-1.5 rounded-lg border ${
                          u.isActive ? 'border-amber-500/25 bg-amber-500/10 text-amber-400' : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
                        } hover:scale-105 transition-all inline-flex`}
                        title={u.isActive ? 'Деактивировать аккаунт' : 'Активировать аккаунт'}
                      >
                        {u.isActive ? <ShieldAlert className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => openEditModal(u)}
                        className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white transition-all inline-flex"
                        title="Редактировать профиль"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteUser(u)}
                        className="p-1.5 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all inline-flex"
                        title="Удалить аккаунт"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add User Modal */}
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
              <UserPlus className="h-5 w-5 text-primary" />
              <span>Регистрация нового пользователя</span>
            </h3>

            <form onSubmit={handleAddUser} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">ФИО / Название дилера</label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-4.5 w-4.5 text-slate-400" />
                  <input
                    type="text"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
                    placeholder="Азия Табак"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Адрес электронной почты</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4.5 w-4.5 text-slate-400" />
                  <input
                    type="email"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
                    placeholder="dealer@asiatobacco.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Временный пароль</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4.5 w-4.5 text-slate-400" />
                  <input
                    type="password"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
                    placeholder="Временный пароль"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Роль в системе</label>
                <select
                  className="w-full rounded-xl px-4 py-2.5 text-xs glass-input focus:bg-slate-900"
                  value={role}
                  onChange={(e) => {
                    const selectedRole = e.target.value as any;
                    setRole(selectedRole);
                    if (selectedRole !== 'CUSTOMER') setCompanyId('');
                  }}
                >
                  <option value="CUSTOMER">CUSTOMER (Заказчик / Дилер)</option>
                  <option value="SELLER">SELLER (Менеджер продаж)</option>
                  <option value="MANAGER">MANAGER (Ограниченный менеджер)</option>
                  <option value="ADMIN">ADMIN (Суперадминистратор)</option>
                </select>
              </div>

              {role === 'CUSTOMER' && (
                <div className="space-y-1.5 animate-slide-down">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Привязать к Компании</label>
                  <select
                    className="w-full rounded-xl px-4 py-2.5 text-xs glass-input focus:bg-slate-900"
                    value={companyId}
                    onChange={(e) => setCompanyId(e.target.value)}
                  >
                    <option value="">-- Выберите компанию --</option>
                    {companies.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="btn-primary w-full py-3 text-xs flex items-center justify-center gap-2 mt-6"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>Создать аккаунт</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && activeUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-md rounded-3xl p-6 sm:p-8 relative max-h-[90vh] overflow-y-auto">
            <button 
              onClick={() => { setShowEditModal(false); setActiveUser(null); }}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-base font-bold text-slate-200 mb-6 flex items-center gap-2">
              <Edit className="h-5 w-5 text-primary" />
              <span>Редактирование профиля</span>
            </h3>

            <form onSubmit={handleEditUser} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">ФИО / Название дилера</label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-4.5 w-4.5 text-slate-400" />
                  <input
                    type="text"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
                    placeholder="ФИО"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Электронная почта</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4.5 w-4.5 text-slate-400" />
                  <input
                    type="email"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Новый пароль (оставьте пустым для сохранения старого)</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4.5 w-4.5 text-slate-400" />
                  <input
                    type="password"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
                    placeholder="Новый пароль (опционально)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Роль в системе</label>
                <select
                  className="w-full rounded-xl px-4 py-2.5 text-xs glass-input focus:bg-slate-900"
                  value={role}
                  onChange={(e) => {
                    const selectedRole = e.target.value as any;
                    setRole(selectedRole);
                    if (selectedRole !== 'CUSTOMER') setCompanyId('');
                  }}
                >
                  <option value="CUSTOMER">CUSTOMER (Заказчик / Дилер)</option>
                  <option value="SELLER">SELLER (Менеджер продаж)</option>
                  <option value="MANAGER">MANAGER (Ограниченный менеджер)</option>
                  <option value="ADMIN">ADMIN (Суперадминистратор)</option>
                </select>
              </div>

              {role === 'CUSTOMER' && (
                <div className="space-y-1.5 animate-slide-down">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Привязать к Компании</label>
                  <select
                    className="w-full rounded-xl px-4 py-2.5 text-xs glass-input focus:bg-slate-900"
                    value={companyId}
                    onChange={(e) => setCompanyId(e.target.value)}
                  >
                    <option value="">-- Без компании --</option>
                    {companies.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <input 
                  type="checkbox" 
                  id="edit-is-active"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded border-white/10 bg-slate-900 text-primary focus:ring-primary w-4.5 h-4.5 cursor-pointer"
                />
                <label htmlFor="edit-is-active" className="text-xs font-semibold text-slate-350 cursor-pointer select-none">Активный аккаунт (разрешить вход)</label>
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
