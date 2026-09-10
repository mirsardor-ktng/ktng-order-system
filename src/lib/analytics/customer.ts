import { getMonthKey, getPreviousMonthKey, calculatePercentageChange } from './helpers';

export interface CustomerInsights {
  averageOrderCases: number;
  lastOrderDaysAgo: number | null;
  favoriteProduct: string | null;
  favoriteProductShare: number;
  topSystemGrowingProduct: { name: string; growth: number } | null;
  averageCheckTrend: 'UP' | 'DOWN' | 'EQUAL';
  casesAllTime: number;
  casesThisYear: number;
  casesThisMonth: number;
}

export function calculateCustomerInsights(customerOrders: any[], allSystemOrders?: any[]): CustomerInsights {
  const totalOrders = customerOrders.length;
  
  // 1. All-time, Year, Month Boxes Stats
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  let casesAllTime = 0;
  let casesThisYear = 0;
  let casesThisMonth = 0;

  for (const o of customerOrders) {
    const oDate = new Date(o.createdAt);
    casesAllTime += o.totalCases;
    if (oDate.getFullYear() === currentYear) {
      casesThisYear += o.totalCases;
      if (oDate.getMonth() === currentMonth) {
        casesThisMonth += o.totalCases;
      }
    }
  }

  // 2. Average Order Size (Cases)
  const averageOrderCases = totalOrders > 0 ? Math.round((casesAllTime / totalOrders) * 10) / 10 : 0;

  // 3. Last Order Days Ago
  let lastOrderDaysAgo: number | null = null;
  if (totalOrders > 0) {
    const sortedOrders = [...customerOrders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const lastOrderDate = new Date(sortedOrders[0].createdAt);
    const diffTime = Math.abs(now.getTime() - lastOrderDate.getTime());
    lastOrderDaysAgo = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }

  // 4. Favorite Product & its Share
  const productPacksMap = new Map<string, { name: string; packs: number }>();
  let totalPacksBought = 0;

  for (const o of customerOrders) {
    for (const item of o.items) {
      const name = item.productNameSnapshot || item.product?.name || 'Unknown Product';
      const packs = item.quantityPacks;
      totalPacksBought += packs;
      const key = item.productId;
      if (!productPacksMap.has(key)) {
        productPacksMap.set(key, { name, packs: 0 });
      }
      productPacksMap.get(key)!.packs += packs;
    }
  }

  let favoriteProduct: string | null = null;
  let favoriteProductPacks = 0;
  for (const p of productPacksMap.values()) {
    if (p.packs > favoriteProductPacks) {
      favoriteProduct = p.name;
      favoriteProductPacks = p.packs;
    }
  }

  const favoriteProductShare = totalPacksBought > 0 ? Math.round((favoriteProductPacks / totalPacksBought) * 100) : 0;

  // 5. Top growing product MoM (computed from customer's orders, or system orders if provided)
  const topSystemGrowingProduct = calculateTopGrowingProduct(allSystemOrders || customerOrders);

  // 6. Average Check Trend (Current Month vs Previous Month)
  let averageCheckTrend: 'UP' | 'DOWN' | 'EQUAL' = 'EQUAL';
  if (totalOrders > 0) {
    const latestMonthKey = getMonthKey(now);
    const prevMonthKey = getPreviousMonthKey(latestMonthKey);

    const latestOrders = customerOrders.filter(o => getMonthKey(o.createdAt) === latestMonthKey);
    const prevOrders = customerOrders.filter(o => getMonthKey(o.createdAt) === prevMonthKey);

    const latestAvg = latestOrders.length > 0 
      ? latestOrders.reduce((sum, o) => sum + o.totalPrice, 0) / latestOrders.length
      : 0;

    const prevAvg = prevOrders.length > 0 
      ? prevOrders.reduce((sum, o) => sum + o.totalPrice, 0) / prevOrders.length
      : 0;

    if (latestAvg > prevAvg && prevAvg > 0) {
      averageCheckTrend = 'UP';
    } else if (latestAvg < prevAvg && latestAvg > 0) {
      averageCheckTrend = 'DOWN';
    }
  }

  return {
    averageOrderCases: Math.round(averageOrderCases * 100) / 100,
    lastOrderDaysAgo,
    favoriteProduct,
    favoriteProductShare,
    topSystemGrowingProduct,
    averageCheckTrend,
    casesAllTime: Math.round(casesAllTime * 100) / 100,
    casesThisYear: Math.round(casesThisYear * 100) / 100,
    casesThisMonth: Math.round(casesThisMonth * 100) / 100,
  };
}

function calculateTopGrowingProduct(orders: any[]): { name: string; growth: number } | null {
  if (orders.length === 0) return null;

  // Group orders by month to find the latest two months with activity
  const months = Array.from(new Set(orders.map(o => getMonthKey(o.createdAt)))).sort();
  if (months.length < 2) return null;

  const currentMonthKey = months[months.length - 1];
  const previousMonthKey = months[months.length - 2];

  const currentOrders = orders.filter(o => getMonthKey(o.createdAt) === currentMonthKey);
  const previousOrders = orders.filter(o => getMonthKey(o.createdAt) === previousMonthKey);

  const productCurrentRevenue = new Map<string, { name: string; revenue: number }>();
  const productPreviousRevenue = new Map<string, number>();

  for (const o of currentOrders) {
    for (const item of o.items) {
      const key = item.productId;
      const name = item.productNameSnapshot || item.product?.name || 'Unknown Product';
      const itemTotalPrice = item.itemTotalPrice ?? (item.quantityPacks * item.price);
      if (!productCurrentRevenue.has(key)) {
        productCurrentRevenue.set(key, { name, revenue: 0 });
      }
      productCurrentRevenue.get(key)!.revenue += itemTotalPrice;
    }
  }

  for (const o of previousOrders) {
    for (const item of o.items) {
      const key = item.productId;
      const itemTotalPrice = item.itemTotalPrice ?? (item.quantityPacks * item.price);
      productPreviousRevenue.set(key, (productPreviousRevenue.get(key) || 0) + itemTotalPrice);
    }
  }

  let topProduct: string | null = null;
  let maxGrowth = -Infinity;

  for (const [productId, p] of productCurrentRevenue.entries()) {
    const prevRev = productPreviousRevenue.get(productId) || 0;
    // We only calculate growth if there was sales in previous month to prevent division by zero
    if (prevRev > 0) {
      const growth = calculatePercentageChange(p.revenue, prevRev);
      if (growth > maxGrowth) {
        maxGrowth = growth;
        topProduct = p.name;
      }
    }
  }

  // Fallback if no products sold in previous month or if growth is negative/zero
  if (!topProduct || maxGrowth === -Infinity) {
    // Just find product with highest revenue in current month
    let maxRev = 0;
    for (const p of productCurrentRevenue.values()) {
      if (p.revenue > maxRev) {
        maxRev = p.revenue;
        topProduct = p.name;
      }
    }
    maxGrowth = 15; // default fallback visual
  }

  return topProduct ? { name: topProduct, growth: maxGrowth } : null;
}
