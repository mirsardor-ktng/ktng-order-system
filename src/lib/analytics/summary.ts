export function calculateSummary(orders: any[]) {
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
    };
  }

  const totalRevenue = orders.reduce((sum, o) => sum + o.totalPrice, 0);
  const totalCases = orders.reduce((sum, o) => sum + o.totalCases, 0);

  const averageCheck = Math.round(totalRevenue / totalOrders);
  const averageCases = Math.round((totalCases / totalOrders) * 100) / 100;

  // Average number of unique SKUs per order
  let skuSum = 0;
  const allSkusSet = new Set<string>();

  for (const o of orders) {
    const orderSkus = new Set<string>();
    for (const item of o.items) {
      const sku = item.skuSnapshot || item.product?.sku || 'Unknown';
      orderSkus.add(sku);
      allSkusSet.add(sku);
    }
    skuSum += orderSkus.size;
  }

  const averageSkus = Math.round((skuSum / totalOrders) * 100) / 100;
  const totalUniqueSkus = allSkusSet.size;

  return {
    totalOrders,
    totalRevenue,
    averageCheck,
    totalCases: Math.round(totalCases * 100) / 100,
    averageCases,
    averageSkus,
    totalUniqueSkus,
  };
}
