/**
 * Asia/Tashkent Date Utilities (UTC+5)
 */

export const TASHKENT_TIMEZONE = 'Asia/Tashkent';

/**
 * Returns the current date in Asia/Tashkent as 'YYYY-MM-DD'
 */
export function getTashkentTodayString(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TASHKENT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
  return parts;
}

/**
 * Returns date string 'YYYY-MM-DD' 7 days ago in Asia/Tashkent (inclusive of today)
 */
export function getTashkentWeekAgoString(now: Date = new Date()): string {
  const todayStr = getTashkentTodayString(now);
  const [y, m, d] = todayStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 6));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Converts a YYYY-MM-DD date string into a UTC Date object
 * representing the start of that day (00:00:00.000) in Asia/Tashkent (UTC+5).
 * e.g. '2026-09-29' -> 2026-09-28T19:00:00.000Z
 */
export function getTashkentStartOfDay(dateStr: string): Date | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day, -5, 0, 0, 0));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Converts a YYYY-MM-DD date string into a UTC Date object
 * representing the start of the NEXT day (00:00:00.000) in Asia/Tashkent (UTC+5)
 * for half-open interval queries (createdAt < startOfNextDay).
 * e.g. '2026-09-29' -> 2026-09-29T19:00:00.000Z
 */
export function getTashkentStartOfNextDay(dateStr: string): Date | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + 1, -5, 0, 0, 0));
  return isNaN(d.getTime()) ? null : d;
}

export type PeriodPreset =
  | 'ALL'
  | 'TODAY'
  | 'WEEK'
  | 'CUSTOM'
  | 'YESTERDAY'
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'THIS_MONTH'
  | 'PREVIOUS_MONTH';

/**
 * Returns date string 'YYYY-MM-DD' yesterday in Asia/Tashkent
 */
export function getTashkentYesterdayString(now: Date = new Date()): string {
  const todayStr = getTashkentTodayString(now);
  const [y, m, d] = todayStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns date string 'YYYY-MM-DD' N calendar days ago (inclusive count) in Asia/Tashkent
 */
export function getTashkentDaysAgoString(daysCount: number, now: Date = new Date()): string {
  const todayStr = getTashkentTodayString(now);
  const [y, m, d] = todayStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - (daysCount - 1)));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns start & end date strings for current month in Asia/Tashkent
 */
export function getTashkentThisMonthRange(now: Date = new Date()): { startDate: string; endDate: string } {
  const todayStr = getTashkentTodayString(now);
  const [y, m] = todayStr.split('-').map(Number);
  const monthStr = String(m).padStart(2, '0');
  return {
    startDate: `${y}-${monthStr}-01`,
    endDate: todayStr
  };
}

/**
 * Returns start & end date strings for previous month in Asia/Tashkent
 */
export function getTashkentPreviousMonthRange(now: Date = new Date()): { startDate: string; endDate: string } {
  const todayStr = getTashkentTodayString(now);
  const [y, m] = todayStr.split('-').map(Number);
  const prevDate = new Date(Date.UTC(y, m - 2, 1));
  const prevYear = prevDate.getUTCFullYear();
  const prevMonth = prevDate.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  const prevMonthStr = String(prevMonth).padStart(2, '0');
  const lastDayStr = String(lastDay).padStart(2, '0');
  return {
    startDate: `${prevYear}-${prevMonthStr}-01`,
    endDate: `${prevYear}-${prevMonthStr}-${lastDayStr}`
  };
}

/**
 * Resolves standard date range for an order history preset in Asia/Tashkent
 */
export function getTashkentPresetRange(preset: PeriodPreset, now: Date = new Date()): { startDate: string; endDate: string } {
  const today = getTashkentTodayString(now);
  switch (preset) {
    case 'TODAY':
      return { startDate: today, endDate: today };
    case 'WEEK':
      return { startDate: getTashkentWeekAgoString(now), endDate: today };
    case 'YESTERDAY': {
      const yesterday = getTashkentYesterdayString(now);
      return { startDate: yesterday, endDate: yesterday };
    }
    case 'LAST_7_DAYS':
      return { startDate: getTashkentDaysAgoString(7, now), endDate: today };
    case 'LAST_30_DAYS':
      return { startDate: getTashkentDaysAgoString(30, now), endDate: today };
    case 'THIS_MONTH':
      return getTashkentThisMonthRange(now);
    case 'PREVIOUS_MONTH':
      return getTashkentPreviousMonthRange(now);
    case 'ALL':
    default:
      return { startDate: '', endDate: '' };
  }
}

