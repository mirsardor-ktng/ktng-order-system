'use client';

import { useState, useEffect } from 'react';
import { Tag, Plus, Trash2, Check, AlertCircle, Loader2, X } from 'lucide-react';

interface TagItem {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  _count: { products: number };
}

const PRESET_COLORS = [
  { label: 'Индиго', value: '#6366f1' },
  { label: 'Циан', value: '#06b6d4' },
  { label: 'Изумруд', value: '#10b981' },
  { label: 'Янтарь', value: '#f59e0b' },
  { label: 'Роза', value: '#f43f5e' },
  { label: 'Фиолет', value: '#a855f7' },
];

export default function AdminTags() {
  const [tags, setTags] = useState<TagItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // New tag form state
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#6366f1');

  const loadTags = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/tags');
      if (res.ok) setTags(await res.json());
    } catch {
      setError('Не удалось загрузить теги.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTags(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/admin/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), color: newColor })
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(`Тег «${newName}» создан.`);
        setNewName('');
        setNewColor('#6366f1');
        loadTags();
      } else {
        setError(data.error);
      }
    } catch {
      setError('Ошибка связи с сервером.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (tag: TagItem) => {
    if (!confirm(`Удалить тег «${tag.name}»? Он будет снят со всех ${tag._count.products} товаров.`)) return;
    setDeleting(tag.id);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/admin/tags?id=${tag.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        setSuccess(data.message);
        loadTags();
      } else {
        setError(data.error);
      }
    } catch {
      setError('Ошибка при удалении тега.');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Tag className="h-5 w-5 text-primary" />
          <span>Управление тегами каталога</span>
        </h2>
        <span className="block text-xs text-slate-400 mt-1 font-semibold">
          Создание и удаление тегов для категоризации SKU сигарет. Теги видны только в фильтрах каталога дилера.
        </span>
      </div>

      {/* Notifications */}
      {success && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-xs text-emerald-400 flex items-center gap-3">
          <Check className="h-5 w-5 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-xs text-red-400 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Create Tag Form */}
        <div className="glass-panel rounded-3xl p-5 sm:p-6 h-fit space-y-5">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <Plus className="h-4 w-4 text-indigo-400" />
            <span>Новый тег</span>
          </h3>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Название тега</label>
              <input
                type="text"
                className="w-full rounded-xl px-4 py-2.5 text-xs glass-input"
                placeholder="Премиум, Бюджет, Акция..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={30}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Цвет бейджа</label>
              <div className="flex flex-wrap gap-2 pt-1">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setNewColor(c.value)}
                    className={`h-7 w-7 rounded-full border-2 transition-all ${
                      newColor === c.value ? 'border-white scale-110' : 'border-transparent opacity-70 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                  />
                ))}
              </div>
              {/* Preview */}
              {newName && (
                <div className="mt-2">
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: newColor + '33', border: `1px solid ${newColor}66`, color: newColor }}
                  >
                    {newName}
                  </span>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting || !newName.trim()}
              className="btn-primary w-full py-3 text-xs flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              <span>Создать тег</span>
            </button>
          </form>
        </div>

        {/* Tags List */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <Tag className="h-4 w-4 text-emerald-400" />
            <span>Существующие теги</span>
          </h3>

          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : tags.length === 0 ? (
            <div className="glass-panel rounded-2xl flex flex-col items-center justify-center py-12 text-center">
              <Tag className="h-8 w-8 text-slate-500 mb-2" />
              <p className="text-xs text-slate-400">Теги ещё не созданы.</p>
            </div>
          ) : (
            <div className="glass-panel rounded-3xl overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 bg-slate-950/40 text-[10px] text-slate-400 uppercase tracking-wider font-extrabold">
                    <th className="py-3 px-5">Тег</th>
                    <th className="py-3 px-5">Цвет</th>
                    <th className="py-3 px-5">SKU с тегом</th>
                    <th className="py-3 px-5 text-right">Удалить</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs">
                  {tags.map((tag) => (
                    <tr key={tag.id} className="hover:bg-white/5 transition-all text-slate-300">
                      <td className="py-3 px-5">
                        <span
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold"
                          style={{
                            backgroundColor: tag.color + '22',
                            border: `1px solid ${tag.color}55`,
                            color: tag.color
                          }}
                        >
                          {tag.name}
                        </span>
                      </td>
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-2">
                          <div className="h-4 w-4 rounded-full" style={{ backgroundColor: tag.color }} />
                          <span className="font-mono text-[10px] text-slate-500">{tag.color}</span>
                        </div>
                      </td>
                      <td className="py-3 px-5 font-bold text-slate-300">
                        {tag._count.products} поз.
                      </td>
                      <td className="py-3 px-5 text-right">
                        <button
                          onClick={() => handleDelete(tag)}
                          disabled={deleting === tag.id}
                          className="p-1.5 rounded-lg border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/15 transition-all inline-flex disabled:opacity-50"
                          title={`Удалить тег «${tag.name}»`}
                        >
                          {deleting === tag.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Trash2 className="h-3.5 w-3.5" />
                          }
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
