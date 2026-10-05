import prisma from '../../src/lib/db';
import { OrdersService } from '../../src/lib/orders/orders.service';
import { ProductGroupService } from '../../src/lib/product-groups/product-groups.service';
import { getOrderCalculationConfig, invalidateOrderCalculationConfig } from '../../src/lib/calculation/config-cache';
import { JWTPayload } from '../../src/lib/auth';

function getPercentiles(arr: number[]) {
  if (arr.length === 0) return { p50: 0, p90: 0, p95: 0, p99: 0, max: 0, avg: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p90 = sorted[Math.floor(sorted.length * 0.90)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
  const max = sorted[sorted.length - 1];
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    p50: Number(p50.toFixed(2)),
    p90: Number(p90.toFixed(2)),
    p95: Number(p95.toFixed(2)),
    p99: Number(p99.toFixed(2)),
    max: Number(max.toFixed(2)),
    avg: Number(avg.toFixed(2))
  };
}

async function main() {
  console.log('===============================================================');
  console.log('=== PHASE 13B: COLD VS WARM BENCHMARK & ORDER CAPACITY      ===');
  console.log('===============================================================\n');

  const customerUser = await prisma.user.findFirst({
    where: { email: 'loadtest-user-001@ktng-test.local' },
    include: { roleTemplate: true, company: true }
  });

  if (!customerUser) throw new Error('Test customer not found');

  const session: JWTPayload = {
    userId: customerUser.id,
    email: customerUser.email,
    name: customerUser.name,
    role: 'CUSTOMER',
    roleTemplateId: customerUser.roleTemplateId || undefined,
    roleName: customerUser.roleTemplate?.name || 'Клиент',
    permissions: customerUser.roleTemplate?.permissions || ['orders:create', 'orders:view_own'],
    companyId: customerUser.companyId || undefined,
    sessionVersion: customerUser.sessionVersion
  };

  const testProduct = await prisma.product.findUnique({
    where: { sku: 'LOADTEST-SKU-1' }
  });

  if (!testProduct) throw new Error('Test product LOADTEST-SKU-1 not found');

  // =============================================================
  // PART 1: Cold vs Warm Comparison
  // =============================================================
  console.log('--- PART 1: Cold vs Warm Comparison ---');

  // Operation A: Products / Catalog
  ProductGroupService.invalidateCatalogCache();
  const tColdProd0 = performance.now();
  const coldProducts = await ProductGroupService.getCatalogGroups();
  const coldProdMs = performance.now() - tColdProd0;

  const tWarmProd0 = performance.now();
  const warmProducts = await ProductGroupService.getCatalogGroups();
  const warmProdMs = performance.now() - tWarmProd0;

  console.log(`1. Catalog (GET /api/products):`);
  console.log(`   - Cold (Cache Miss): ${coldProdMs.toFixed(2)} ms (DB roundtrip)`);
  console.log(`   - Warm (Cache Hit):  ${warmProdMs.toFixed(2)} ms (In-memory, speedup ${(coldProdMs / warmProdMs).toFixed(0)}x)\n`);

  // Operation B: Calculation Config
  invalidateOrderCalculationConfig();
  const tColdConf0 = performance.now();
  const coldConfig = await getOrderCalculationConfig(session.companyId);
  const coldConfMs = performance.now() - tColdConf0;

  const tWarmConf0 = performance.now();
  const warmConfig = await getOrderCalculationConfig(session.companyId);
  const warmConfMs = performance.now() - tWarmConf0;

  console.log(`2. Calculation Config (GET /api/orders/calculation-config):`);
  console.log(`   - Cold (Cache Miss): ${coldConfMs.toFixed(2)} ms (DB roundtrips)`);
  console.log(`   - Warm (Cache Hit):  ${warmConfMs.toFixed(2)} ms (In-memory, speedup ${(coldConfMs / warmConfMs).toFixed(0)}x)\n`);

  // Operation C: Orders History (GET /api/orders?page=1&pageSize=25)
  const tColdOrd0 = performance.now();
  const coldOrders = await OrdersService.getOrders(session, { page: 1, pageSize: 25 });
  const coldOrdMs = performance.now() - tColdOrd0;

  const tWarmOrd0 = performance.now();
  const warmOrders = await OrdersService.getOrders(session, { page: 1, pageSize: 25 });
  const warmOrdMs = performance.now() - tWarmOrd0;

  console.log(`3. Orders History (GET /api/orders):`);
  console.log(`   - Cold Execution:    ${coldOrdMs.toFixed(2)} ms`);
  console.log(`   - Warm Execution:    ${warmOrdMs.toFixed(2)} ms\n`);

  // Operation D: Order Creation (POST /api/orders)
  invalidateOrderCalculationConfig();
  const tColdCreate0 = performance.now();
  const coldOrderRes = await OrdersService.createOrder(session, {
    items: [{ productId: testProduct.id, quantityPacks: 10 }],
    status: 'NEW'
  });
  const coldCreateMs = performance.now() - tColdCreate0;

  // Second run: Warm calculation config
  const tWarmCreate0 = performance.now();
  const warmOrderRes = await OrdersService.createOrder(session, {
    items: [{ productId: testProduct.id, quantityPacks: 10 }],
    status: 'NEW'
  });
  const warmCreateMs = performance.now() - tWarmCreate0;

  console.log(`4. Order Creation (POST /api/orders):`);
  console.log(`   - Cold Create:       ${coldCreateMs.toFixed(2)} ms (un-primed config)`);
  console.log(`   - Warm Create:       ${warmCreateMs.toFixed(2)} ms (primed config)\n`);

  // Cleanup the two test orders
  await prisma.orderItemSku.deleteMany({ where: { orderItem: { orderId: { in: [coldOrderRes.order.id, warmOrderRes.order.id] } } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: [coldOrderRes.order.id, warmOrderRes.order.id] } } });
  await prisma.order.deleteMany({ where: { id: { in: [coldOrderRes.order.id, warmOrderRes.order.id] } } });
  await prisma.product.update({
    where: { id: testProduct.id },
    data: { stockPacks: { increment: 20 } }
  });

  // =============================================================
  // PART 2: Controlled Order Creation Concurrency Benchmark (1, 5, 10, 20, 30)
  // =============================================================
  console.log('--- PART 2: Controlled Order Creation Concurrency Benchmark ---');

  const concurrencyLevels = [1, 5, 10, 20, 30];
  const benchmarkSummary: any[] = [];

  const initialStock = (await prisma.product.findUnique({ where: { id: testProduct.id } }))!.stockPacks;
  let accumulatedPacksOrdered = 0;

  for (const concurrency of concurrencyLevels) {
    console.log(`Executing ${concurrency} simultaneous order creations...`);
    const times: number[] = [];
    let p2024Count = 0;
    let errors = 0;
    const createdOrderIds: string[] = [];

    const promises = Array.from({ length: concurrency }).map(async (_, idx) => {
      const t0 = performance.now();
      try {
        const res = await OrdersService.createOrder(session, {
          items: [{ productId: testProduct.id, quantityPacks: 10 }],
          status: 'NEW'
        });
        const elapsed = performance.now() - t0;
        times.push(elapsed);
        createdOrderIds.push(res.order.id);
        accumulatedPacksOrdered += 10;
      } catch (err: any) {
        errors++;
        if (err?.code === 'P2024' || err?.message?.includes('P2024')) {
          p2024Count++;
        }
        console.error(`Order failed at concurrency ${concurrency} (worker ${idx}):`, err.message);
      }
    });

    await Promise.all(promises);

    const stats = getPercentiles(times);
    const successRate = (((concurrency - errors) / concurrency) * 100).toFixed(1) + '%';

    benchmarkSummary.push({
      concurrency,
      successRate,
      p2024: p2024Count,
      errors,
      avgMs: stats.avg,
      medMs: stats.p50,
      p90Ms: stats.p90,
      p95Ms: stats.p95,
      p99Ms: stats.p99,
      maxMs: stats.max
    });

    console.log(`  Completed ${concurrency} orders: Success: ${successRate} | p50: ${stats.p50}ms | p95: ${stats.p95}ms | Max: ${stats.max}ms | P2024: ${p2024Count}`);

    // Clean up created orders
    if (createdOrderIds.length > 0) {
      await prisma.orderItemSku.deleteMany({ where: { orderItem: { orderId: { in: createdOrderIds } } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
  }

  // Restore stock
  await prisma.product.update({
    where: { id: testProduct.id },
    data: { stockPacks: initialStock }
  });
  const finalStock = (await prisma.product.findUnique({ where: { id: testProduct.id } }))!.stockPacks;

  console.log('\n--- Final Stock Integrity Check ---');
  console.log(`Initial Stock: ${initialStock} | Final Stock: ${finalStock} | Match: ${initialStock === finalStock ? 'PERFECT ✓' : 'MISMATCH ✗'}\n`);

  console.log('--- CONTROLLED ORDER BENCHMARK RESULTS TABLE ---');
  console.table(benchmarkSummary);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
