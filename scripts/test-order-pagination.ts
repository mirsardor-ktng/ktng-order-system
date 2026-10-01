import prisma from '../src/lib/db';
import { OrdersService } from '../src/lib/orders/orders.service';
import { JWTPayload } from '../src/lib/auth';

async function main() {
  console.log('=== STARTING ORDER PAGINATION TEST SUITE ===\n');

  const ts = Date.now();
  const testEmail = `page_test_${ts}@example.com`;

  // 1. Setup test user & company
  const company = await prisma.company.create({
    data: {
      name: `Pagination Test Company ${ts}`,
      code: `PTC_${ts}`
    }
  });

  const user = await prisma.user.create({
    data: {
      email: testEmail,
      name: `Pagination Test User ${ts}`,
      passwordHash: 'dummy_hash',
      role: 'ADMIN',
      companyId: company.id
    }
  });

  const session: JWTPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: 'ADMIN',
    roleName: 'Суперадминистратор',
    permissions: ['*'],
    companyId: company.id
  };

  const totalOrdersToCreate = 30;

  try {
    console.log(`[Setup] Creating ${totalOrdersToCreate} test orders...`);
    const createdOrderIds: string[] = [];

    // Create 30 orders with different timestamps
    for (let i = 1; i <= totalOrdersToCreate; i++) {
      const order = await prisma.order.create({
        data: {
          orderNumber: `ORD-PAGE-${ts}-${String(i).padStart(3, '0')}`,
          customerId: user.id,
          createdByUserId: user.id,
          companyId: company.id,
          status: i <= 5 ? 'CANCELLED' : 'NEW',
          totalPrice: 100000 * i,
          totalPacks: i,
          totalBlocks: 1,
          totalCases: 0,
          createdAt: new Date(Date.now() - (totalOrdersToCreate - i) * 60000) // 1 min apart
        }
      });
      createdOrderIds.push(order.id);
    }
    console.log(`✓ Successfully seeded ${totalOrdersToCreate} orders`);

    // -------------------------------------------------------------
    // Test 1: Page 1 with pageSize = 25
    // -------------------------------------------------------------
    console.log('\n[Test 1] Testing page 1 with pageSize = 25...');
    const page1Res = await OrdersService.getOrders(session, { page: 1, pageSize: 25 });

    if (!page1Res || !page1Res.pagination) {
      throw new Error('Expected paginated result structure { orders, pagination }');
    }

    if (!Array.isArray(page1Res.orders) || page1Res.orders.length !== 25) {
      throw new Error(`Expected exactly 25 orders on page 1, got ${page1Res.orders?.length}`);
    }

    if (page1Res.pagination.page !== 1 || page1Res.pagination.pageSize !== 25) {
      throw new Error(`Invalid pagination metadata on page 1: ${JSON.stringify(page1Res.pagination)}`);
    }

    if (page1Res.pagination.total < totalOrdersToCreate) {
      throw new Error(`Expected total >= ${totalOrdersToCreate}, got ${page1Res.pagination.total}`);
    }

    console.log(`✓ Page 1 returned 25 orders, total=${page1Res.pagination.total}, totalPages=${page1Res.pagination.totalPages}`);

    // -------------------------------------------------------------
    // Test 2: Page 2 with pageSize = 25 (offset check)
    // -------------------------------------------------------------
    console.log('\n[Test 2] Testing page 2 with pageSize = 25...');
    const page2Res = await OrdersService.getOrders(session, { page: 2, pageSize: 25 });

    if (!page2Res || !page2Res.pagination) {
      throw new Error('Expected paginated result structure { orders, pagination }');
    }

    if (page2Res.pagination.page !== 2) {
      throw new Error(`Expected page 2, got ${page2Res.pagination.page}`);
    }

    const page1Ids = new Set(page1Res.orders.map((o: any) => o.id));
    const overlap = page2Res.orders.filter((o: any) => page1Ids.has(o.id));
    if (overlap.length > 0) {
      throw new Error(`Found overlapping orders between page 1 and page 2: ${overlap.map((o: any) => o.id)}`);
    }

    console.log(`✓ Page 2 returned ${page2Res.orders.length} orders disjoint from page 1`);

    // -------------------------------------------------------------
    // Test 3: Page sizes 50, 100, and strict normalization (25, 50, 100 only)
    // -------------------------------------------------------------
    console.log('\n[Test 3] Testing strict pageSize normalization (25, 50, 100 only)...');
    const page50Res = await OrdersService.getOrders(session, { page: 1, pageSize: 50 });
    if (page50Res.pagination.pageSize !== 50) {
      throw new Error(`Expected pageSize 50, got ${page50Res.pagination.pageSize}`);
    }

    const page100Res = await OrdersService.getOrders(session, { page: 1, pageSize: 100 });
    if (page100Res.pagination.pageSize !== 100) {
      throw new Error(`Expected pageSize 100, got ${page100Res.pagination.pageSize}`);
    }

    // Arbitrary sizes (37, 75, 101, 0, negative) should all normalize to 25
    for (const testSize of [37, 75, 101, 0, -10]) {
      const normRes = await OrdersService.getOrders(session, { page: 1, pageSize: testSize });
      if (normRes.pagination.pageSize !== 25) {
        throw new Error(`Expected pageSize ${testSize} to normalize to 25, got ${normRes.pagination.pageSize}`);
      }
    }
    console.log('✓ PageSize strict normalization passed: 50 -> 50, 100 -> 100, (37, 75, 101, 0, -10) -> 25');

    // -------------------------------------------------------------
    // Test 4: Backwards-compatible unpaginated mode
    // -------------------------------------------------------------
    console.log('\n[Test 4] Testing backwards-compatible unpaginated query...');
    const unpaginatedRes = await OrdersService.getOrders(session);
    if (!Array.isArray(unpaginatedRes)) {
      throw new Error('Expected raw Array when neither page nor pageSize are specified');
    }
    console.log(`✓ Unpaginated call returns raw Array of length ${unpaginatedRes.length}`);

    // -------------------------------------------------------------
    // Test 5: Pagination with Status filter
    // -------------------------------------------------------------
    console.log('\n[Test 5] Testing pagination combined with status filter (CANCELLED)...');
    const cancelledPaginated = await OrdersService.getOrders(session, { status: 'CANCELLED', page: 1, pageSize: 25 });
    if (!cancelledPaginated.pagination) {
      throw new Error('Expected paginated result for filtered query');
    }
    const allCancelled = cancelledPaginated.orders.every((o: any) => o.status === 'CANCELLED');
    if (!allCancelled) {
      throw new Error('All returned orders must have status CANCELLED');
    }
    console.log(`✓ Status-filtered pagination returned ${cancelledPaginated.orders.length} CANCELLED orders out of total ${cancelledPaginated.pagination.total}`);

    console.log('\n=== ALL ORDER PAGINATION TESTS PASSED! ===');
  } finally {
    // Cleanup
    await prisma.order.deleteMany({ where: { companyId: company.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.company.delete({ where: { id: company.id } }).catch(() => {});
  }
}

main().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
