import { getMonthKey } from './helpers';

export interface TrendItem {
  month: string;
  rawKey: string;
  revenue: number;
  orders: number;
  cases: number;
}

export interface TrendResult {
  granularity: 'day' | 'month';
  data: TrendItem[];
}

export function calculateMonthlyTrend(
  orders: any[],
  startDate?: string | null,
  endDate?: string | null
): TrendItem[] {
  return calculateTrend(orders, startDate, endDate).data;
}

export function calculateTrend(
  orders: any[],
  startDate?: string | null,
  endDate?: string | null
): TrendResult {
  let isDaily = false;
  let periodDays = 0;

  if (startDate && endDate) {
    const [sY, sM, sD] = startDate.split('-').map(Number);
    const [eY, eM, eD] = endDate.split('-').map(Number);
    const sUtc = Date.UTC(sY, sM - 1, sD);
    const eUtc = Date.UTC(eY, eM - 1, eD);
    periodDays = Math.max(1, Math.round((eUtc - sUtc) / (1000 * 60 * 60 * 24)) + 1);

    if (periodDays <= 31) {
      isDaily = true;
    }
  }

  if (isDaily && startDate && endDate) {
    const [sY, sM, sD] = startDate.split('-').map(Number);
    const [eY, eM, eD] = endDate.split('-').map(Number);

    const dailyMap = new Map<string, TrendItem>();
    const curr = new Date(Date.UTC(sY, sM - 1, sD));
    const end = new Date(Date.UTC(eY, eM - 1, eD));

    // Pre-populate all days in selected range
    while (curr <= end) {
      const year = curr.getUTCFullYear();
      const month = String(curr.getUTCMonth() + 1).padStart(2, '0');
      const day = String(curr.getUTCDate()).padStart(2, '0');
      const key = `${year}-${month}-${day}`;
      const displayLabel = `${day}.${month}`;

      dailyMap.set(key, {
        month: displayLabel,
        rawKey: key,
        revenue: 0,
        orders: 0,
        cases: 0,
      });

      curr.setUTCDate(curr.getUTCDate() + 1);
    }

    for (const order of orders) {
      const oDate = new Date(order.createdAt);
      const year = oDate.getFullYear();
      const month = String(oDate.getMonth() + 1).padStart(2, '0');
      const day = String(oDate.getDate()).padStart(2, '0');
      const key = `${year}-${month}-${day}`;

      if (dailyMap.has(key)) {
        const item = dailyMap.get(key)!;
        item.revenue += order.totalPrice;
        item.orders += 1;
        item.cases += order.totalCases;
      }
    }

    return {
      granularity: 'day',
      data: Array.from(dailyMap.values()),
    };
  } else {
    // Monthly aggregation
    const monthlyMap = new Map<string, TrendItem>();

    for (const order of orders) {
      const month = getMonthKey(new Date(order.createdAt));

      if (!monthlyMap.has(month)) {
        monthlyMap.set(month, {
          month,
          rawKey: month,
          revenue: 0,
          orders: 0,
          cases: 0,
        });
      }

      const item = monthlyMap.get(month)!;
      item.revenue += order.totalPrice;
      item.orders += 1;
      item.cases += order.totalCases;
    }

    return {
      granularity: 'month',
      data: Array.from(monthlyMap.values()).sort((a, b) => a.rawKey.localeCompare(b.rawKey)),
    };
  }
}
