'use client';

import { useState, useEffect } from 'react';
import { FileClock, Loader2, Calendar, ShieldCheck, Search, Filter } from 'lucide-react';

interface AuditLog {
  id: string;
  action: string;
  details: string;
  timestamp: string;
  user?: {
    name: string;
    email: string;
    role: string;
  } | null;
}

export default function AdminLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');

  useEffect(() => {
    async function loadLogs() {
      try {
        const res = await fetch('/api/admin/logs');
        if (res.ok) {
          const data = await res.json();
          setLogs(data);
        }
      } catch (err) {
        console.error('Failed to load audit logs', err);
      } finally {
        setLoading(false);
      }
    }
    loadLogs();
  }, []);

  // Unique list of actions in the loaded logs for easy filtering
  const uniqueActions = ['ALL', ...Array.from(new Set(logs.map(log => log.action)))];

  // Filtering logic
  const filteredLogs = logs.filter((log) => {
    const matchSearch = log.details.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        (log.user && log.user.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
                        log.action.toLowerCase().includes(searchTerm.toLowerCase());
    const matchAction = actionFilter === 'ALL' || log.action === actionFilter;
    return matchSearch && matchAction;
  });

  return (
    <div className="flex flex-col h-full animate-fade-in gap-4">

      {/* ── STICKY HEADER + FILTER BAR ── */}
      <div className="flex-shrink-0 space-y-4 sticky top-0 z-20 bg-background/80 backdrop-blur-sm pb-3 border-b border-white/5 pt-1">
        {/* Title */}
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <FileClock className="h-5 w-5 text-primary" />
            <span>Системный журнал аудита (Audit Trail & Activity Logs)</span>
          </h2>
          <span className="block text-xs text-slate-400 mt-1 font-semibold">
            Непрерывный мониторинг действий пользователей, событий создания заказов, загрузки бланков и бэкапов безопасности
          </span>
        </div>

        {/* Control Filter Bar */}
        <div className="glass-panel rounded-2xl p-4 flex flex-col sm:flex-row gap-3 items-center justify-between">
          {/* Search */}
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              className="w-full rounded-xl pl-9 pr-4 py-2 text-xs glass-input"
              placeholder="Поиск логов по описанию или инициатору..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Action Select filter */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Filter className="h-4 w-4 text-slate-500" />
            <select
              className="rounded-xl px-3 py-2 text-xs glass-input focus:bg-slate-900 w-full sm:w-48"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
            >
              {uniqueActions.map(action => (
                <option key={action} value={action}>
                  {action === 'ALL' ? 'Все типы событий' : action}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── SCROLLABLE LOG TABLE ── */}
      <div className="flex-1 overflow-y-auto min-h-0 pb-6">
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center glass-panel rounded-2xl">
          <FileClock className="h-10 w-10 text-slate-500 mb-4" />
          <h3 className="text-base font-bold text-slate-300">Лог-события не найдены</h3>
          <p className="text-xs text-slate-400 mt-1">По выбранным фильтрам записей в журнале нет.</p>
        </div>
      ) : (
        <div className="glass-panel rounded-3xl overflow-hidden border border-white/5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 bg-slate-950/40 text-[10px] text-slate-400 uppercase tracking-wider font-extrabold">
                  <th className="py-4 px-6">Время события</th>
                  <th className="py-4 px-6">Код события</th>
                  <th className="py-4 px-6">Подробное описание операции</th>
                  <th className="py-4 px-6">Инициатор действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs">
                {filteredLogs.map((log) => {
                  const logDate = new Date(log.timestamp).toLocaleString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  });

                  return (
                    <tr key={log.id} className="hover:bg-white/5 transition-all text-slate-300">
                      <td className="py-4 px-6 text-slate-500 font-mono font-semibold">{logDate}</td>
                      <td className="py-4 px-6">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-extrabold tracking-wider ${
                          log.action.includes('ERROR') || log.action.includes('FAIL') 
                            ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                          log.action.includes('SETUP') || log.action.includes('CREATE')
                            ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' :
                          'bg-slate-800 text-slate-300 border border-slate-700'
                        }`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="py-4 px-6 font-semibold leading-relaxed text-slate-200">{log.details}</td>
                      <td className="py-4 px-6 text-slate-400 font-semibold">
                        {log.user ? (
                          <div>
                            <span className="block font-bold text-slate-300">{log.user.name}</span>
                            <span className="block text-[10px] text-slate-500">{log.user.email} ({log.user.role})</span>
                          </div>
                        ) : (
                          <span className="text-slate-600 font-bold tracking-wider uppercase text-[10px]">Система</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>{/* end scrollable */}
    </div>
  );
}
