import prisma from '../../src/lib/db';
import { Prisma } from '@prisma/client';

async function main() {
  console.log('===============================================================');
  console.log('=== PHASE 13B: PRISMA CONNECTION POOL & CONTENTION AUDIT   ===');
  console.log('===============================================================\n');

  console.log('Current Database Configuration:');
  console.log('  - Driver: Prisma 5.22.0');
  console.log('  - Database URL: Supabase Singapore (ap-southeast-1) via PgBouncer 5432');
  console.log('  - connection_limit: 5');
  console.log('  - pool_timeout: 20s\n');

  // Test 1: Concurrency Contention Matrix
  // We fire N concurrent queries simultaneously through the same PrismaClient instance
  // to measure exact connection queuing delay.
  const levels = [1, 5, 10, 15, 20, 25];

  console.log('--- 1. Connection Acquisition Queue Delay Under Concurrency ---');

  for (const concurrency of levels) {
    const queueDelays: number[] = [];
    const queryDurations: number[] = [];
    const totalTimes: number[] = [];
    let p2024Errors = 0;

    const tStartAll = performance.now();

    const tasks = Array.from({ length: concurrency }).map(async (_, idx) => {
      const tSubmit = performance.now();
      try {
        // Query PostgreSQL backend PID and transaction start
        const res = await prisma.$queryRaw<Array<{ probe: number; pid: number; server_time: Date }>>`
          SELECT 1 AS probe, pg_backend_pid() AS pid, clock_timestamp() AS server_time
        `;
        const tComplete = performance.now();
        const totalElapsed = tComplete - tSubmit;
        totalTimes.push(totalElapsed);
      } catch (err: any) {
        if (err?.code === 'P2024' || err?.message?.includes('P2024') || err?.message?.includes('Timed out fetching')) {
          p2024Errors++;
        }
      }
    });

    await Promise.all(tasks);

    totalTimes.sort((a, b) => a - b);
    const p50 = totalTimes[Math.floor(totalTimes.length * 0.5)];
    const p90 = totalTimes[Math.floor(totalTimes.length * 0.9)];
    const max = totalTimes[totalTimes.length - 1];
    const avg = totalTimes.reduce((a, b) => a + b, 0) / (totalTimes.length || 1);

    // Estimated connection queue wait:
    // With 5 connection slots, the first 5 queries run in parallel (~130ms).
    // Queries 6-10 must wait for slots 1-5 to finish (~130ms wait).
    // Queries 11-15 must wait ~260ms.
    // Queries 21-25 must wait ~520ms.
    console.log(`Concurrency Level ${String(concurrency).padStart(2)}:`);
    console.log(`  - Total Completed: ${totalTimes.length}/${concurrency} (Failures: ${p2024Errors})`);
    console.log(`  - Min Duration:    ${totalTimes[0]?.toFixed(1)} ms`);
    console.log(`  - Median (p50):    ${p50?.toFixed(1)} ms`);
    console.log(`  - Average:         ${avg.toFixed(1)} ms`);
    console.log(`  - p90:             ${p90?.toFixed(1)} ms`);
    console.log(`  - Max Wait:        ${max?.toFixed(1)} ms`);
    console.log(`  - Queue Stacking:  ${(max / (totalTimes[0] || 1)).toFixed(1)}x baseline\n`);
  }

  // Test 2: Transaction Connection Occupancy Measurement
  console.log('--- 2. Transaction Connection Occupancy Duration ---');
  console.log('Measuring how long a database connection is held exclusively during a transaction...');

  const tTxStart = performance.now();
  await prisma.$transaction(async (tx) => {
    const t0 = performance.now();
    // Simulate stock deduction probe
    await tx.$queryRaw`SELECT pg_backend_pid()`;
    // Simulate order insert probe
    await tx.$queryRaw`SELECT 1`;
    // Simulate allocation insert probe
    await tx.$queryRaw`SELECT 2`;
    const t1 = performance.now();
    console.log(`  - Transaction internal queries duration: ${(t1 - t0).toFixed(1)} ms`);
  });
  const txOccupancyMs = performance.now() - tTxStart;
  console.log(`  - Total Connection Exclusive Lock Time: ${txOccupancyMs.toFixed(1)} ms`);
  console.log(`  - Note: During this entire ${txOccupancyMs.toFixed(1)} ms, 1 of the 5 connection slots was 100% blocked from serving any other request.\n`);

  console.log('=== Prisma Pool Diagnostic Complete ===\n');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
