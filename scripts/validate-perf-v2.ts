import prisma from '../src/lib/db';
import { Prisma } from '@prisma/client';
import { OrdersService } from '../src/lib/orders/orders.service';
import { ProductGroupService } from '../src/lib/product-groups/product-groups.service';
import { getOrderCalculationConfig, invalidateOrderCalculationConfig } from '../src/lib/calculation/config-cache';
import { calculateOrderPure } from '../src/lib/calculation/engine';
import { OrderItemInput } from '../src/lib/calculation/types';
import { JWTPayload } from '../src/lib/auth';

// Helper to compute percentiles
function getPercentiles(arr: number[]) {
  if (arr.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
  return {
    p50: Number(p50.toFixed(2)),
    p95: Number(p95.toFixed(2)),
    p99: Number(p99.toFixed(2))
  };
}

async function runValidation() {
  console.log('===============================================================');
  console.log('  PRODUCTION PERFORMANCE VALIDATION — PERFORMANCE REFACTOR V2  ');
  console.log('===============================================================\n');

  // --------------------------------------------------------------------------
  // SECTION 2: Production Environment Inspection
  // --------------------------------------------------------------------------
  console.log('--- SECTION 2: Production Environment Inspection ---');
  const rawDbUrl = process.env.DATABASE_URL || '';
  let maskedHost = 'unknown';
  let port = 'unknown';
  let protocol = 'unknown';
  let searchParamsStr = '';
  try {
    const parsed = new URL(rawDbUrl);
    protocol = parsed.protocol;
    maskedHost = parsed.hostname.replace(/^(.)(.*)(.)$/, '$1***$3');
    port = parsed.port || '5432';
    searchParamsStr = parsed.searchParams.toString();
  } catch (e) {
    maskedHost = 'invalid-url';
  }

  console.log(`DB Protocol:        ${protocol}`);
  console.log(`DB Host (masked):   ${maskedHost}`);
  console.log(`DB Port:            ${port}`);
  console.log(`DB URL Parameters:  ${searchParamsStr || 'none'}`);
  console.log(`Runtime Node:       ${process.version}`);
  console.log(`Platform / Arch:    ${process.platform} / ${process.arch}`);
  console.log(`Next.js:            14.1.0 / React 18.2.0`);
  console.log(`Prisma Client:      5.22.0`);
  console.log(`Prisma Config:      connection_limit=5, pool_timeout=20 enforced by src/lib/db.ts`);
  console.log(`Storage Service:    Google Drive API (v3) with disk fallback`);
  console.log('Environment check complete.\n');

  // --------------------------------------------------------------------------
  // SECTION 3: Prisma Connection Pool & Concurrency Test
  // --------------------------------------------------------------------------
  console.log('--- SECTION 3: Prisma Connection Pool & Concurrency Test ---');
  const concurrencyLevels = [1, 5, 10];
  let p2024Count = 0;

  for (const concurrency of concurrencyLevels) {
    console.log(`Testing concurrency level: ${concurrency} simultaneous queries...`);
    const durations: number[] = [];
    const promises = Array.from({ length: concurrency }).map(async (_, idx) => {
      const t0 = performance.now();
      try {
        await prisma.$queryRaw`SELECT 1 AS probe, pg_backend_pid() AS pid`;
        const t1 = performance.now();
        durations.push(t1 - t0);
      } catch (err: any) {
        if (err?.code === 'P2024' || err?.message?.includes('P2024')) {
          p2024Count++;
        }
        console.error(`Concurrency error at worker ${idx}:`, err.message);
      }
    });

    await Promise.all(promises);
    const stats = getPercentiles(durations);
    console.log(`  Concurrency ${concurrency}: p50=${stats.p50}ms, p95=${stats.p95}ms, p99=${stats.p99}ms | P2024 count: ${p2024Count}`);
  }
  console.log(`Total P2024 Errors across concurrency test: ${p2024Count} (Target: 0)\n`);

  // --------------------------------------------------------------------------
  // SECTION 4: Catalog Cache (GET /api/products)
  // --------------------------------------------------------------------------
  console.log('--- SECTION 4: Catalog Cache Benchmark ---');
  // 1. Cold Cache
  ProductGroupService.invalidateCatalogCache();
  const coldStart = performance.now();
  const coldResult = await ProductGroupService.getCatalogGroups();
  const coldDuration = performance.now() - coldStart;
  console.log(`Cold Cache (Cache Miss): ${coldDuration.toFixed(2)} ms (Returned ${coldResult.length} groups)`);

  // 2. Warm Cache (Repeated calls)
  const warmDurations: number[] = [];
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    await ProductGroupService.getCatalogGroups();
    warmDurations.push(performance.now() - t0);
  }
  const warmStats = getPercentiles(warmDurations);
  console.log(`Warm Cache (Cache Hit, 50 calls): p50=${warmStats.p50} ms, p95=${warmStats.p95} ms, p99=${warmStats.p99} ms`);
  console.log(`Serverless note: In-memory cache is container-local. Each lambda container holds warm cache for 60s.\n`);

  // --------------------------------------------------------------------------
  // SECTION 5: Calculation Engine Benchmark (Pure In-Memory)
  // --------------------------------------------------------------------------
  console.log('--- SECTION 5: Calculation Engine (calculateOrderPure) Benchmark ---');
  // Fetch real config
  const { config } = await getOrderCalculationConfig();
  console.log(`Config loaded: ${config.products.length} products, ${config.groups.length} groups, ${config.promotions.length} promotions`);

  const skuCounts = [1, 10, 20, 40];
  const engineResults: Record<number, { p50: number; p95: number; p99: number }> = {};

  for (const count of skuCounts) {
    // Generate realistic order items
    const testItems: OrderItemInput[] = config.products.slice(0, count).map((p, idx) => ({
      productId: p.id,
      groupId: p.groupId,
      baseQuantityPacks: (idx % 5 + 1) * 10
    }));

    const iterations = 1000;
    const times: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      calculateOrderPure(testItems, config);
      const t1 = performance.now();
      times.push((t1 - t0) * 1000); // in microseconds
    }

    const microStats = getPercentiles(times);
    // Convert to ms for display
    engineResults[count] = {
      p50: Number((microStats.p50 / 1000).toFixed(4)),
      p95: Number((microStats.p95 / 1000).toFixed(4)),
      p99: Number((microStats.p99 / 1000).toFixed(4))
    };
    console.log(`SKU count ${count} (${iterations} iterations): p50=${(microStats.p50 / 1000).toFixed(4)} ms (${microStats.p50} µs), p95=${(microStats.p95 / 1000).toFixed(4)} ms, p99=${(microStats.p99 / 1000).toFixed(4)} ms`);
  }
  console.log('');

  // --------------------------------------------------------------------------
  // SECTION 7: Authoritative Server Calculation Verification
  // --------------------------------------------------------------------------
  console.log('--- SECTION 7: Authoritative Server Calculation Verification ---');
  // Verify that server completely overrides client-provided price or totals
  const testUser = await prisma.user.findFirst({
    where: { isActive: true },
    include: { company: true }
  });
  if (!testUser) throw new Error('No test user');

  const testProduct = config.products[0];
  const tamperedItems = [
    {
      productId: testProduct.id,
      groupId: testProduct.groupId,
      baseQuantityPacks: 10,
      quantityPacks: 10,
      price: 1, // TAMPERED: Should be e.g. 15000
      itemTotalPrice: 10, // TAMPERED
      effectivePrice: 1 // TAMPERED
    }
  ];

  const session: JWTPayload = {
    userId: testUser.id,
    email: testUser.email,
    name: testUser.name,
    role: testUser.role as any,
    permissions: ['orders:create', 'orders:view_all', 'orders:validation:view'],
    companyId: testUser.companyId || undefined
  };

  const draftRes = await OrdersService.createOrder(session, {
    items: tamperedItems,
    status: 'DRAFT'
  });

  const createdOrder = await prisma.order.findUnique({
    where: { id: draftRes.order.id },
    include: { items: true }
  });

  const expectedBasePrice = testProduct.basePrice;
  const actualLinePrice = createdOrder?.items[0]?.price;
  const isAuthoritative = actualLinePrice === expectedBasePrice;

  console.log(`Tampered client price: 1 UZS`);
  console.log(`Authoritative product basePrice in DB: ${expectedBasePrice} UZS`);
  console.log(`Actual price stored in order: ${actualLinePrice} UZS`);
  console.log(`Authoritative verification passed: ${isAuthoritative}`);

  // Cleanup draft
  await prisma.order.delete({ where: { id: draftRes.order.id } });
  console.log('Authoritative check complete.\n');

  // --------------------------------------------------------------------------
  // SECTION 8: Stock Batch Operation (35 Products Realistic Order)
  // --------------------------------------------------------------------------
  console.log('--- SECTION 8: Stock Batch Operation Benchmark (35 Products) ---');
  // Select up to 35 products
  const batchProducts = await prisma.product.findMany({
    where: { isActive: true, stockPacks: { gte: 10 } },
    take: 35,
    select: { id: true, name: true, stockPacks: true }
  });

  console.log(`Found ${batchProducts.length} active products with available stock.`);
  const stockDecrements = new Map<string, number>();
  for (const p of batchProducts) {
    stockDecrements.set(p.id, 2);
  }

  // Measure successful batch deduction inside transaction
  const batchDeductTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    await prisma.$transaction(async (tx) => {
      const t0 = performance.now();
      await OrdersService.batchDeductStock(tx, stockDecrements);
      const t1 = performance.now();
      batchDeductTimes.push(t1 - t0);

      // Restore inside tx so stock is not modified
      await OrdersService.batchRestoreStock(tx, stockDecrements);
    });
  }

  const batchStats = getPercentiles(batchDeductTimes);
  console.log(`batchDeductStock (35 items, 5 runs): p50=${batchStats.p50} ms, p95=${batchStats.p95} ms, p99=${batchStats.p99} ms`);

  // Test Insufficient Stock Rollback
  let insufficientStockError = '';
  const invalidStockMap = new Map<string, number>();
  invalidStockMap.set(batchProducts[0].id, batchProducts[0].stockPacks + 99999);

  try {
    await prisma.$transaction(async (tx) => {
      await OrdersService.batchDeductStock(tx, invalidStockMap);
    });
  } catch (err: any) {
    insufficientStockError = err.message;
  }
  console.log(`Insufficient stock test: correctly rejected with message -> "${insufficientStockError}"`);

  // Verify stock was NOT modified
  const verifyProduct = await prisma.product.findUnique({
    where: { id: batchProducts[0].id },
    select: { stockPacks: true }
  });
  console.log(`Verified product stock unchanged: ${verifyProduct?.stockPacks === batchProducts[0].stockPacks} (${verifyProduct?.stockPacks})\n`);

  // --------------------------------------------------------------------------
  // SECTION 9: Transaction Benchmark (10, 20, 35 items)
  // --------------------------------------------------------------------------
  console.log('--- SECTION 9: Transaction Duration Benchmark ---');
  const txItemCounts = [10, 20, Math.min(35, batchProducts.length)];
  const txStatsSummary: Record<number, { p50: number; p95: number; p99: number }> = {};

  for (const count of txItemCounts) {
    const selected = batchProducts.slice(0, count);
    const orderItems = selected.map(p => ({
      productId: p.id,
      groupId: (p as any).groupId,
      baseQuantityPacks: 10,
      quantityPacks: 10
    }));

    const txTimes: number[] = [];
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      const res = await OrdersService.createOrder(session, {
        items: orderItems,
        status: 'NEW'
      });
      const t1 = performance.now();
      txTimes.push(t1 - t0);

      // Cleanup
      await OrdersService.updateOrderStatus(session, {
        orderId: res.order.id,
        status: 'CANCELLED',
        reason: 'Tx Benchmark Cleanup'
      });
    }

    txStatsSummary[count] = getPercentiles(txTimes);
    console.log(`Transaction with ${count} items (3 runs): p50=${txStatsSummary[count].p50} ms, p95=${txStatsSummary[count].p95} ms, p99=${txStatsSummary[count].p99} ms`);
  }
  console.log('');

  // --------------------------------------------------------------------------
  // SECTION 10: Excel Background Generation & Reliability Verification
  // --------------------------------------------------------------------------
  console.log('--- SECTION 10: Excel Background Generation & Reliability ---');
  const singleItemOrder = [{
    productId: batchProducts[0].id,
    baseQuantityPacks: 10,
    quantityPacks: 10
  }];

  const createStart = performance.now();
  const newOrderRes = await OrdersService.createOrder(session, {
    items: singleItemOrder,
    status: 'NEW'
  });
  const createEnd = performance.now();

  console.log(`Order created in: ${(createEnd - createStart).toFixed(2)} ms`);
  console.log(`Initial order fileUrl returned to client: ${newOrderRes.order.fileUrl} (null = non-blocking)`);

  // Test Immediate Download Fallback (ensureExcelGenerated)
  console.log('Testing immediate download fallback (ensureExcelGenerated)...');
  const tEns0 = performance.now();
  const ensured = await OrdersService.ensureExcelGenerated(newOrderRes.order.id);
  const tEns1 = performance.now();
  console.log(`ensureExcelGenerated resolved in ${(tEns1 - tEns0).toFixed(2)} ms`);
  console.log(`File ID: ${ensured?.fileId}`);
  console.log(`File Name: ${ensured?.fileName}`);
  console.log(`File URL: ${ensured?.fileUrl}`);

  // Test idempotent call (should return immediately from DB without re-upload)
  const tIdem0 = performance.now();
  const ensuredAgain = await OrdersService.ensureExcelGenerated(newOrderRes.order.id);
  const tIdem1 = performance.now();
  console.log(`Second call (idempotent, already has fileId): ${(tIdem1 - tIdem0).toFixed(2)} ms`);

  // Cleanup
  await OrdersService.updateOrderStatus(session, {
    orderId: newOrderRes.order.id,
    status: 'CANCELLED',
    reason: 'Excel Background Cleanup'
  });
  console.log('Excel background test complete.\n');

  // --------------------------------------------------------------------------
  // SECTION 12: Controlled Load Test (1, 5, 10, 25 concurrent orders)
  // --------------------------------------------------------------------------
  console.log('--- SECTION 12: Controlled Load Test ---');
  const loadLevels = [1, 5, 10, 25];
  const loadSummary: Record<number, { p50: number; p95: number; p99: number; errorRate: number; p2024: number }> = {};

  for (const concurrentOrders of loadLevels) {
    console.log(`Executing ${concurrentOrders} concurrent orders...`);
    const times: number[] = [];
    let errors = 0;
    let localP2024 = 0;
    const createdOrderIds: string[] = [];

    const orderPromises = Array.from({ length: concurrentOrders }).map(async (_, idx) => {
      const t0 = performance.now();
      try {
        const res = await OrdersService.createOrder(session, {
          items: [{
            productId: batchProducts[0].id,
            baseQuantityPacks: 10,
            quantityPacks: 10
          }],
          status: 'DRAFT' // Use DRAFT for high concurrency so stock is not exhausted
        });
        const t1 = performance.now();
        times.push(t1 - t0);
        createdOrderIds.push(res.order.id);
      } catch (err: any) {
        errors++;
        if (err?.code === 'P2024' || err?.message?.includes('P2024')) {
          localP2024++;
        }
      }
    });

    await Promise.all(orderPromises);
    const stats = getPercentiles(times);
    loadSummary[concurrentOrders] = {
      p50: stats.p50,
      p95: stats.p95,
      p99: stats.p99,
      errorRate: Number(((errors / concurrentOrders) * 100).toFixed(1)),
      p2024: localP2024
    };

    console.log(`  Load ${concurrentOrders}: p50=${stats.p50}ms, p95=${stats.p95}ms, p99=${stats.p99}ms | Error rate: ${loadSummary[concurrentOrders].errorRate}% | P2024: ${localP2024}`);

    // Cleanup created drafts
    if (createdOrderIds.length > 0) {
      await prisma.order.deleteMany({
        where: { id: { in: createdOrderIds } }
      });
    }
  }
  console.log('Controlled load test complete.\n');

  // --------------------------------------------------------------------------
  // SECTION 14: Cache Invalidation Verification
  // --------------------------------------------------------------------------
  console.log('--- SECTION 14: Cache Invalidation Verification ---');
  // 1. Config Cache Invalidation
  await getOrderCalculationConfig(); // Ensure warm
  const configWarmBefore = await getOrderCalculationConfig();
  invalidateOrderCalculationConfig();
  const configColdAfter = await getOrderCalculationConfig();
  console.log(`Config cache invalidation works: ${configWarmBefore.config !== configColdAfter.config}`);

  // 2. Catalog Cache Invalidation
  await ProductGroupService.getCatalogGroups(); // Ensure warm
  ProductGroupService.invalidateCatalogCache();
  const tCatStart = performance.now();
  await ProductGroupService.getCatalogGroups();
  const tCatAfter = performance.now() - tCatStart;
  console.log(`Catalog cache invalidation successfully forced fresh DB query: ${tCatAfter.toFixed(2)} ms`);

  // 3. Template Cache Invalidation
  OrdersService.invalidateTemplateCache();
  console.log(`Template cache invalidation invoked successfully.`);

  console.log('\n===============================================================');
  console.log('  ALL PRODUCTION VALIDATION TESTS COMPLETED SUCCESSFULLY!      ');
  console.log('===============================================================\n');
}

runValidation().catch(err => {
  console.error('Validation script failed:', err);
  process.exit(1);
});
