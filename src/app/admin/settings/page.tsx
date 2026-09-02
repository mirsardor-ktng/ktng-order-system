'use client';

import { useState, useEffect } from 'react';
import { 
  Settings, Database, Save, Upload, Download, Check, 
  AlertCircle, Loader2, Key, Mail, FolderOpen, ShieldCheck, 
  ShieldAlert, RefreshCcw, Landmark 
} from 'lucide-react';

interface Metrics {
  totalUsers: number;
  totalOrders: number;
  totalTemplates: number;
}

export default function AdminSettings() {
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [folderId, setFolderId] = useState('');
  const [encryptionKey, setEncryptionKey] = useState('');
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [recoveringFiles, setRecoveringFiles] = useState(false);
  const [migratingGroups, setMigratingGroups] = useState(false);
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Load active connection settings and db metrics
  const loadSettings = async () => {
    try {
      const res = await fetch('/api/admin/gdrive');
      if (res.ok) {
        const data = await res.json();
        setSyncEnabled(data.syncEnabled);
        setIsAuthorized(data.isAuthorized);
        setFolderId(data.folderId);
        setEncryptionKey(data.encryptionKey);
        setMetrics(data.metrics);
      }
    } catch (err) {
      setError('Не удалось загрузить параметры интеграции.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
    
    // Check URL for OAuth callbacks
    const params = new URLSearchParams(window.location.search);
    if (params.get('gdrive_success')) {
      setSuccess('Авторизация Google Drive успешно завершена.');
      window.history.replaceState({}, '', '/admin/settings');
    }
    if (params.get('gdrive_error')) {
      setError('Ошибка авторизации: ' + params.get('gdrive_error'));
      window.history.replaceState({}, '', '/admin/settings');
    }
  }, []);

  // Save Settings handler
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/admin/gdrive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_settings',
          syncEnabled,
          folderId,
          encryptionKey
        })
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(data.message || 'Параметры интеграции сохранены.');
        loadSettings();
      } else {
        setError(data.error || 'Ошибка при сохранении параметров.');
      }
    } catch (err) {
      setError('Сбой подключения к серверу.');
    } finally {
      setSaving(false);
    }
  };

  // Manual Backup trigger
  const handleManualBackup = async () => {
    setBackingUp(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/admin/gdrive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'backup_users' })
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(data.message);
        loadSettings();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Ошибка при резервном копировании пользователей.');
    } finally {
      setBackingUp(false);
    }
  };

  // Manual Restore trigger
  const handleManualRestore = async () => {
    if (!confirm('Вы собираетесь восстановить базу данных пользователей из зашифрованной резервной копии Google Drive. Отсутствующие пользователи будут импортированы. Продолжить?')) {
      return;
    }

    setRestoring(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/admin/gdrive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore_users' })
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(data.message);
        loadSettings();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Ошибка при восстановлении базы пользователей.');
    } finally {
      setRestoring(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 w-full flex-col items-center justify-center text-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-xs font-semibold text-slate-400">Синхронизируем параметры Google Drive...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Settings className="h-5 w-5 text-primary" />
          <span>Интеграция с Google Drive & Безопасность архивов</span>
        </h2>
        <span className="block text-xs text-slate-400 mt-1 font-semibold">
          Настройка доступов к облачному хранилищу, параметров шифрования AES-256 и ручного восстановления
        </span>
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

      {/* Main Settings layout split */}
      <div className="grid gap-6 lg:grid-cols-3">
        
        {/* Section left: Credentials Form (takes up 2 columns) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-panel rounded-3xl p-5 sm:p-8 space-y-6">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2 border-b border-white/5 pb-4">
              <Landmark className="h-5 w-5 text-indigo-400" />
              <span>Параметры подключения Google OAuth 2.0</span>
            </h3>

            <form onSubmit={handleSaveSettings} className="space-y-4">
              {/* OAuth Auth Status */}
              <div className="flex items-center justify-between p-4 bg-slate-900/40 rounded-2xl border border-white/5">
                <div>
                  <span className="block text-xs font-bold text-slate-200">Авторизация Google Drive</span>
                  <span className="block text-[10px] text-slate-500 font-semibold mt-0.5 leading-normal">
                    {isAuthorized 
                      ? 'Приложение привязано к аккаунту Google Drive.'
                      : 'Для работы требуется авторизация через Google OAuth 2.0.'}
                  </span>
                </div>
                {!isAuthorized ? (
                  <button
                    type="button"
                    onClick={() => window.location.href = '/api/admin/gdrive/auth'}
                    className="btn-primary px-4 py-2 text-xs flex items-center gap-2"
                  >
                    Авторизовать
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => window.location.href = '/api/admin/gdrive/auth'}
                    className="bg-slate-800 text-slate-300 hover:bg-slate-700 px-4 py-2 rounded-xl text-xs flex items-center gap-2 transition-colors border border-white/10"
                  >
                    Переавторизовать
                  </button>
                )}
              </div>

              {/* Enable Toggle Switch */}
              <div className="flex items-center justify-between p-4 bg-slate-900/40 rounded-2xl border border-white/5">
                <div>
                  <span className="block text-xs font-bold text-slate-200">Синхронизация Google Drive</span>
                  <span className="block text-[10px] text-slate-500 font-semibold mt-0.5 leading-normal">
                    Включение синхронизации заказов, логов и пользователей в реальном времени.
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={syncEnabled}
                    onChange={(e) => setSyncEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:after:bg-white peer-checked:after:border-white"></div>
                </label>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Идентификатор корневой папки (Folder ID)</label>
                <div className="relative">
                  <FolderOpen className="absolute left-3 top-3 h-4.5 w-4.5 text-slate-400" />
                  <input
                    type="text"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input"
                    placeholder="1rWd_..."
                    value={folderId}
                    onChange={(e) => setFolderId(e.target.value)}
                    required={syncEnabled}
                  />
                </div>
              </div>

              <hr className="border-white/5" />

              {/* AES Passphrase */}
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Key className="h-4 w-4 text-cyan-400" />
                    <span>Настройка шифрования AES-256</span>
                  </h4>
                  <span className="block text-[10px] text-slate-500 font-semibold leading-normal mt-0.5">
                    Ключ шифрования используется для закрытия данных пользователей перед отправкой в облако Google Drive.
                  </span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">AES Мастер-Пароль</label>
                  <div className="relative">
                    <ShieldCheck className="absolute left-3 top-3 h-4.5 w-4.5 text-slate-400" />
                    <input
                      type="text"
                      className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input font-bold"
                      value={encryptionKey}
                      onChange={(e) => setEncryptionKey(e.target.value)}
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Submit button */}
              <button
                type="submit"
                disabled={saving}
                className="btn-primary w-full sm:w-auto px-6 py-3 text-xs flex items-center justify-center gap-2 mt-6"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                <span>Сохранить конфигурацию интеграции</span>
              </button>
            </form>
          </div>
        </div>

        {/* Section right: Backup Actions / metrics */}
        <div className="space-y-6">
          {/* Backup Storage manager */}
          <div className="glass-panel rounded-3xl p-5 sm:p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <Database className="h-4.5 w-4.5 text-cyan-400" />
              <span>Диспетчер резервных копий (User Backups)</span>
            </h3>
            
            <p className="text-xs text-slate-400 leading-normal">
              Вы можете запустить принудительное создание зашифрованной резервной копии пользователей на Google Drive или восстановить локальную БД из облачного бэкапа.
            </p>

            <div className="space-y-2.5 pt-2">
              <button
                onClick={handleManualBackup}
                disabled={backingUp || restoring}
                className="w-full btn-secondary flex items-center justify-center gap-2.5 py-3 text-xs"
              >
                {backingUp ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 text-primary" />
                )}
                <span>Выгрузить зашифрованный бэкап</span>
              </button>

              <button
                onClick={handleManualRestore}
                disabled={restoring || backingUp}
                className="w-full btn-secondary flex items-center justify-center gap-2.5 py-3 text-xs"
              >
                {restoring ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 text-emerald-400" />
                )}
                <span>Восстановить из облачного бэкапа</span>
              </button>
            </div>
          </div>

          {/* Database utilities */}
          <div className="glass-panel rounded-3xl p-5 sm:p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <RefreshCcw className="h-4.5 w-4.5 text-cyan-400" />
              <span>Утилиты базы данных</span>
            </h3>

            <div className="space-y-2.5 pt-2">
              <button
                onClick={async () => {
                  if (!confirm('Запустить миграцию компаний? Это может занять некоторое время.')) return;
                  setMigrating(true);
                  setError('');
                  setSuccess('');
                  try {
                    const res = await fetch('/api/admin/migrate', { method: 'POST' });
                    const data = await res.json();
                    if (res.ok) {
                      setSuccess(data.message || 'Миграция компаний завершена успешно.');
                    } else {
                      setError(data.error || 'Ошибка при миграции компаний.');
                    }
                  } catch (err) {
                    setError('Ошибка сети при запуске миграции.');
                  } finally {
                    setMigrating(false);
                  }
                }}
                disabled={migrating || recoveringFiles}
                className="w-full btn-secondary flex items-center justify-center gap-2.5 py-3 text-xs"
              >
                {migrating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="h-4 w-4 text-cyan-400" />
                )}
                <span>Запустить миграцию компаний</span>
              </button>

              <button
                onClick={async () => {
                  if (!confirm('Восстановить ссылки файлов? Это может занять некоторое время.')) return;
                  setRecoveringFiles(true);
                  setError('');
                  setSuccess('');
                  try {
                    const res = await fetch('/api/admin/recover-files', { method: 'POST' });
                    const data = await res.json();
                    if (res.ok) {
                      setSuccess(data.message || 'Ссылки файлов восстановлены успешно.');
                    } else {
                      setError(data.error || 'Ошибка при восстановлении ссылок файлов.');
                    }
                  } catch (err) {
                    setError('Ошибка сети при восстановлении файлов.');
                  } finally {
                    setRecoveringFiles(false);
                  }
                }}
                disabled={recoveringFiles || migrating || migratingGroups}
                className="w-full btn-secondary flex items-center justify-center gap-2.5 py-3 text-xs"
              >
                {recoveringFiles ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="h-4 w-4 text-emerald-400" />
                )}
                <span>Восстановить ссылки файлов</span>
              </button>

              <button
                onClick={async () => {
                  if (!confirm('Запустить миграцию товаров в логические группы? Все непривязанные товары будут помещены в собственные группы.')) return;
                  setMigratingGroups(true);
                  setError('');
                  setSuccess('');
                  try {
                    const res = await fetch('/api/admin/migrate-groups', { method: 'POST' });
                    const data = await res.json();
                    if (res.ok) {
                      setSuccess(data.message || 'Миграция товаров в группы завершена успешно.');
                    } else {
                      setError(data.error || 'Ошибка при миграции товаров в группы.');
                    }
                  } catch (err) {
                    setError('Ошибка сети при миграции товаров.');
                  } finally {
                    setMigratingGroups(false);
                  }
                }}
                disabled={migratingGroups || migrating || recoveringFiles}
                className="w-full btn-secondary flex items-center justify-center gap-2.5 py-3 text-xs"
              >
                {migratingGroups ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="h-4 w-4 text-indigo-400" />
                )}
                <span>Мигрировать товары в группы</span>
              </button>
            </div>
          </div>

          {/* Database metrics details */}
          <div className="glass-panel rounded-3xl p-5 sm:p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <ShieldAlert className="h-4.5 w-4.5 text-amber-500 animate-pulse-slow" />
              <span>Характеристики системы</span>
            </h3>

            {metrics && (
              <div className="space-y-3 text-xs text-slate-400">
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span>Дилеры & Пользователи:</span>
                  <span className="font-bold text-slate-200">{metrics.totalUsers} записей</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span>Оформленные закупки:</span>
                  <span className="font-bold text-slate-200">{metrics.totalOrders} заказов</span>
                </div>
                <div className="flex justify-between pb-1">
                  <span>Бланки накладных:</span>
                  <span className="font-bold text-slate-200">{metrics.totalTemplates} шаблонов</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
