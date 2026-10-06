'use client';

import React, { useState, useEffect } from 'react';
import { Calendar, Filter, X, Check } from 'lucide-react';
import { useTranslation } from '@/i18n/context';
import { PeriodPreset, getTashkentPresetRange } from '@/lib/date-utils';

export interface OrderPeriodFilterProps {
  startDate: string;
  endDate: string;
  activePreset: PeriodPreset;
  onSelectPreset: (preset: PeriodPreset, startDate: string, endDate: string) => void;
  onApplyCustom: (startDate: string, endDate: string) => void;
  onReset: () => void;
  className?: string;
}

const PRESET_KEYS: Array<{ id: PeriodPreset; translationKey: string }> = [
  { id: 'ALL', translationKey: 'orders.periodAll' },
  { id: 'TODAY', translationKey: 'orders.periodToday' },
  { id: 'YESTERDAY', translationKey: 'orders.periodYesterday' },
  { id: 'LAST_7_DAYS', translationKey: 'orders.periodLast7Days' },
  { id: 'LAST_30_DAYS', translationKey: 'orders.periodLast30Days' },
  { id: 'THIS_MONTH', translationKey: 'orders.periodThisMonth' },
  { id: 'PREVIOUS_MONTH', translationKey: 'orders.periodPreviousMonth' },
  { id: 'CUSTOM', translationKey: 'orders.periodCustom' },
];

export default function OrderPeriodFilter({
  startDate,
  endDate,
  activePreset,
  onSelectPreset,
  onApplyCustom,
  onReset,
  className = '',
}: OrderPeriodFilterProps) {
  const { t } = useTranslation();
  const [draftStart, setDraftStart] = useState(startDate);
  const [draftEnd, setDraftEnd] = useState(endDate);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setDraftStart(startDate);
    setDraftEnd(endDate);
  }, [startDate, endDate]);

  const handlePresetClick = (preset: PeriodPreset) => {
    setValidationError(null);
    if (preset === 'ALL') {
      setDraftStart('');
      setDraftEnd('');
      onReset();
      return;
    }

    if (preset === 'CUSTOM') {
      onSelectPreset('CUSTOM', draftStart, draftEnd);
      return;
    }

    const range = getTashkentPresetRange(preset);
    setDraftStart(range.startDate);
    setDraftEnd(range.endDate);
    onSelectPreset(preset, range.startDate, range.endDate);
  };

  const handleApplyCustomDates = () => {
    if (draftStart && draftEnd && draftStart > draftEnd) {
      setValidationError('Дата "От" не может быть позже даты "До"');
      return;
    }
    setValidationError(null);
    onApplyCustom(draftStart, draftEnd);
  };

  const handleResetClick = () => {
    setValidationError(null);
    setDraftStart('');
    setDraftEnd('');
    onReset();
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Preset Buttons Bar */}
      <div className="flex flex-wrap items-center gap-1.5 bg-slate-950/40 p-1.5 rounded-2xl border border-white/5">
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-slate-400 text-xs font-bold uppercase tracking-wider shrink-0">
          <Calendar className="h-3.5 w-3.5 text-indigo-400" />
          <span>{t('seller.period')}</span>
        </div>

        {PRESET_KEYS.map(({ id, translationKey }) => {
          const isActive = activePreset === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => handlePresetClick(id)}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all shrink-0 ${
                isActive
                  ? 'bg-primary text-white shadow-glass-sm font-extrabold'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {t(translationKey)}
            </button>
          );
        })}

        {activePreset !== 'ALL' && (
          <button
            type="button"
            onClick={handleResetClick}
            className="p-1.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-all shrink-0 ml-auto"
            title={t('orders.resetFilter')}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Custom Date Inputs (shown when CUSTOM preset is selected) */}
      {activePreset === 'CUSTOM' && (
        <div className="flex flex-wrap items-center gap-3 bg-slate-900/60 p-3 rounded-xl border border-white/5 animate-fade-in">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <span className="font-semibold text-slate-400">{t('orders.periodFrom')}:</span>
            <input
              type="date"
              value={draftStart}
              onChange={(e) => {
                setDraftStart(e.target.value);
                setValidationError(null);
              }}
              className="bg-slate-950/70 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-300">
            <span className="font-semibold text-slate-400">{t('orders.periodTo')}:</span>
            <input
              type="date"
              value={draftEnd}
              onChange={(e) => {
                setDraftEnd(e.target.value);
                setValidationError(null);
              }}
              className="bg-slate-950/70 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <button
            type="button"
            onClick={handleApplyCustomDates}
            className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <Check className="h-3.5 w-3.5" />
            <span>{t('orders.applyFilter')}</span>
          </button>

          <button
            type="button"
            onClick={handleResetClick}
            className="text-xs text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg border border-white/5 hover:bg-white/5 transition-colors"
          >
            {t('orders.resetFilter')}
          </button>

          {validationError && (
            <span className="text-xs text-rose-400 font-semibold w-full sm:w-auto">
              {validationError}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
