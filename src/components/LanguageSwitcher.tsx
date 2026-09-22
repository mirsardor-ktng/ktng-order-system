'use client';

import React from 'react';
import { useTranslation } from '@/i18n/context';
import { Language } from '@/i18n/types';
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from '@/i18n';
import { Globe } from 'lucide-react';

interface LanguageSwitcherProps {
  className?: string;
  showIcon?: boolean;
  size?: 'sm' | 'md';
}

export function LanguageSwitcher({
  className = '',
  showIcon = false,
  size = 'sm'
}: LanguageSwitcherProps) {
  const { language, setLanguage } = useTranslation();

  const isSmall = size === 'sm';

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-xl bg-slate-900/60 p-1 border border-white/10 backdrop-blur-md shadow-inner ${className}`}
      role="group"
      aria-label="Language selector"
    >
      {showIcon && (
        <div className="pl-1.5 pr-0.5 text-slate-400">
          <Globe className={isSmall ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        </div>
      )}
      {SUPPORTED_LANGUAGES.map((langKey: Language) => {
        const isActive = language === langKey;
        const info = LANGUAGE_LABELS[langKey];

        return (
          <button
            key={langKey}
            type="button"
            onClick={() => setLanguage(langKey)}
            className={`transition-all duration-200 rounded-lg font-bold uppercase tracking-wider ${
              isSmall ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
            } ${
              isActive
                ? 'bg-gradient-to-r from-primary to-accent text-white shadow-glow-primary'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
            title={info.nativeName}
            aria-pressed={isActive}
          >
            {info.short}
          </button>
        );
      })}
    </div>
  );
}

export default LanguageSwitcher;
