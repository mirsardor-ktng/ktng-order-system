import { execSync, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import prisma from '../../src/lib/db';

const K6_BIN = 'C:\\Program Files\\k6\\k6.exe';
const RESULTS_DIR = path.resolve(__dirname, 'results');

if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

interface TestRunConfig {
  name: string;
  script: string;
  vus: number;
  duration: string;
  description: string;
}

function runK6Test(config: TestRunConfig): any {
  console.log(`\n===============================================================`);
  console.log(`>>> RUNNING TEST: ${config.name} (${config.description})`);
  console.log(`    VUs: ${config.vus} | Duration: ${config.duration} | Script: ${config.script}`);
  console.log(`===============================================================\n`);

  const summaryExportPath = path.join(RESULTS_DIR, `${config.name}.json`);
  const logExportPath = path.join(RESULTS_DIR, `${config.name}.log`);

  const args = [
    'run',
    '--vus', String(config.vus),
    '--duration', config.duration,
    '--summary-trend-stats', 'avg,min,med,max,p(90),p(95),p(99)',
    '--summary-export', summaryExportPath,
    path.resolve(__dirname, config.script)
  ];

  const t0 = performance.now();
  const result = spawnSync(K6_BIN, args, {
    cwd: path.resolve(__dirname),
    encoding: 'utf-8',
    stdio: 'pipe',
    env: { ...process.env, TARGET_URL: 'https://ktng-order-system.vercel.app' }
  });
  const elapsedSec = ((performance.now() - t0) / 1000).toFixed(1);

  fs.writeFileSync(logExportPath, (result.stdout || '') + '\n' + (result.stderr || ''), 'utf-8');

  console.log(result.stdout);
  if (result.stderr && result.status !== 0) {
    console.error('STDERR:', result.stderr);
  }
  console.log(`Completed in ${elapsedSec}s. Exit code: ${result.status}`);

  if (fs.existsSync(summaryExportPath)) {
    try {
      return JSON.parse(fs.readFileSync(summaryExportPath, 'utf-8'));
    } catch (e) {
      console.error(`Failed to parse summary JSON for ${config.name}:`, e);
    }
  }
  return null;
}

async function verifyStockIntegrity() {
  console.log('\n--- Checking Stock & Order Data Integrity in Supabase ---');
  const company = await prisma.company.findUnique({ where: { code: 'LOADTEST' } });
  if (!company) {
    console.log('No LOADTEST company found.');
    return;
  }

  const orders = await prisma.order.findMany({
    where: { companyId: company.id },
    include: { items: true }
  });

  const p1 = await prisma.product.findUnique({ where: { sku: 'LOADTEST-SKU-1' } });
  const p2 = await prisma.product.findUnique({ where: { sku: 'LOADTEST-SKU-2' } });

  const totalOrdersCreated = orders.length;
  let totalPacksOrderedP1 = 0;
  let totalPacksOrderedP2 = 0;

  for (const o of orders) {
    for (const it of o.items) {
      if (it.productId === p1?.id) totalPacksOrderedP1 += it.quantityPacks;
      if (it.productId === p2?.id) totalPacksOrderedP2 += it.quantityPacks;
    }
  }

  console.log(`Total load test orders in DB: ${totalOrdersCreated}`);
  console.log(`Product 1 (LOADTEST-SKU-1) ordered packs: ${totalPacksOrderedP1}, Current stock: ${p1?.stockPacks}`);
  console.log(`Product 2 (LOADTEST-SKU-2) ordered packs: ${totalPacksOrderedP2}, Current stock: ${p2?.stockPacks}`);

  const p1ExpectedStock = 1000000 - totalPacksOrderedP1;
  const p1Accurate = p1?.stockPacks === p1ExpectedStock;
  console.log(`Stock Deduction Accuracy for SKU-1: ${p1Accurate ? 'PERFECT MATCH ✓' : `MISMATCH (Expected ${p1ExpectedStock}, Got ${p1?.stockPacks}) ✗`}`);

  return {
    totalOrdersCreated,
    totalPacksOrderedP1,
    p1CurrentStock: p1?.stockPacks,
    p1Accurate
  };
}

async function main() {
  console.log('###############################################################');
  console.log('### PHASE 13A: FULL LOAD & CAPACITY TEST SUITE              ###');
  console.log('### Target: Vercel Production + Supabase Singapore Postgres  ###');
  console.log('###############################################################\n');

  // Pre-cleanup
  console.log('1. Cleaning up any previous test orders...');
  execSync('npx tsx scripts/load/cleanup-test-data.ts', { stdio: 'inherit' });

  // -------------------------------------------------------------
  // Part A: Customer Browsing Concurrency Matrix
  // -------------------------------------------------------------
  const browsingTests: TestRunConfig[] = [
    { name: 'browse_1vu', script: 'k6-browse.js', vus: 1, duration: '25s', description: 'Baseline Single User' },
    { name: 'browse_5vu', script: 'k6-browse.js', vus: 5, duration: '25s', description: '5 Concurrent Browsers' },
    { name: 'browse_10vu', script: 'k6-browse.js', vus: 10, duration: '25s', description: '10 Concurrent Browsers' },
    { name: 'browse_20vu', script: 'k6-browse.js', vus: 20, duration: '25s', description: '20 Concurrent Browsers' },
    { name: 'browse_30vu', script: 'k6-browse.js', vus: 30, duration: '25s', description: '30 Concurrent Browsers' },
    { name: 'browse_50vu', script: 'k6-browse.js', vus: 50, duration: '25s', description: '50 Stress Concurrency' }
  ];

  console.log('\n===============================================================');
  console.log('=== PART A: CUSTOMER BROWSING CONCURRENCY BENCHMARK ===');
  console.log('===============================================================\n');

  for (const test of browsingTests) {
    runK6Test(test);
    // Cool-down 3 seconds between tiers
    spawnSync('powershell', ['-Command', 'Start-Sleep -Seconds 3']);
  }

  // -------------------------------------------------------------
  // Part B: Concurrent Order Creation Matrix
  // -------------------------------------------------------------
  const orderTests: TestRunConfig[] = [
    { name: 'orders_1vu', script: 'k6-orders.js', vus: 1, duration: '20s', description: 'Baseline 1 VU Order Submission' },
    { name: 'orders_5vu', script: 'k6-orders.js', vus: 5, duration: '20s', description: '5 Concurrent Order Submissions' },
    { name: 'orders_10vu', script: 'k6-orders.js', vus: 10, duration: '20s', description: '10 Concurrent Order Submissions' },
    { name: 'orders_20vu', script: 'k6-orders.js', vus: 20, duration: '20s', description: '20 Concurrent Order Submissions' },
    { name: 'orders_25vu', script: 'k6-orders.js', vus: 25, duration: '20s', description: '25 Peak Order Submissions' },
    { name: 'orders_30vu', script: 'k6-orders.js', vus: 30, duration: '20s', description: '30 Maximum Concurrency Stress' }
  ];

  console.log('\n===============================================================');
  console.log('=== PART B: CONCURRENT ORDER CREATION BENCHMARK ===');
  console.log('===============================================================\n');

  for (const test of orderTests) {
    runK6Test(test);
    spawnSync('powershell', ['-Command', 'Start-Sleep -Seconds 3']);
  }

  // -------------------------------------------------------------
  // Part C: Seller Journal Pagination Benchmark
  // -------------------------------------------------------------
  const sellerTests: TestRunConfig[] = [
    { name: 'seller_1vu', script: 'k6-seller.js', vus: 1, duration: '20s', description: 'Seller Journal Single User' },
    { name: 'seller_5vu', script: 'k6-seller.js', vus: 5, duration: '20s', description: '5 Concurrent Sellers Journal Pagination' }
  ];

  console.log('\n===============================================================');
  console.log('=== PART C: SELLER JOURNAL PAGINATION BENCHMARK ===');
  console.log('===============================================================\n');

  for (const test of sellerTests) {
    runK6Test(test);
    spawnSync('powershell', ['-Command', 'Start-Sleep -Seconds 3']);
  }

  // -------------------------------------------------------------
  // Part D: Integrity Check
  // -------------------------------------------------------------
  const integrity = await verifyStockIntegrity();

  // Final cleanup
  console.log('\nCleaning up load test orders & restoring stock...');
  execSync('npx tsx scripts/load/cleanup-test-data.ts', { stdio: 'inherit' });

  console.log('\n###############################################################');
  console.log('### PHASE 13A LOAD TESTING SUITE COMPLETED SUCCESSFULLY!    ###');
  console.log('###############################################################\n');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
