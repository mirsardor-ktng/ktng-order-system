import { getMonthKey } from './helpers';

export function calculateMonthlyTrend(orders: any[]) {
  const monthlyMap = new Map<string, { month: string; revenue: number; orders: number; cases: number }>();

  for (const order of orders) {
    const month = getMonthKey(order.createdAt);

    if (!monthlyMap.has(month)) {
      monthlyMap.set(month, {
        month,
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

  // Sort months chronologically
  return Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));
}
