export function calculateCustomerAnalytics(orders: any[]) {
  const customerMap = new Map<string, { customerId: string; customerName: string; orders: number; revenue: number }>();

  for (const order of orders) {
    const key = order.customerId;
    const name = order.customer?.name || 'Unknown Client';

    if (!customerMap.has(key)) {
      customerMap.set(key, {
        customerId: key,
        customerName: name,
        orders: 0,
        revenue: 0
      });
    }

    const c = customerMap.get(key)!;
    c.orders += 1;
    c.revenue += order.totalPrice;
  }

  return Array.from(customerMap.values())
    .map(c => ({
      ...c,
      averageOrder: c.orders > 0 ? Math.round(c.revenue / c.orders) : 0
    }))
    .sort((a, b) => b.revenue - a.revenue);
}
