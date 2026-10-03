import { calculatePercentageChange } from './helpers';

export interface AnalyticsSummary {
  totalOrders: number;
  totalRevenue: number;
  averageCheck: number;
  totalCases: number;
  averageCases: number;
  averageSkus: number;
  totalUniqueSkus: number;
  revenueGrowth?: number | null;
  ordersGrowth?: number | null;
  casesGrowth?: number | null;
  averageCheckGrowth?: number | null;
}

function getOrderRevenue(o: any): number {
  if (typeof o.totalPrice === 'number') return o.totalPrice;
  if (typeof o.totalAmount === 'number') return o.totalAmount;
  return 0;
}

function getOrderCases(o: any): number {
  if (typeof o.totalCases === 'number') return o.totalCases;
  if (!o.items || !Array.isArray(o.items)) return 0;
  return o.items.reduce((itemSum: number, item: any) => {
    if (typeof item.totalQuantityCases === 'number' && item.totalQuantityCases > 0) {
      return itemSum + item.totalQuantityCases;
    }
    if (typeof item.quantityCases === 'number' && item.quantityCases > 0) {
      return itemSum + item.quantityCases;
    }
    const packs = item.totalQuantityPacks || item.quantityPacks || item.quantity || 0;
    return itemSum + (packs / 500);
  }, 0);
}

export function calculateSummary(orders: any[], previousOrders?: any[]): AnalyticsSummary {
  const totalOrders = orders.length;
  if (totalOrders === 0) {
    return {
      totalOrders: 0,
      totalRevenue: 0,
      averageCheck: 0,
      totalCases: 0,
      averageCases: 0,
      averageSkus: 0,
      totalUniqueSkus: 0,
      revenueGrowth: previousOrders && previousOrders.length > 0 ? -100 : 0,
      ordersGrowth: previousOrders && previousOrders.length > 0 ? -100 : 0,
      casesGrowth: previousOrders && previousOrders.length > 0 ? -100 : 0,
      averageCheckGrowth: 0,
    };
  }

  const totalRevenue = orders.reduce((sum, o) => sum + getOrderRevenue(o), 0);
  const totalCases = orders.reduce((sum, o) => sum + getOrderCases(o), 0);

  const averageCheck = Math.round(totalRevenue / totalOrders);
  const averageCases = Math.round((totalCases / totalOrders) * 100) / 100;

  // Average number of unique SKUs per order
  let skuSum = 0;
  const allSkusSet = new Set<string>();

  for (const o of orders) {
    const orderSkus = new Set<string>();
    for (const item of (o.items || [])) {
      const sku = item.skuSnapshot || item.product?.sku || 'Unknown';
      orderSkus.add(sku);
      allSkusSet.add(sku);
    }
    skuSum += orderSkus.size;
  }

  const averageSkus = Math.round((skuSum / totalOrders) * 100) / 100;
  const totalUniqueSkus = allSkusSet.size;

  let revenueGrowth: number | null = null;
  let ordersGrowth: number | null = null;
  let casesGrowth: number | null = null;
  let averageCheckGrowth: number | null = null;

  if (previousOrders !== undefined) {
    const prevOrders = previousOrders.length;
    const prevRevenue = previousOrders.reduce((sum, o) => sum + getOrderRevenue(o), 0);
    const prevCases = previousOrders.reduce((sum, o) => sum + getOrderCases(o), 0);
    const prevAvgCheck = prevOrders > 0 ? Math.round(prevRevenue / prevOrders) : 0;

    revenueGrowth = calculatePercentageChange(totalRevenue, prevRevenue);
    ordersGrowth = calculatePercentageChange(totalOrders, prevOrders);
    casesGrowth = calculatePercentageChange(totalCases, prevCases);
    averageCheckGrowth = calculatePercentageChange(averageCheck, prevAvgCheck);
  }

  return {
    totalOrders,
    totalRevenue,
    averageCheck,
    totalCases: Math.round(totalCases * 100) / 100,
    averageCases,
    averageSkus,
    totalUniqueSkus,
    revenueGrowth,
    ordersGrowth,
    casesGrowth,
    averageCheckGrowth,
  };
}
