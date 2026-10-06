export function getMonthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function getDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getPreviousDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day - 1));
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getPreviousMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  if (month === 1) {
    return `${year - 1}-12`;
  }
  return `${year}-${String(month - 1).padStart(2, '0')}`;
}

/**
 * Calculates the previous comparison period of the exact same length in calendar days.
 * Formula from Phase 12:
 * periodLength = calendar days inclusive
 * previousEnd = currentStart - 1 day
 * previousStart = previousEnd - (periodLength - 1) days
 */
export function calculateComparisonPeriod(startStr: string, endStr: string): {
  prevStartStr: string;
  prevEndStr: string;
  previousStart?: string;
  previousEnd?: string;
  periodLength: number;
} {
  const [sYear, sMonth, sDay] = startStr.split('-').map(Number);
  const [eYear, eMonth, eDay] = endStr.split('-').map(Number);

  const startUtc = Date.UTC(sYear, sMonth - 1, sDay);
  const endUtc = Date.UTC(eYear, eMonth - 1, eDay);

  const periodLength = Math.max(1, Math.round((endUtc - startUtc) / (1000 * 60 * 60 * 24)) + 1);

  // previousEnd = currentStart - 1 day
  const prevEndUtc = startUtc - (1000 * 60 * 60 * 24);
  // previousStart = previousEnd - (periodLength - 1) days
  const prevStartUtc = prevEndUtc - ((periodLength - 1) * 1000 * 60 * 60 * 24);

  const prevEndDate = new Date(prevEndUtc);
  const prevStartDate = new Date(prevStartUtc);

  const prevEndStr = prevEndDate.toISOString().split('T')[0];
  const prevStartStr = prevStartDate.toISOString().split('T')[0];

  return {
    prevStartStr,
    prevEndStr,
    previousStart: prevStartStr,
    previousEnd: prevEndStr,
    periodLength,
  };
}

export function calculatePercentageChange(current: number, previous: number): number | null {
  if (previous === 0) {
    return null; // Return null to safely indicate N/A without NaN or Infinity
  }
  return Math.round(((current - previous) / previous) * 100);
}
