import { Dictionary, Language } from './types';
import { ru } from './dictionaries/ru';
import { uz } from './dictionaries/uz';
import { en } from './dictionaries/en';

export * from './types';

export const DEFAULT_LANGUAGE: Language = 'ru';
export const SUPPORTED_LANGUAGES: Language[] = ['ru', 'uz', 'en'];
export const LANGUAGE_COOKIE_NAME = 'ktng_language';

export const LANGUAGE_LABELS: Record<Language, { label: string; short: string; nativeName: string }> = {
  ru: { label: 'Русский', short: 'RU', nativeName: 'Русский' },
  uz: { label: 'O‘zbek', short: 'UZ', nativeName: 'O‘zbekcha' },
  en: { label: 'English', short: 'EN', nativeName: 'English' }
};

export const dictionaries: Record<Language, Dictionary> = {
  ru,
  uz,
  en
};

/**
 * Traverses a nested object by dot notation path (e.g. 'auth.signInButton')
 */
function getNestedValue(obj: unknown, path: string): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let current: any = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return typeof current === 'string' ? current : undefined;
}

/**
 * Translate helper with fallback cascade:
 * 1. Target language dictionary
 * 2. Russian dictionary (master)
 * 3. English dictionary
 * 4. Humanized key name (never crashes, never shows raw dots to users in production)
 */
export function translate(
  lang: Language = DEFAULT_LANGUAGE,
  key: string,
  params?: Record<string, string | number>
): string {
  const currentDict = dictionaries[lang] || dictionaries[DEFAULT_LANGUAGE];
  let val = getNestedValue(currentDict, key);

  if (!val && lang !== 'ru') {
    val = getNestedValue(dictionaries['ru'], key);
  }

  if (!val && lang !== 'en') {
    val = getNestedValue(dictionaries['en'], key);
  }

  if (!val) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[i18n] Missing translation for key "${key}" in language "${lang}"`);
    }
    // Safe humanized fallback for missing keys
    const lastPart = key.split('.').pop() || key;
    val = lastPart.replace(/([A-Z])/g, ' $1').toLowerCase();
  }

  if (params && val) {
    for (const [pKey, pVal] of Object.entries(params)) {
      val = val.replace(new RegExp(`{${pKey}}`, 'g'), String(pVal));
    }
  }

  return val || key;
}

/**
 * Localizes backend error codes or existing Russian server strings to the current language.
 */
export function localizeError(rawError: string | undefined | null, lang: Language = DEFAULT_LANGUAGE): string {
  if (!rawError) return translate(lang, 'errors.unknownError');

  const trimmed = rawError.trim();

  // 1. Direct error codes
  const codeMap: Record<string, string> = {
    'CUSTOMER_NOT_FOUND': 'errors.customerNotFound',
    'INSUFFICIENT_STOCK': 'errors.insufficientStock',
    'BONUS_STOCK_INSUFFICIENT': 'errors.bonusStockInsufficient',
    'INVALID_ORDER': 'errors.invalidOrder',
    'PROMOTION_NOT_AVAILABLE': 'errors.promotionNotAvailable',
    'UNAUTHORIZED': 'errors.unauthorized',
    'ACCESS_DENIED': 'errors.accessDenied'
  };

  if (codeMap[trimmed]) {
    return translate(lang, codeMap[trimmed]);
  }

  // 2. Bonus stock error message extraction: "Превышен доступный лимит запасов для позиции: X" or "бонусной позиции: X"
  const bonusMatch = trimmed.match(/лимит запасов для (?:бонусной )?позиции:\s*([^\.]+)/i);
  if (bonusMatch && bonusMatch[1]) {
    const productName = bonusMatch[1].trim();
    return translate(lang, 'errors.bonusStockInsufficient', { productName });
  }

  // 3. Known common Russian error messages mapping
  const ruMessageMap: Record<string, string> = {
    'Клиент не найден.': 'errors.customerNotFound',
    'Неверные авторизационные данные.': 'auth.invalidCredentials',
    'Заполните все поля для ввода.': 'auth.fillAllFields',
    'Не удалось подключиться к серверу. Попробуйте позже.': 'auth.networkError',
    'Ошибка соединения с сервером.': 'auth.networkError',
    'Новые пароли не совпадают.': 'profile.passwordMismatch',
    'Новый пароль должен содержать не менее 6 символов.': 'profile.passwordMinLength',
    'Пароль успешно изменён.': 'profile.passwordSuccess'
  };

  if (ruMessageMap[trimmed]) {
    return translate(lang, ruMessageMap[trimmed]);
  }

  return trimmed;
}

/**
 * Formats currency amount based on language locale (e.g. 1 250 000 UZS vs 1,250,000 UZS)
 */
export function formatCurrency(amount: number, lang: Language = DEFAULT_LANGUAGE): string {
  const rounded = Math.round(amount);
  if (lang === 'en') {
    return `${rounded.toLocaleString('en-US')} UZS`;
  }
  // RU and UZ use space separators
  return `${rounded.toLocaleString('ru-RU').replace(/,/g, ' ')} UZS`;
}
