import prisma from '../../src/lib/db';
import fs from 'fs';
import path from 'path';

function getStats(arr: number[]) {
  const sorted = [...arr].sort((a, b) => a - b);
  return {
    min: Number(sorted[0].toFixed(2)),
    med: Number(sorted[Math.floor(sorted.length * 0.5)].toFixed(2)),
    p95: Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
    avg: Number((sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2))
  };
}

function extractPlan(explainResult: any) {
  const raw = explainResult[0]['QUERY PLAN'];
  return typeof raw === 'string' ? JSON.parse(raw)[0] : raw[0];
}

async function main() {
  const regionTag = process.argv[2] || 'region_a';
  const outDir = path.resolve(__dirname, `results-13c/${regionTag}`);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log(`=== RUNNING DB BREAKDOWN & RTT MEASUREMENT FOR: ${regionTag} ===\n`);

  // 1. Raw Network Round-Trip Ping (20 samples as per Section 14)
  console.log('--- 1. Raw DB Ping (20 samples) ---');
  const pingTimes: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    await prisma.$queryRaw`SELECT 1 AS probe, clock_timestamp() AS server_time`;
    const elapsed = performance.now() - t0;
    pingTimes.push(elapsed);
  }
  const pingStats = getStats(pingTimes);
  console.log(`Ping stats (20 samples): Min: ${pingStats.min}ms | Med: ${pingStats.med}ms | p95: ${pingStats.p95}ms | Max: ${pingStats.max}ms\n`);

  // 2. Representative Operations (Section 15)
  console.log('--- 2. PostgreSQL Execution vs Client Elapsed Time (Section 15) ---');
  
  // A. User.findUnique
  const userExplain = await prisma.$queryRaw<any[]>`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT * FROM "User" WHERE id = 'cmuu23o100004gtcmitqraqjx'
  `;
  const userDbExecMs = extractPlan(userExplain)['Execution Time'];
  const userClientTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await prisma.user.findUnique({ where: { id: 'cmuu23o100004gtcmitqraqjx' } });
    userClientTimes.push(performance.now() - t0);
  }
  const userClientMed = getStats(userClientTimes).med;

  // B. Order.count
  const countExplain = await prisma.$queryRaw<any[]>`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT COUNT(*) FROM "Order" WHERE status != 'DRAFT'
  `;
  const countDbExecMs = extractPlan(countExplain)['Execution Time'];
  const countClientTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await prisma.order.count({ where: { status: { not: 'DRAFT' } } });
    countClientTimes.push(performance.now() - t0);
  }
  const countClientMed = getStats(countClientTimes).med;

  // C. Order.findMany (take 25)
  const findManyExplain = await prisma.$queryRaw<any[]>`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT o.id, o."orderNumber", o.status, o."totalPrice", o."createdAt"
    FROM "Order" o
    WHERE o.status != 'DRAFT'
    ORDER BY o."createdAt" DESC
    LIMIT 25
  `;
  const findManyDbExecMs = extractPlan(findManyExplain)['Execution Time'];
  const findManyClientTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await prisma.order.findMany({
      where: { status: { not: 'DRAFT' } },
      take: 25,
      orderBy: { createdAt: 'desc' }
    });
    findManyClientTimes.push(performance.now() - t0);
  }
  const findManyClientMed = getStats(findManyClientTimes).med;

  // D. Product lookup
  const prodExplain = await prisma.$queryRaw<any[]>`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT * FROM "Product" WHERE sku = 'LOADTEST-SKU-1'
  `;
  const prodDbExecMs = extractPlan(prodExplain)['Execution Time'];
  const prodClientTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await prisma.product.findUnique({ where: { sku: 'LOADTEST-SKU-1' } });
    prodClientTimes.push(performance.now() - t0);
  }
  const prodClientMed = getStats(prodClientTimes).med;

  // E. Stock deduction
  const stockExplain = await prisma.$queryRaw<any[]>`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    UPDATE "Product" AS p
    SET "stockPacks" = p."stockPacks" - 0
    WHERE p.sku = 'LOADTEST-SKU-1'
    RETURNING p.id
  `;
  const stockDbExecMs = extractPlan(stockExplain)['Execution Time'];
  const stockClientTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await prisma.$queryRaw`
      UPDATE "Product" AS p
      SET "stockPacks" = p."stockPacks" - 0
      WHERE p.sku = 'LOADTEST-SKU-1'
      RETURNING p.id
    `;
    stockClientTimes.push(performance.now() - t0);
  }
  const stockClientMed = getStats(stockClientTimes).med;

  const summary = [
    { operation: 'User.findUnique', dbExecMs: userDbExecMs, clientMedMs: userClientMed, networkOverheadMs: Number((userClientMed - userDbExecMs).toFixed(2)) },
    { operation: 'Order.count', dbExecMs: countDbExecMs, clientMedMs: countClientMed, networkOverheadMs: Number((countClientMed - countDbExecMs).toFixed(2)) },
    { operation: 'Order.findMany', dbExecMs: findManyDbExecMs, clientMedMs: findManyClientMed, networkOverheadMs: Number((findManyClientMed - findManyDbExecMs).toFixed(2)) },
    { operation: 'Product lookup', dbExecMs: prodDbExecMs, clientMedMs: prodClientMed, networkOverheadMs: Number((prodClientMed - prodDbExecMs).toFixed(2)) },
    { operation: 'Stock deduction SQL', dbExecMs: stockDbExecMs, clientMedMs: stockClientMed, networkOverheadMs: Number((stockClientMed - stockDbExecMs).toFixed(2)) },
  ];

  console.table(summary);

  const outData = {
    regionTag,
    pingStats,
    dbBreakdown: summary
  };

  fs.writeFileSync(path.join(outDir, 'db-breakdown.json'), JSON.stringify(outData, null, 2), 'utf-8');
  console.log(`\n✓ Saved to ${path.join(outDir, 'db-breakdown.json')}`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
