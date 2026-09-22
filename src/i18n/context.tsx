'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Language, Dictionary } from './types';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  LANGUAGE_COOKIE_NAME,
  dictionaries,
  translate,
  localizeError as localizeErrorHelper,
  formatCurrency as formatCurrencyHelper
} from './index';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  formatCurrency: (amount: number) => string;
  localizeError: (rawError?: string | null) => string;
  dictionary: Dictionary;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

function getCookieLanguage(): Language | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${LANGUAGE_COOKIE_NAME}=([^;]*)`));
  const val = match ? decodeURIComponent(match[1]) : null;
  if (val && (SUPPORTED_LANGUAGES as string[]).includes(val)) {
    return val as Language;
  }
  return null;
}

function setCookieLanguage(lang: Language) {
  if (typeof document === 'undefined') return;
  // 1 year max-age, accessible on all paths
  document.cookie = `${LANGUAGE_COOKIE_NAME}=${encodeURIComponent(lang)}; path=/; max-age=31536000; SameSite=Lax`;
  try {
    localStorage.setItem(LANGUAGE_COOKIE_NAME, lang);
  } catch {
    // Ignore localStorage access failures in restricted environments
  }
}

export function LanguageProvider({
  children
}: {
  children: React.ReactNode;
}) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  // Sync language from cookie / localStorage after hydration to guarantee zero hydration mismatch
  useEffect(() => {
    const cookieLang = getCookieLanguage();
    if (cookieLang && (SUPPORTED_LANGUAGES as string[]).includes(cookieLang)) {
      setLanguageState(cookieLang);
      if (typeof document !== 'undefined') {
        document.documentElement.lang = cookieLang;
      }
      return;
    }
    try {
      const localLang = localStorage.getItem(LANGUAGE_COOKIE_NAME) as Language | null;
      if (localLang && (SUPPORTED_LANGUAGES as string[]).includes(localLang)) {
        setLanguageState(localLang);
        if (typeof document !== 'undefined') {
          document.documentElement.lang = localLang;
        }
      }
    } catch {
      // Ignore
    }
  }, []);

  const setLanguage = useCallback((newLang: Language) => {
    if (!SUPPORTED_LANGUAGES.includes(newLang)) return;
    setLanguageState(newLang);
    setCookieLanguage(newLang);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = newLang;
    }
  }, []);

  // Keep html lang tag synchronized with language state
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language;
    }
  }, [language]);


  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      return translate(language, key, params);
    },
    [language]
  );

  const formatCurrency = useCallback(
    (amount: number) => {
      return formatCurrencyHelper(amount, language);
    },
    [language]
  );

  const localizeError = useCallback(
    (rawError?: string | null) => {
      return localizeErrorHelper(rawError, language);
    },
    [language]
  );

  const dictionary = useMemo(() => {
    return dictionaries[language] || dictionaries[DEFAULT_LANGUAGE];
  }, [language]);

  const contextValue = useMemo<LanguageContextType>(() => {
    return {
      language,
      setLanguage,
      t,
      formatCurrency,
      localizeError,
      dictionary
    };
  }, [language, setLanguage, t, formatCurrency, localizeError, dictionary]);

  return <LanguageContext.Provider value={contextValue}>{children}</LanguageContext.Provider>;
}

export function useTranslation() {
  const context = useContext(LanguageContext);
  if (!context) {
    // Fallback if rendered outside provider
    return {
      language: DEFAULT_LANGUAGE,
      setLanguage: () => {},
      t: (key: string, params?: Record<string, string | number>) => translate(DEFAULT_LANGUAGE, key, params),
      formatCurrency: (amount: number) => formatCurrencyHelper(amount, DEFAULT_LANGUAGE),
      localizeError: (rawError?: string | null) => localizeErrorHelper(rawError, DEFAULT_LANGUAGE),
      dictionary: dictionaries[DEFAULT_LANGUAGE]
    };
  }
  return context;
}

export function useLanguage(): [Language, (lang: Language) => void] {
  const { language, setLanguage } = useTranslation();
  return [language, setLanguage];
}
