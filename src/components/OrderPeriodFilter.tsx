'use client';

import React, { useState, useEffect } from 'react';
import { Calendar, Check, X } from 'lucide-react';
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
  { id: 'WEEK', translationKey: 'orders.periodWeek' },
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
      setValidationError(
        `${t('common.from') || t('orders.periodFrom')} > ${t('common.to') || t('orders.periodTo')}`
      );
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

  const isFiltered = activePreset !== 'ALL' || !!startDate || !!endDate;

  return (
    <div className={`space-y-2 ${className}`}>
      {/* 4 Presets: ALL, TODAY, WEEK, and CUSTOM */}
      <div className="flex flex-wrap items-center gap-1.5 bg-slate-950/40 p-1.5 rounded-xl border border-white/5 flex-shrink-0">
        <span className="text-[9px] text-slate-500 font-bold uppercase px-1.5 whitespace-nowrap">
          {t('seller.period')}:
        </span>

        {PRESET_KEYS.map(({ id, translationKey }) => {
          const isActive = activePreset === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => handlePresetClick(id)}
              className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all whitespace-nowrap flex items-center gap-1.5 ${
                isActive
                  ? 'bg-cyan-600 text-white shadow-glass-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {id === 'CUSTOM' && <Calendar className="h-3 w-3 shrink-0" />}
              <span>{t(translationKey)}</span>
            </button>
          );
        })}

        {isFiltered && activePreset !== 'CUSTOM' && (
          <button
            type="button"
            onClick={handleResetClick}
            className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all ml-auto"
            title={t('common.reset') || t('orders.resetFilter')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Custom Date Inputs (shown when CUSTOM preset is selected) */}
      {activePreset === 'CUSTOM' && (
        <div className="flex flex-wrap items-center gap-2 bg-slate-900/80 p-2 rounded-xl border border-white/10 text-xs animate-fade-in">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">
              {t('common.from') || t('orders.periodFrom')}:
            </span>
            <input
              type="date"
              value={draftStart}
              onChange={(e) => {
                setDraftStart(e.target.value);
                setValidationError(null);
              }}
              className="bg-slate-950/80 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">
              {t('common.to') || t('orders.periodTo')}:
            </span>
            <input
              type="date"
              value={draftEnd}
              onChange={(e) => {
                setDraftEnd(e.target.value);
                setValidationError(null);
              }}
              className="bg-slate-950/80 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <button
            type="button"
            onClick={handleApplyCustomDates}
            className="px-2.5 py-1 text-[10px] font-bold rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-glass-sm flex items-center gap-1"
          >
            <Check className="h-3 w-3" />
            <span>{t('common.apply') || t('orders.applyFilter')}</span>
          </button>
          <button
            type="button"
            onClick={handleResetClick}
            className="px-2 py-1 text-[10px] font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all flex items-center gap-1"
            title={t('common.reset') || t('orders.resetFilter')}
          >
            <X className="h-3 w-3" />
            <span>{t('common.reset') || t('orders.resetFilter')}</span>
          </button>

          {validationError && (
            <span className="text-[10px] text-rose-400 font-semibold w-full sm:w-auto">
              {validationError}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
