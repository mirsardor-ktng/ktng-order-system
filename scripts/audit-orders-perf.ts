import prisma from '../src/lib/db';
import { OrdersService } from '../src/lib/orders/orders.service';
import { JWTPayload } from '../src/lib/auth';

async function main() {
  console.log('=== AUDIT: ORDERS HISTORY & STATUS UPDATE ===\n');

  // 1. Total order counts
  const totalOrders = await prisma.order.count();
  const draftOrders = await prisma.order.count({ where: { status: 'DRAFT' } });
  const newOrders = await prisma.order.count({ where: { status: 'NEW' } });
  const acceptedOrders = await prisma.order.count({ where: { status: 'ACCEPTED' } });
  const completedOrders = await prisma.order.count({ where: { status: 'COMPLETED' } });
  const cancelledOrders = await prisma.order.count({ where: { status: 'CANCELLED' } });
  console.log(`Total orders in DB: ${totalOrders}`);
  console.log(`- DRAFT: ${draftOrders}`);
  console.log(`- NEW: ${newOrders}`);
  console.log(`- ACCEPTED: ${acceptedOrders}`);
  console.log(`- COMPLETED: ${completedOrders}`);
  console.log(`- CANCELLED: ${cancelledOrders}`);

  // 2. Mock Admin / Seller session
  const user = await prisma.user.findFirst({
    where: { isActive: true },
    include: { company: true }
  });
  if (!user) throw new Error('No user found');

  const sellerSession: JWTPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: 'ADMIN' as any,
    permissions: ['orders:view_all', 'orders:status_change', 'orders:validation:view'],
    companyId: user.companyId || undefined
  };

  // 3. Measure Unpaginated getOrders()
  console.log('\n--- Measuring Unpaginated OrdersService.getOrders() ---');
  const t0 = performance.now();
  const unpaginated = await OrdersService.getOrders(sellerSession, {});
  const t1 = performance.now();
  const unpaginatedTime = Math.round(t1 - t0);
  const unpaginatedCount = Array.isArray(unpaginated) ? unpaginated.length : unpaginated.orders?.length;
  const jsonSize = JSON.stringify(unpaginated).length;
  console.log(`Unpaginated call took: ${unpaginatedTime} ms`);
  console.log(`Orders returned: ${unpaginatedCount}`);
  console.log(`Payload size: ${(jsonSize / 1024).toFixed(1)} KB`);

  // 4. Measure Paginated getOrders(page=1, pageSize=25)
  console.log('\n--- Measuring Paginated OrdersService.getOrders(page=1, pageSize=25) ---');
  const t2 = performance.now();
  const paginated = await OrdersService.getOrders(sellerSession, { page: 1, pageSize: 25 });
  const t3 = performance.now();
  const paginatedTime = Math.round(t3 - t2);
  const paginatedCount = paginated.orders.length;
  const paginatedJsonSize = JSON.stringify(paginated).length;
  console.log(`Paginated (25) call took: ${paginatedTime} ms`);
  console.log(`Orders returned: ${paginatedCount}`);
  console.log(`Payload size: ${(paginatedJsonSize / 1024).toFixed(1)} KB`);
  console.log(`Pagination metadata:`, paginated.pagination);

  // 5. Measure Status Update Time
  if (unpaginatedCount > 0) {
    const targetOrder = Array.isArray(unpaginated) ? unpaginated[0] : unpaginated.orders[0];
    console.log(`\n--- Measuring updateOrderStatus on Order ${targetOrder.orderNumber} ---`);
    console.log(`Current status: ${targetOrder.status}`);
  }

  console.log('\n=== AUDIT COMPLETE ===');
}

main().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
