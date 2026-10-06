import { getMonthKey, getPreviousMonthKey, getDayKey, getPreviousDayKey, calculatePercentageChange } from './helpers';

export interface ProductAnalyticsItem {
  productId: string;
  sku: string;
  name: string;
  cases: number;
  revenue: number;
  share: number;
  growth: number;
}

export function calculateProductAnalytics(
  orders: any[],
  previousOrders?: any[],
  selectedMonthKey?: string | null
): ProductAnalyticsItem[] {
  const isDay = !!selectedMonthKey && /^\d{4}-\d{2}-\d{2}$/.test(selectedMonthKey);
  const isMonth = !!selectedMonthKey && /^\d{4}-\d{2}$/.test(selectedMonthKey);

  // If day/month is selected, filter target orders accordingly
  const targetOrders = isDay
    ? orders.filter(o => getDayKey(new Date(o.createdAt)) === selectedMonthKey)
    : isMonth
    ? orders.filter(o => getMonthKey(new Date(o.createdAt)) === selectedMonthKey)
    : orders;

  const totalRevenue = targetOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);

  const productMap = new Map<string, { productId: string; sku: string; name: string; cases: number; revenue: number }>();

  for (const order of targetOrders) {
    for (const item of (order.items || [])) {
      const productId = item.productId;
      const sku = item.skuSnapshot || item.product?.sku || 'Unknown';
      const name = item.productNameSnapshot || item.product?.name || 'Unknown Product';
      
      const itemTotalPrice = item.itemTotalPrice ?? (item.quantityPacks * item.price);

      if (!productMap.has(productId)) {
        productMap.set(productId, {
          productId,
          sku,
          name,
          cases: 0,
          revenue: 0
        });
      }

      const p = productMap.get(productId)!;
      p.cases += item.quantityCases || 0;
      p.revenue += itemTotalPrice;
    }
  }

  // Calculate revenue from previous comparison period
  let previousMap = new Map<string, number>();
  if (previousOrders && previousOrders.length > 0) {
    for (const order of previousOrders) {
      for (const item of (order.items || [])) {
        const productId = item.productId;
        const itemTotalPrice = item.itemTotalPrice ?? (item.quantityPacks * item.price);
        previousMap.set(productId, (previousMap.get(productId) || 0) + itemTotalPrice);
      }
    }
  } else if (selectedMonthKey) {
    const prevKey = isDay ? getPreviousDayKey(selectedMonthKey) : getPreviousMonthKey(selectedMonthKey);
    const prevOrders = orders.filter(o =>
      isDay
        ? getDayKey(new Date(o.createdAt)) === prevKey
        : getMonthKey(new Date(o.createdAt)) === prevKey
    );
    for (const order of prevOrders) {
      for (const item of (order.items || [])) {
        const productId = item.productId;
        const itemTotalPrice = item.itemTotalPrice ?? (item.quantityPacks * item.price);
        previousMap.set(productId, (previousMap.get(productId) || 0) + itemTotalPrice);
      }
    }
  }

  const result: ProductAnalyticsItem[] = [];

  for (const [productId, p] of productMap.entries()) {
    const share = totalRevenue > 0 ? Math.round((p.revenue / totalRevenue) * 100) : 0;
    
    let growth: number | null = null;
    if (previousOrders !== undefined || selectedMonthKey) {
      const prevRevenue = previousMap.get(productId) || 0;
      growth = calculatePercentageChange(p.revenue, prevRevenue);
    }

    result.push({
      productId,
      sku: p.sku,
      name: p.name,
      cases: Math.round(p.cases * 100) / 100,
      revenue: p.revenue,
      share,
      growth: growth ?? 0
    });
  }

  return result.sort((a, b) => b.revenue - a.revenue);
}
