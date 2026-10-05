import prisma from '../../src/lib/db';
import { Prisma } from '@prisma/client';

async function main() {
  console.log('===============================================================');
  console.log('=== PHASE 13B: NETWORK VS DATABASE EXECUTION TIME DIAGNOSTIC ===');
  console.log('===============================================================\n');

  // 1. Measure raw connection & network round-trip ping
  console.log('--- 1. Raw Network Round-Trip Latency (Ping) ---');
  const pingTimes: number[] = [];

  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    const result = await prisma.$queryRaw<Array<{ probe: number; server_time: Date }>>`
      SELECT 1 AS probe, clock_timestamp() AS server_time
    `;
    const t1 = performance.now();
    const elapsed = t1 - t0;
    pingTimes.push(elapsed);
    console.log(`Ping ${i + 1}: ${elapsed.toFixed(2)} ms (Server responded: ${result[0]?.server_time.toISOString()})`);
  }

  pingTimes.sort((a, b) => a - b);
  const minPing = pingTimes[0];
  const medPing = pingTimes[Math.floor(pingTimes.length * 0.5)];
  const maxPing = pingTimes[pingTimes.length - 1];
  const avgPing = pingTimes.reduce((a, b) => a + b, 0) / pingTimes.length;

  console.log(`\nPing Statistics: Min: ${minPing.toFixed(2)}ms | Med: ${medPing.toFixed(2)}ms | Avg: ${avgPing.toFixed(2)}ms | Max: ${maxPing.toFixed(2)}ms\n`);

  // 2. Measure Query Execution Time Inside PostgreSQL vs Total Client Elapsed Time
  console.log('--- 2. PostgreSQL Query Execution Time vs Network Overhead ---');
  
  function extractPlan(explainResult: any) {
    const raw = explainResult[0]['QUERY PLAN'];
    return typeof raw === 'string' ? JSON.parse(raw)[0] : raw[0];
  }

  // Test A: User Lookup
  const userExplain = await prisma.$queryRaw<any[]>`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT * FROM "User" WHERE id = 'cmuu23o100004gtcmitqraqjx'
  `;
  const userPlan = extractPlan(userExplain);
  const userDbExecMs = userPlan['Execution Time'];
  const userDbPlanMs = userPlan['Planning Time'];

  const tUser0 = performance.now();
  await prisma.user.findUnique({ where: { id: 'cmuu23o100004gtcmitqraqjx' } });
  const userClientElapsed = performance.now() - tUser0;

  console.log('Query: User.findUnique');
  console.log(`  - PostgreSQL Planning Time:  ${userDbPlanMs.toFixed(3)} ms`);
  console.log(`  - PostgreSQL Execution Time: ${userDbExecMs.toFixed(3)} ms`);
  console.log(`  - Total Client Elapsed Time: ${userClientElapsed.toFixed(2)} ms`);
  console.log(`  - Network & Driver Overhead: ${(userClientElapsed - userDbExecMs).toFixed(2)} ms (${(((userClientElapsed - userDbExecMs) / userClientElapsed) * 100).toFixed(1)}% of total)\n`);

  // Test B: Order Pagination Query (Orders list with joins)
  const ordersExplain = await prisma.$queryRaw<any[]>`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT o.id, o."orderNumber", o.status, o."totalPrice", o."createdAt"
    FROM "Order" o
    WHERE o.status != 'DRAFT'
    ORDER BY o."createdAt" DESC
    LIMIT 25
  `;
  const ordersPlan = extractPlan(ordersExplain);
  const ordersDbExecMs = ordersPlan['Execution Time'];
  const ordersDbPlanMs = ordersPlan['Planning Time'];

  const tOrders0 = performance.now();
  await prisma.order.findMany({
    where: { status: { not: 'DRAFT' } },
    take: 25,
    orderBy: { createdAt: 'desc' }
  });
  const ordersClientElapsed = performance.now() - tOrders0;

  console.log('Query: Order.findMany (take 25)');
  console.log(`  - PostgreSQL Planning Time:  ${ordersDbPlanMs.toFixed(3)} ms`);
  console.log(`  - PostgreSQL Execution Time: ${ordersDbExecMs.toFixed(3)} ms`);
  console.log(`  - Total Client Elapsed Time: ${ordersClientElapsed.toFixed(2)} ms`);
  console.log(`  - Network & Driver Overhead: ${(ordersClientElapsed - ordersDbExecMs).toFixed(2)} ms (${(((ordersClientElapsed - ordersDbExecMs) / ordersClientElapsed) * 100).toFixed(1)}% of total)\n`);

  // Test C: Batch Stock Update SQL
  const stockExplain = await prisma.$queryRaw<any[]>`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    UPDATE "Product" AS p
    SET "stockPacks" = p."stockPacks" - v.needed
    FROM (VALUES ('cmuu23noc0001gtcmpzjipz0a'::text, 0::integer)) AS v(id, needed)
    WHERE p.id = v.id AND p."stockPacks" >= v.needed
    RETURNING p.id
  `;
  const stockPlan = extractPlan(stockExplain);
  const stockDbExecMs = stockPlan['Execution Time'];

  const tStock0 = performance.now();
  await prisma.$queryRaw`
    UPDATE "Product" AS p
    SET "stockPacks" = p."stockPacks" - v.needed
    FROM (VALUES ('cmuu23noc0001gtcmpzjipz0a'::text, 0::integer)) AS v(id, needed)
    WHERE p.id = v.id AND p."stockPacks" >= v.needed
    RETURNING p.id
  `;
  const stockClientElapsed = performance.now() - tStock0;

  console.log('Query: batchDeductStock (SQL atomic update)');
  console.log(`  - PostgreSQL Execution Time: ${stockDbExecMs.toFixed(3)} ms`);
  console.log(`  - Total Client Elapsed Time: ${stockClientElapsed.toFixed(2)} ms`);
  console.log(`  - Network & Driver Overhead: ${(stockClientElapsed - stockDbExecMs).toFixed(2)} ms (${(((stockClientElapsed - stockDbExecMs) / stockClientElapsed) * 100).toFixed(1)}% of total)\n`);

  console.log('=== Network vs Database Diagnostic Complete ===\n');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
