'use client';

import { useState, useEffect } from 'react';
import { 
  FolderSymlink, FileSpreadsheet, Upload, CheckCircle2, 
  Trash2, AlertCircle, Check, Loader2, PlaySquare, Calendar 
} from 'lucide-react';

interface TemplateItem {
  id: string;
  name: string;
  fileId: string | null;
  isActive: boolean;
  uploadDate: string;
  version: string;
  isLocal: boolean;
  filePath: string | null;
  outputMode?: 'COMMERCIAL' | 'INVENTORY';
}

export default function AdminTemplates() {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form upload states
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState('1.0.0');
  const [uploading, setUploading] = useState(false);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/templates');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch (err) {
      setError('Не удалось загрузить реестр Excel шаблонов.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  // Upload handler
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Пожалуйста, выберите файл XLSX.');
      return;
    }

    setUploading(true);
    setError('');
    setSuccess('');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('version', version);

    try {
      const res = await fetch('/api/admin/templates', {
        method: 'POST',
        body: formData // multipart upload
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(data.message || 'Шаблон успешно загружен.');
        setFile(null);
        setVersion('1.0.0');
        // Reset file input element
        const fileInput = document.getElementById('template-file-input') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
        loadTemplates();
      } else {
        setError(data.error || 'Ошибка при загрузке шаблона.');
      }
    } catch (err) {
      setError('Не удалось подключиться к серверу для отправки файла.');
    } finally {
      setUploading(false);
    }
  };

  // Toggle active template
  const handleActivate = async (id: string) => {
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/admin/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isActive: true }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(data.message);
        loadTemplates();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Сбой активации шаблона.');
    }
  };

  // Update output mode
  const handleOutputModeChange = async (id: string, outputMode: 'COMMERCIAL' | 'INVENTORY') => {
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/admin/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, outputMode }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(`Режим вывода для шаблона изменен на ${outputMode === 'COMMERCIAL' ? 'Коммерческий' : 'Складской'}.`);
        loadTemplates();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Сбой обновления режима вывода шаблона.');
    }
  };

  // Delete template
  const handleDelete = async (template: TemplateItem) => {
    if (!confirm(`Вы действительно хотите удалить шаблон "${template.name}"?`)) {
      return;
    }

    setError('');
    setSuccess('');

    try {
      const res = await fetch(`/api/admin/templates?id=${template.id}`, {
        method: 'DELETE',
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(data.message);
        loadTemplates();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Сбой удаления шаблона.');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <FolderSymlink className="h-5 w-5 text-primary" />
          <span>Шаблонизатор накладных заказа (XLSX Templates)</span>
        </h2>
        <span className="block text-xs text-slate-400 mt-1 font-semibold">
          Управление бланками Excel, переключение активных форм и автоматическая синхронизация с папкой Google Drive Templates
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

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Section left: Uploader Form */}
        <div className="glass-panel rounded-3xl p-5 sm:p-6 h-fit space-y-4">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <Upload className="h-4.5 w-4.5 text-indigo-400" />
            <span>Загрузить новый бланк (.xlsx)</span>
          </h3>

          <form onSubmit={handleUpload} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Файл XLSX бланка</label>
              <input
                id="template-file-input"
                type="file"
                accept=".xlsx"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-slate-300 border border-white/5 bg-slate-950/30 p-2.5 rounded-xl file:mr-4 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-[10px] file:font-extrabold file:bg-slate-800 file:text-slate-300 file:cursor-pointer hover:file:bg-slate-700"
                required
              />
              <span className="text-[9px] text-slate-500 block leading-tight">
                * Шаблон должен использовать плейсхолдеры: {`{CLIENT_NAME}, {ORDER_DATE}, {SKU_NAME}, {QTY_BLOCKS}`}
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Версия ревизии</label>
              <input
                type="text"
                className="w-full rounded-xl px-4 py-2.5 text-xs glass-input"
                placeholder="1.0.0"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              disabled={uploading}
              className="btn-primary w-full py-3 text-xs flex items-center justify-center gap-2"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Выгружаем в облако...</span>
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  <span>Загрузить шаблон</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Section right: Active Templates list Grid (takes up 2 columns) */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <FileSpreadsheet className="h-4.5 w-4.5 text-emerald-400" />
            <span>Реестр загруженных Excel бланков</span>
          </h3>

          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center glass-panel rounded-2xl">
              <FileSpreadsheet className="h-8 w-8 text-slate-500 mb-2" />
              <p className="text-xs text-slate-400">Шаблоны в системе отсутствуют.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map((tpl) => (
                <div 
                  key={tpl.id}
                  className={`glass-panel rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 transition-all ${
                    tpl.isActive ? 'border-emerald-500/40 bg-emerald-950/5 shadow-glow-success' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0 ${
                      tpl.isActive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-900 text-slate-400 border border-white/5'
                    }`}>
                      <FileSpreadsheet className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-extrabold text-sm text-slate-200">{tpl.name}</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                          v{tpl.version}
                        </span>
                        {tpl.isActive && (
                          <span className="inline-flex items-center gap-1 text-[8px] font-extrabold px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                            АКТИВНЫЙ БЛАНК
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500 mt-1 font-semibold">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          <span>Загружен: {new Date(tpl.uploadDate).toLocaleDateString('ru-RU')}</span>
                        </span>
                        <span>Хранилище: {tpl.isLocal ? 'Локальное' : 'Google Drive'}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Режим вывода:</span>
                        <div className="inline-flex rounded-lg bg-slate-900/80 p-0.5 border border-white/5 text-[9px] font-bold">
                          <button
                            type="button"
                            onClick={() => handleOutputModeChange(tpl.id, 'COMMERCIAL')}
                            className={`px-2 py-1 rounded-md transition-all ${
                              (tpl.outputMode || 'COMMERCIAL') === 'COMMERCIAL'
                                ? 'bg-primary text-white shadow'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            ○ Commercial
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOutputModeChange(tpl.id, 'INVENTORY')}
                            className={`px-2 py-1 rounded-md transition-all ${
                              tpl.outputMode === 'INVENTORY'
                                ? 'bg-primary text-white shadow'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            ○ Inventory
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 w-full sm:w-auto justify-end">
                    {tpl.isActive && (
                      <a
                        href="/api/admin/templates/trial"
                        download
                        className="btn-primary bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-500/30 px-3 py-2 text-[10px] flex items-center gap-1.5"
                        title="Скачать пробный заполненный Excel-заказ по этому шаблону"
                      >
                        <PlaySquare className="h-3.5 w-3.5" />
                        <span>Тестовый заказ</span>
                      </a>
                    )}

                    {!tpl.isActive && (
                      <button
                        onClick={() => handleActivate(tpl.id)}
                        className="btn-primary px-3 py-2 text-[10px] flex items-center gap-1.5"
                        title="Активировать этот бланк для заказов"
                      >
                        <PlaySquare className="h-3.5 w-3.5" />
                        <span>Активировать</span>
                      </button>
                    )}
                    
                    {!tpl.isActive && (
                      <button
                        onClick={() => handleDelete(tpl)}
                        className="btn-secondary px-3 py-2 text-[10px] text-red-400 border-red-500/10 bg-red-500/5 hover:bg-red-500/15 flex items-center justify-center"
                        title="Удалить бланк"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
