import { getMonthKey, getPreviousMonthKey, calculatePercentageChange } from './helpers';

export interface ProductAnalyticsItem {
  productId: string;
  sku: string;
  name: string;
  cases: number;
  revenue: number;
  share: number;
  growth: number;
}

export function calculateProductAnalytics(orders: any[], selectedMonthKey?: string | null): ProductAnalyticsItem[] {
  // If month is selected, compute for that month & MoM growth compared to previous month
  const targetOrders = selectedMonthKey 
    ? orders.filter(o => getMonthKey(o.createdAt) === selectedMonthKey)
    : orders;

  const totalRevenue = targetOrders.reduce((sum, o) => sum + o.totalPrice, 0);

  const productMap = new Map<string, { productId: string; sku: string; name: string; cases: number; revenue: number }>();

  for (const order of targetOrders) {
    for (const item of order.items) {
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
      p.cases += item.quantityCases;
      p.revenue += itemTotalPrice;
    }
  }

  // If a specific month is selected, calculate growth from the previous month
  let previousMonthMap = new Map<string, number>();
  if (selectedMonthKey) {
    const prevMonthKey = getPreviousMonthKey(selectedMonthKey);
    const prevOrders = orders.filter(o => getMonthKey(o.createdAt) === prevMonthKey);
    
    for (const order of prevOrders) {
      for (const item of order.items) {
        const productId = item.productId;
        const itemTotalPrice = item.itemTotalPrice ?? (item.quantityPacks * item.price);
        previousMonthMap.set(productId, (previousMonthMap.get(productId) || 0) + itemTotalPrice);
      }
    }
  }

  const result: ProductAnalyticsItem[] = [];

  for (const [productId, p] of productMap.entries()) {
    const share = totalRevenue > 0 ? Math.round((p.revenue / totalRevenue) * 100) : 0;
    
    let growth = 0;
    if (selectedMonthKey) {
      const prevRevenue = previousMonthMap.get(productId) || 0;
      growth = calculatePercentageChange(p.revenue, prevRevenue);
    }

    result.push({
      productId,
      sku: p.sku,
      name: p.name,
      cases: Math.round(p.cases * 100) / 100,
      revenue: p.revenue,
      share,
      growth
    });
  }

  return result.sort((a, b) => b.revenue - a.revenue);
}
