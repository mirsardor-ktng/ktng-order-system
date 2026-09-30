import prisma from '../src/lib/db';
import { OrdersService } from '../src/lib/orders/orders.service';
import {
  getTashkentStartOfDay,
  getTashkentStartOfNextDay,
  getTashkentTodayString,
  getTashkentWeekAgoString
} from '../src/lib/date-utils';

async function main() {
  console.log('--- RUNNING TEST: DATE FILTERING SUITE ---');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`[PASS] ${msg}`);
      passed++;
    } else {
      console.error(`[FAIL] ${msg}`);
      failed++;
    }
  }

  // 1. Test Date Utility Functions
  console.log('\n--- 1. Testing date-utils helpers ---');

  const startOf29 = getTashkentStartOfDay('2026-09-29');
  assert(startOf29 !== null, 'getTashkentStartOfDay returns Date for valid YYYY-MM-DD');
  assert(startOf29?.toISOString() === '2026-09-28T19:00:00.000Z', 'Start of 2026-09-29 in Tashkent (UTC+5) is 2026-09-28T19:00:00.000Z');

  const startOfNextDay = getTashkentStartOfNextDay('2026-09-29');
  assert(startOfNextDay !== null, 'getTashkentStartOfNextDay returns Date for valid YYYY-MM-DD');
  assert(startOfNextDay?.toISOString() === '2026-09-29T19:00:00.000Z', 'Start of next day for 2026-09-29 is 2026-09-29T19:00:00.000Z');

  const diffMs = (startOfNextDay?.getTime() || 0) - (startOf29?.getTime() || 0);
  assert(diffMs === 24 * 60 * 60 * 1000, 'Difference between start and next day is exactly 24 hours');

  const invalidStart = getTashkentStartOfDay('not-a-date');
  assert(invalidStart === null, 'Invalid date string returns null');

  const todayStr = getTashkentTodayString();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(todayStr), `getTashkentTodayString format matches YYYY-MM-DD: ${todayStr}`);

  const weekAgoStr = getTashkentWeekAgoString();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(weekAgoStr), `getTashkentWeekAgoString format matches YYYY-MM-DD: ${weekAgoStr}`);

  // 2. Integration Tests with Database & OrdersService
  console.log('\n--- 2. Testing OrdersService.getOrders with date filters ---');

  // Create test customer
  const testCustomer = await prisma.user.create({
    data: {
      email: `date_filter_user_${Date.now()}@test.com`,
      name: 'Date Filter User',
      passwordHash: 'dummy',
      role: 'CUSTOMER'
    }
  });

  const adminSession: any = {
    userId: 'admin-test-id',
    name: 'Admin User',
    email: 'admin@test.com',
    role: 'ADMIN',
    permissions: ['*']
  };

  const customerSession: any = {
    userId: testCustomer.id,
    name: testCustomer.name,
    email: testCustomer.email,
    role: 'CUSTOMER',
    permissions: ['orders:view_own']
  };

  const createdOrderIds: string[] = [];

  try {
    // Seed 5 orders around the boundaries:
    // Order 1: 2026-09-28 23:59:59 Tashkent -> 2026-09-28T18:59:59.000Z
    const o1 = await prisma.order.create({
      data: {
        orderNumber: `ORD-DF-1-${Date.now()}`,
        status: 'NEW',
        customerId: testCustomer.id,
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0,
        totalPrice: 10000,
        createdAt: new Date('2026-09-28T18:59:59.000Z')
      }
    });
    createdOrderIds.push(o1.id);

    // Order 2: 2026-09-29 00:00:00 Tashkent -> 2026-09-28T19:00:00.000Z (boundary start)
    const o2 = await prisma.order.create({
      data: {
        orderNumber: `ORD-DF-2-${Date.now()}`,
        status: 'NEW',
        customerId: testCustomer.id,
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0,
        totalPrice: 10000,
        createdAt: new Date('2026-09-28T19:00:00.000Z')
      }
    });
    createdOrderIds.push(o2.id);

    // Order 3: 2026-09-29 17:00:00 Tashkent -> 2026-09-29T12:00:00.000Z (midday)
    const o3 = await prisma.order.create({
      data: {
        orderNumber: `ORD-DF-3-${Date.now()}`,
        status: 'NEW',
        customerId: testCustomer.id,
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0,
        totalPrice: 10000,
        createdAt: new Date('2026-09-29T12:00:00.000Z')
      }
    });
    createdOrderIds.push(o3.id);

    // Order 4: 2026-09-29 23:59:59.999 Tashkent -> 2026-09-29T18:59:59.999Z (boundary end)
    const o4 = await prisma.order.create({
      data: {
        orderNumber: `ORD-DF-4-${Date.now()}`,
        status: 'NEW',
        customerId: testCustomer.id,
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0,
        totalPrice: 10000,
        createdAt: new Date('2026-09-29T18:59:59.999Z')
      }
    });
    createdOrderIds.push(o4.id);

    // Order 5: 2026-09-30 00:00:00 Tashkent -> 2026-09-29T19:00:00.000Z (next day start)
    const o5 = await prisma.order.create({
      data: {
        orderNumber: `ORD-DF-5-${Date.now()}`,
        status: 'NEW',
        customerId: testCustomer.id,
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0,
        totalPrice: 10000,
        createdAt: new Date('2026-09-29T19:00:00.000Z')
      }
    });
    createdOrderIds.push(o5.id);

    // Test A: Single day filter for 2026-09-29
    console.log('\nTesting single day filter (2026-09-29)...');
    const ordersDay29 = await OrdersService.getOrders(adminSession, {
      startDate: '2026-09-29',
      endDate: '2026-09-29'
    });
    const idsDay29 = new Set(ordersDay29.map(o => o.id));

    assert(!idsDay29.has(o1.id), 'Order 1 (previous day 23:59:59) is excluded');
    assert(idsDay29.has(o2.id), 'Order 2 (start of day 00:00:00) is included');
    assert(idsDay29.has(o3.id), 'Order 3 (midday) is included');
    assert(idsDay29.has(o4.id), 'Order 4 (end of day 23:59:59) is included');
    assert(!idsDay29.has(o5.id), 'Order 5 (next day 00:00:00) is excluded');

    // Test B: Multi-day filter (2026-09-28 to 2026-09-29)
    console.log('\nTesting multi-day filter (2026-09-28 to 2026-09-29)...');
    const orders28to29 = await OrdersService.getOrders(adminSession, {
      startDate: '2026-09-28',
      endDate: '2026-09-29'
    });
    const ids28to29 = new Set(orders28to29.map(o => o.id));

    assert(ids28to29.has(o1.id), 'Order 1 (Sep 28) is included in 28-29 range');
    assert(ids28to29.has(o2.id), 'Order 2 (Sep 29) is included in 28-29 range');
    assert(ids28to29.has(o3.id), 'Order 3 (Sep 29) is included in 28-29 range');
    assert(ids28to29.has(o4.id), 'Order 4 (Sep 29) is included in 28-29 range');
    assert(!ids28to29.has(o5.id), 'Order 5 (Sep 30) is excluded from 28-29 range');

    // Test C: Open-ended start date (startDate: '2026-09-29')
    console.log('\nTesting open-ended start date (startDate: 2026-09-29)...');
    const ordersFrom29 = await OrdersService.getOrders(adminSession, {
      startDate: '2026-09-29'
    });
    const idsFrom29 = new Set(ordersFrom29.map(o => o.id));

    assert(!idsFrom29.has(o1.id), 'Order 1 (Sep 28) is excluded when startDate=2026-09-29');
    assert(idsFrom29.has(o2.id), 'Order 2 (Sep 29) is included when startDate=2026-09-29');
    assert(idsFrom29.has(o5.id), 'Order 5 (Sep 30) is included when startDate=2026-09-29 and no endDate');

    // Test D: Open-ended end date (endDate: '2026-09-29')
    console.log('\nTesting open-ended end date (endDate: 2026-09-29)...');
    const ordersUntil29 = await OrdersService.getOrders(adminSession, {
      endDate: '2026-09-29'
    });
    const idsUntil29 = new Set(ordersUntil29.map(o => o.id));

    assert(idsUntil29.has(o1.id), 'Order 1 (Sep 28) is included when endDate=2026-09-29');
    assert(idsUntil29.has(o4.id), 'Order 4 (Sep 29) is included when endDate=2026-09-29');
    assert(!idsUntil29.has(o5.id), 'Order 5 (Sep 30) is excluded when endDate=2026-09-29');

    // Test E: Customer session with date filter
    console.log('\nTesting customer session with date filter...');
    const customerOrdersDay29 = await OrdersService.getOrders(customerSession, {
      startDate: '2026-09-29',
      endDate: '2026-09-29'
    });
    const custIdsDay29 = new Set(customerOrdersDay29.map(o => o.id));

    assert(custIdsDay29.has(o2.id) && custIdsDay29.has(o3.id) && custIdsDay29.has(o4.id), 'Customer sees their own orders within date range');
    assert(!custIdsDay29.has(o1.id) && !custIdsDay29.has(o5.id), 'Customer does not see orders outside date range');

  } finally {
    // Cleanup
    console.log('\n--- Cleanup ---');
    if (createdOrderIds.length > 0) {
      await prisma.order.deleteMany({
        where: { id: { in: createdOrderIds } }
      });
      console.log(`Cleaned up ${createdOrderIds.length} test orders`);
    }
    await prisma.user.delete({
      where: { id: testCustomer.id }
    });
    console.log('Cleaned up test customer user');
  }

  console.log(`\n===================================`);
  console.log(`TOTAL PASSED: ${passed}`);
  console.log(`TOTAL FAILED: ${failed}`);
  console.log(`===================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
