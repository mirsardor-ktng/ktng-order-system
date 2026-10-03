import prisma from '../src/lib/db';
import { OrdersService } from '../src/lib/orders/orders.service';
import { JWTPayload } from '../src/lib/auth';

async function main() {
  console.log('=== BENCHMARK: OrdersService.createOrder with Batch Stock & Background Excel ===\n');

  // 1. Pick test user
  const user = await prisma.user.findFirst({
    where: { isActive: true },
    include: { company: true }
  });

  if (!user) {
    console.error('No active user found');
    process.exit(1);
  }

  const session: JWTPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role as any,
    permissions: ['orders:create', 'orders:view_all', 'orders:validation:view'],
    companyId: user.companyId || undefined
  };

  // 2. Pick top 5 active products with stock >= 20
  const products = await prisma.product.findMany({
    where: { isActive: true, stockPacks: { gte: 20 } },
    take: 5
  });

  if (products.length === 0) {
    console.error('No active products with stock found');
    process.exit(1);
  }

  console.log(`Testing with ${products.length} products for customer: ${user.name}`);

  const orderItems = products.map(p => ({
    productId: p.id,
    groupId: p.groupId,
    baseQuantityPacks: 10,
    quantityPacks: 10
  }));

  // 3. Measure createOrder time (Cold run)
  console.log('--- Run 1 (Cold Cache) ---');
  const t0 = performance.now();
  const createResult = await OrdersService.createOrder(session, {
    items: orderItems,
    status: 'NEW'
  });
  const t1 = performance.now();
  const elapsed1 = Math.round(t1 - t0);

  console.log(`[Run 1] OrdersService.createOrder took: ${elapsed1} ms!`);

  // Run 2 (Warm Cache)
  console.log('\n--- Run 2 (Warm Cache) ---');
  const t2 = performance.now();
  const createResult2 = await OrdersService.createOrder(session, {
    items: orderItems,
    status: 'NEW'
  });
  const t3 = performance.now();
  const elapsed2 = Math.round(t3 - t2);

  console.log(`[Run 2] OrdersService.createOrder took: ${elapsed2} ms!`);

  // Clean up orders
  await OrdersService.updateOrderStatus(session, {
    orderId: createResult.order.id,
    status: 'CANCELLED',
    reason: 'Performance Benchmark Cleanup'
  });
  await OrdersService.updateOrderStatus(session, {
    orderId: createResult2.order.id,
    status: 'CANCELLED',
    reason: 'Performance Benchmark Cleanup'
  });

  console.log(`Orders successfully cancelled.`);
  console.log('\n✓ ALL PERFORMANCE BENCHMARK CHECKS COMPLETED SUCCESSFULLY!');
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
