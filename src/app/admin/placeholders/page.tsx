'use client';

import { useState, useEffect } from 'react';
import { 
  MapPin, HelpCircle, Edit, Plus, Check, AlertCircle, 
  Loader2, X, Tag, FileCode, PlaySquare, Trash2
} from 'lucide-react';

interface MappingItem {
  id: string;
  placeholder: string;
  systemField: string;
  description: string;
}

export default function AdminPlaceholders() {
  const [mappings, setMappings] = useState<MappingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [activeMapping, setActiveMapping] = useState<MappingItem | null>(null);

  // Form states
  const [placeholder, setPlaceholder] = useState('');
  const [systemField, setSystemField] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadMappings = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/placeholders');
      if (res.ok) {
        const data = await res.json();
        setMappings(data);
      }
    } catch (err) {
      setError('Не удалось загрузить реестр плейсхолдеров.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMappings();
  }, []);

  const clearForm = () => {
    setPlaceholder('');
    setSystemField('');
    setDescription('');
    setError('');
  };

  // Add Placeholder handler
  const handleAddMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/admin/placeholders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeholder, systemField, description }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(`Маппинг плейсхолдера "${placeholder}" успешно создан.`);
        setShowAddModal(false);
        clearForm();
        loadMappings();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Ошибка связи с сервером.');
    } finally {
      setSubmitting(false);
    }
  };

  // Open Edit Modal
  const openEditModal = (mapping: MappingItem) => {
    setActiveMapping(mapping);
    setPlaceholder(mapping.placeholder);
    setSystemField(mapping.systemField);
    setDescription(mapping.description);
    setShowEditModal(true);
  };

  // Update Placeholder handler
  const handleEditMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMapping) return;
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/admin/placeholders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: activeMapping.id, 
          placeholder, 
          systemField, 
          description 
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(`Плейсхолдер "${placeholder}" обновлен.`);
        setShowEditModal(false);
        clearForm();
        setActiveMapping(null);
        loadMappings();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Ошибка связи с сервером.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMapping = async (id: string, placeholderName: string) => {
    if (!confirm(`Вы уверены, что хотите удалить маппинг для плейсхолдера "${placeholderName}"?`)) {
      return;
    }
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/admin/placeholders?id=${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(`Плейсхолдер "${placeholderName}" успешно удален.`);
        loadMappings();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Ошибка связи с сервером.');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            <span>Система Excel плейсхолдеров (Placeholder Mapping)</span>
          </h2>
          <span className="block text-xs text-slate-400 mt-1 font-semibold">
            Привязка специальных переменных в Excel шаблоне к реальным данным B2B заказов
          </span>
        </div>

        <button
          onClick={() => { clearForm(); setShowAddModal(true); }}
          className="btn-primary flex items-center gap-2 px-4 py-2.5 text-xs w-full sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          <span>Создать плейсхолдер</span>
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

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Section left: Help Panel */}
        <div className="glass-panel rounded-3xl p-5 sm:p-6 h-fit space-y-4">
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <HelpCircle className="h-4.5 w-4.5 text-cyan-400" />
            <span>Справочник переменных</span>
          </h3>
          <div className="space-y-3.5 text-xs text-slate-400 leading-normal">
            <p>
              Чтобы система правильно заполняла бланки накладных, в ячейках вашего Excel-шаблона должны присутствовать текстовые метки (плейсхолдеры).
            </p>
            <hr className="border-white/5" />
            <div>
              <span className="block font-bold text-indigo-400 uppercase text-[9px] tracking-wider mb-1">Глобальные переменные:</span>
              <ul className="list-disc pl-4 space-y-1 text-[11px]">
                <li><strong className="text-slate-300">{`{CLIENT_NAME}`}</strong> — Название дилера.</li>
                <li><strong className="text-slate-300">{`{ORDER_DATE}`}</strong> — Время приема заказа.</li>
                <li><strong className="text-slate-300">{`{ORDER_NUMBER}`}</strong> — Уникальный номер.</li>
                <li><strong className="text-slate-300">{`{TOTAL_PRICE}`}</strong> — Итоговая сумма заказа.</li>
                <li><strong className="text-slate-300">{`{CLIENT_PHONE}`}</strong> — Телефон дилера.</li>
                <li><strong className="text-slate-300">{`{DELIVERY_ADDRESS}`}</strong> — Адрес доставки.</li>
                <li><strong className="text-slate-300">{`{SELLER_NAME}`}</strong> — ФИО менеджера.</li>
              </ul>
            </div>
            <hr className="border-white/5" />
            <div>
              <span className="block font-bold text-cyan-400 uppercase text-[9px] tracking-wider mb-1">Переменные строк товаров (SKU):</span>
              <ul className="list-disc pl-4 space-y-1 text-[11px]">
                <li><strong className="text-slate-300">{`{SKU_NAME}`}</strong> — Полное наименование.</li>
                <li><strong className="text-slate-300">{`{SKU_CODE}`}</strong> — Артикул / Код SKU.</li>
                <li><strong className="text-slate-300">{`{ITEM_QTY_PACKS}`}</strong> — Всего пачек заказано.</li>
                <li><strong className="text-slate-300">{`{QTY_PACKS}`}</strong> — Хвост пачек (остаток после коробок/блоков).</li>
                <li><strong className="text-slate-300">{`{QTY_BLOCKS}`}</strong> — Количество блоков (целых).</li>
                <li><strong className="text-slate-300">{`{QTY_CASES}`}</strong> — Количество коробок (целых).</li>
                <li><strong className="text-slate-300">{`{PRICE}`}</strong> — Цена за пачку.</li>
                <li><strong className="text-slate-300">{`{ITEM_TOTAL}`}</strong> — Сумма по строке.</li>
              </ul>
            </div>
            <hr className="border-white/5" />
            <div>
              <span className="block font-bold text-emerald-400 uppercase text-[9px] tracking-wider mb-1">Конструирование формул:</span>
              <p className="text-[11px] text-slate-400 mt-1">
                Вы можете строить собственные математические выражения прямо в ячейках. К примеру:
              </p>
              <div className="bg-slate-950/50 p-2 rounded-lg font-mono text-[10px] text-emerald-400 mt-1 border border-emerald-500/10">
                {`{PRICE}*{ITEM_QTY_PACKS}/{TOTAL_PRICE}`}
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                Это выражение автоматически рассчитает долю текущей позиции в общей стоимости всего заказа. Допустимы операторы: <code>+</code>, <code>-</code>, <code>*</code>, <code>/</code>, <code>(</code>, <code>)</code>.
              </p>
            </div>
          </div>
        </div>

        {/* Section right: Mappings List Table (takes up 2 columns) */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <FileCode className="h-4.5 w-4.5 text-primary" />
            <span>Активные правила маппинга полей</span>
          </h3>

          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="glass-panel rounded-3xl overflow-hidden border border-white/5 animate-fade-in">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 bg-slate-950/40 text-[10px] text-slate-400 uppercase tracking-wider font-extrabold">
                      <th className="py-4 px-5">Плейсхолдер</th>
                      <th className="py-4 px-5">Системный путь поля</th>
                      <th className="py-4 px-5">Описание назначения</th>
                      <th className="py-4 px-5 text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-xs">
                    {mappings.map((m) => (
                      <tr key={m.id} className="hover:bg-white/5 transition-all text-slate-300">
                        <td className="py-4 px-5 font-mono text-indigo-400 font-extrabold">{m.placeholder}</td>
                        <td className="py-4 px-5 font-mono text-cyan-400 font-bold">{m.systemField}</td>
                        <td className="py-4 px-5 text-slate-400 font-semibold">{m.description}</td>
                        <td className="py-4 px-5 text-right">
                          <button
                            onClick={() => openEditModal(m)}
                            className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white transition-all inline-flex"
                            title="Редактировать привязку"
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteMapping(m.id, m.placeholder)}
                            className="p-1.5 rounded-lg border border-red-900 bg-red-950/40 text-red-400 hover:text-red-200 transition-all inline-flex ml-2"
                            title="Удалить привязку"
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
        </div>
      </div>

      {/* Add Mapping Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-md rounded-3xl p-6 sm:p-8 relative">
            <button 
              onClick={() => setShowAddModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-base font-bold text-slate-200 mb-6 flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              <span>Добавление правила маппинга</span>
            </h3>

            <form onSubmit={handleAddMapping} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Имя плейсхолдера (в фигурных скобках)</label>
                <div className="relative">
                  <Tag className="absolute left-3 top-2 h-4.5 w-4.5 text-slate-400" />
                  <input
                    type="text"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input font-mono"
                    placeholder="{CLIENT_ADDRESS}"
                    value={placeholder}
                    onChange={(e) => setPlaceholder(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Системное поле (Путь в БД)</label>
                <div className="relative">
                  <FileCode className="absolute left-3 top-2 h-4.5 w-4.5 text-slate-400" />
                  <input
                    type="text"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input font-mono"
                    placeholder="customer.address"
                    value={systemField}
                    onChange={(e) => setSystemField(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Описание назначения</label>
                <textarea
                  className="w-full rounded-xl px-4 py-2.5 text-xs glass-input h-20 focus:bg-slate-900"
                  placeholder="Юридический адрес дилера"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="btn-primary w-full py-3 text-xs flex items-center justify-center gap-2 mt-6"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>Добавить правило</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit Mapping Modal */}
      {showEditModal && activeMapping && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-panel w-full max-w-md rounded-3xl p-6 sm:p-8 relative">
            <button 
              onClick={() => { setShowEditModal(false); setActiveMapping(null); }}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-base font-bold text-slate-200 mb-6 flex items-center gap-2">
              <Edit className="h-5 w-5 text-primary" />
              <span>Редактирование правила маппинга</span>
            </h3>

            <form onSubmit={handleEditMapping} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Плейсхолдер</label>
                <div className="relative">
                  <Tag className="absolute left-3 top-3 h-4.5 w-4.5 text-slate-400" />
                  <input
                    type="text"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input font-mono"
                    value={placeholder}
                    onChange={(e) => setPlaceholder(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Системное поле</label>
                <div className="relative">
                  <FileCode className="absolute left-3 top-3 h-4.5 w-4.5 text-slate-400" />
                  <input
                    type="text"
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-xs glass-input font-mono"
                    value={systemField}
                    onChange={(e) => setSystemField(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Описание назначения</label>
                <textarea
                  className="w-full rounded-xl px-4 py-2.5 text-xs glass-input h-20 focus:bg-slate-900"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="btn-primary w-full py-3 text-xs flex items-center justify-center gap-2 mt-6"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>Сохранить привязку</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
