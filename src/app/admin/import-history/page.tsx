'use client';

import { useState } from 'react';
import { 
  FileSpreadsheet, Upload, CheckCircle2, XCircle, AlertTriangle, 
  Loader2, Info, ArrowRight, Play, FileCheck, RefreshCw 
} from 'lucide-react';

interface ImportSummary {
  ordersCount: number;
  rowsCount: number;
  customersCount: number;
  skusCount: number;
  skippedCount: number;
  importCount: number;
  period: string;
}

export default function ImportHistoryPage() {
  const [file, setFile] = useState<File | null>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1); // 1: Upload/Check, 2: Verification, 3: Completed
  
  // Validation Results
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [missingCustomers, setMissingCustomers] = useState<string[]>([]);
  const [missingSkus, setMissingSkus] = useState<string[]>([]);
  const [skippedOrders, setSkippedOrders] = useState<string[]>([]);
  const [canImport, setCanImport] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Import Results
  const [importStats, setImportStats] = useState<{ orders: number; rows: number; skipped: number } | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setChecking(true);
    setErrorMessage(null);
    setSummary(null);

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('action', 'validate');

    try {
      const res = await fetch('/api/admin/import-history', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (res.ok) {
        setSummary(data.summary);
        setValidationErrors(data.validationErrors || []);
        setMissingCustomers(data.missingCustomers || []);
        setMissingSkus(data.missingSkus || []);
        setSkippedOrders(data.skippedOrders || []);
        setCanImport(data.canImport);
        setStep(2);
      } else {
        setErrorMessage(data.error || 'Ошибка при проверке файла Excel.');
        setFile(null);
      }
    } catch (err) {
      setErrorMessage('Не удалось загрузить или обработать файл. Проверьте соединение.');
      setFile(null);
    } finally {
      setChecking(false);
    }
  };

  const handleImport = async () => {
    if (!file || !canImport) return;

    setImporting(true);
    setErrorMessage(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('action', 'import');

    try {
      const res = await fetch('/api/admin/import-history', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (res.ok) {
        setImportStats({
          orders: data.importedOrders,
          rows: data.importedRows,
          skipped: data.skippedOrders
        });
        setStep(3);
      } else {
        setErrorMessage(data.error || 'Ошибка во время импорта истории заказов.');
      }
    } catch (err) {
      setErrorMessage('Сетевая ошибка при выполнении импорта.');
    } finally {
      setImporting(false);
    }
  };

  const resetForm = () => {
    setFile(null);
    setSummary(null);
    setValidationErrors([]);
    setMissingCustomers([]);
    setMissingSkus([]);
    setSkippedOrders([]);
    setCanImport(false);
    setErrorMessage(null);
    setImportStats(null);
    setStep(1);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-fade-in pb-16">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-primary" />
          <span>Импорт истории продаж</span>
        </h2>
        <span className="block text-xs text-slate-400 mt-1 font-semibold">
          Загрузка архивных заказов клиентов из Excel для ретроспективной аналитики
        </span>
      </div>

      {errorMessage && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-xs sm:text-sm text-red-400 flex items-center gap-3">
          <XCircle className="h-5 w-5 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className="glass-panel rounded-2xl p-8 border border-white/5 flex flex-col items-center justify-center text-center space-y-4">
          <div className="h-16 w-16 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
            {checking ? (
              <Loader2 className="h-8 w-8 animate-spin" />
            ) : (
              <Upload className="h-8 w-8" />
            )}
          </div>

          <div className="max-w-sm space-y-1">
            <h3 className="text-sm font-bold text-slate-200">
              {checking ? 'Анализируем файл...' : 'Загрузите Excel-файл истории'}
            </h3>
            <p className="text-xs text-slate-400">
              Поддерживаются форматы .xlsx и .xls. Структура должна содержать колонки: OrderNumber, OrderDate, Customer, SKU, QuantityPacks, PackPrice.
            </p>
          </div>

          {!checking && (
            <label className="btn-primary px-5 py-2.5 text-xs flex items-center gap-2 cursor-pointer transition-all">
              <span>Выбрать Excel</span>
              <input 
                type="file" 
                accept=".xlsx, .xls" 
                className="hidden" 
                onChange={handleFileChange}
              />
            </label>
          )}
        </div>
      )}

      {/* Step 2: Verification and Analysis results */}
      {step === 2 && summary && (
        <div className="space-y-6">
          {/* Summary KPIs */}
          <div className="glass-panel rounded-2xl p-6 border border-white/5 space-y-4">
            <h3 className="text-xs font-bold text-slate-350 uppercase tracking-wider flex items-center gap-2">
              <Info className="w-4 h-4 text-indigo-400" />
              <span>1. Анализ содержимого файла</span>
            </h3>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-slate-950/40 p-4 border border-white/5 rounded-xl">
                <span className="block text-[9px] text-slate-500 font-bold uppercase">Всего заказов</span>
                <span className="block text-lg font-extrabold text-slate-200 mt-1">{summary.ordersCount}</span>
              </div>
              <div className="bg-slate-950/40 p-4 border border-white/5 rounded-xl">
                <span className="block text-[9px] text-slate-500 font-bold uppercase">Позиций (строк)</span>
                <span className="block text-lg font-extrabold text-slate-200 mt-1">{summary.rowsCount}</span>
              </div>
              <div className="bg-slate-950/40 p-4 border border-white/5 rounded-xl">
                <span className="block text-[9px] text-slate-500 font-bold uppercase">Клиентов</span>
                <span className="block text-lg font-extrabold text-slate-200 mt-1">{summary.customersCount}</span>
              </div>
              <div className="bg-slate-950/40 p-4 border border-white/5 rounded-xl">
                <span className="block text-[9px] text-slate-500 font-bold uppercase">Уникальных SKU</span>
                <span className="block text-lg font-extrabold text-slate-200 mt-1">{summary.skusCount}</span>
              </div>
              <div className="bg-slate-950/40 p-4 border border-white/5 rounded-xl col-span-2 md:col-span-1">
                <span className="block text-[9px] text-slate-500 font-bold uppercase">Временной охват</span>
                <span className="block text-[11px] font-bold text-slate-200 mt-2 leading-none whitespace-nowrap">{summary.period}</span>
              </div>
            </div>
          </div>

          {/* Validation & Alignment check */}
          <div className="glass-panel rounded-2xl p-6 border border-white/5 space-y-4">
            <h3 className="text-xs font-bold text-slate-350 uppercase tracking-wider flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-cyan-400" />
              <span>2. Проверка соответствия базам данных</span>
            </h3>

            {/* If all is clean */}
            {canImport && validationErrors.length === 0 && (
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-xs sm:text-sm text-emerald-400 flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
                <span>Все клиенты, товарные позиции (SKU) и форматы данных полностью соответствуют системе. Готов к импорту.</span>
              </div>
            )}

            {/* Skipping existing orders alert */}
            {skippedOrders.length > 0 && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-400 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4.5 w-4.5 flex-shrink-0" />
                  <span className="font-bold">Обнаружены дубликаты ({summary.skippedCount} заказа):</span>
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Заказы со следующими номерами уже существуют в системе и будут пропущены при импорте (это не блокирует импорт других новых номеров заказов):
                </p>
                <div className="max-h-24 overflow-y-auto font-mono text-[10px] bg-slate-950/40 p-2 rounded-lg border border-white/5 grid grid-cols-2 sm:grid-cols-4 gap-1">
                  {skippedOrders.map(num => <span key={num} className="text-slate-300">{num}</span>)}
                </div>
              </div>
            )}

            {/* Error mismatches list */}
            {!canImport && (
              <div className="space-y-4">
                <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-xs sm:text-sm text-red-400 flex items-center gap-3">
                  <XCircle className="h-5 w-5 flex-shrink-0" />
                  <span className="font-bold">Найдены критические ошибки! Импорт заблокирован. Исправьте Excel-файл и попробуйте снова.</span>
                </div>

                <div className="space-y-3.5">
                  {/* Missing Customers */}
                  {missingCustomers.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="block text-[10px] text-red-400 font-bold uppercase tracking-wider">Клиенты не найдены в системе ({missingCustomers.length}):</span>
                      <ul className="list-disc pl-5 text-[11px] text-slate-300 space-y-0.5">
                        {missingCustomers.map(name => <li key={name}>{name}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Missing SKUs */}
                  {missingSkus.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="block text-[10px] text-red-400 font-bold uppercase tracking-wider">Товары/SKU не найдены в системе ({missingSkus.length}):</span>
                      <ul className="list-disc pl-5 text-[11px] text-slate-300 space-y-0.5">
                        {missingSkus.map(sku => <li key={sku}>{sku}</li>)}
                      </ul>
                    </div>
                  )}

                  {/* Format/Row Errors */}
                  {validationErrors.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="block text-[10px] text-red-400 font-bold uppercase tracking-wider">Ошибки форматирования строк ({validationErrors.length}):</span>
                      <div className="max-h-40 overflow-y-auto text-[11px] text-slate-400 bg-slate-950/40 p-3 rounded-xl border border-white/5 space-y-1">
                        {validationErrors.map((err, idx) => <p key={idx}>{err}</p>)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="flex justify-between items-center bg-slate-950/30 p-4 border border-white/5 rounded-2xl">
            <button 
              onClick={resetForm}
              className="text-xs text-slate-400 hover:text-slate-200 border border-white/5 hover:border-white/10 px-4 py-2.5 rounded-xl font-bold transition-all"
            >
              Сбросить
            </button>

            <button
              onClick={handleImport}
              disabled={!canImport || importing}
              className="btn-primary px-5 py-2.5 text-xs flex items-center gap-2"
            >
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Импортируем...</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 fill-white" />
                  <span>Импортировать историю ({summary.importCount} заков)</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Success Report */}
      {step === 3 && importStats && (
        <div className="glass-panel rounded-2xl p-8 border border-white/5 text-center space-y-5 animate-fade-in">
          <div className="h-14 w-14 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20 mx-auto">
            <CheckCircle2 className="h-8 w-8" />
          </div>

          <div className="space-y-1">
            <h3 className="text-base font-extrabold text-slate-100">Импорт истории продаж успешно завершён</h3>
            <p className="text-xs text-slate-400">
              Данные были успешно импортированы в единую транзакцию и добавлены к ретроспективному анализу.
            </p>
          </div>

          <div className="max-w-xs mx-auto bg-slate-950/40 p-4 rounded-xl border border-white/5 grid grid-cols-3 gap-2 text-xs">
            <div>
              <span className="block text-[8px] text-slate-500 font-bold uppercase">Создано заказов</span>
              <span className="block text-base font-extrabold text-slate-200 mt-1">{importStats.orders}</span>
            </div>
            <div>
              <span className="block text-[8px] text-slate-500 font-bold uppercase">Создано строк</span>
              <span className="block text-base font-extrabold text-slate-200 mt-1">{importStats.rows}</span>
            </div>
            <div>
              <span className="block text-[8px] text-slate-500 font-bold uppercase">Пропущено</span>
              <span className="block text-base font-extrabold text-slate-200 mt-1">{importStats.skipped}</span>
            </div>
          </div>

          <button 
            onClick={resetForm}
            className="btn-secondary px-5 py-2.5 text-xs flex items-center gap-2 mx-auto"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Загрузить другой файл</span>
          </button>
        </div>
      )}
    </div>
  );
}
