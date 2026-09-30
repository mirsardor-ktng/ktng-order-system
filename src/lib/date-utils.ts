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
