import fs from 'fs';
import path from 'path';

const dirA = path.resolve(__dirname, '../../tests/load/results-13c/region_a');
const dirB = path.resolve(__dirname, '../../tests/load/results-13c/region_b');

function pctDiff(base: number, comp: number): string {
  if (base === 0) return '0.0%';
  const diff = ((comp - base) / base) * 100;
  return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`;
}

function loadJson(p: string) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

async function main() {
  console.log('======================================================================');
  console.log('=== PHASE 13C-A: COMPREHENSIVE A/B REGION BENCHMARK COMPARISON     ===');
  console.log('=== A: Washington D.C. (iad1) vs B: Singapore (sin1)               ===');
  console.log('======================================================================\n');

  // 1. Cold Starts
  const coldA = loadJson(path.join(dirA, 'cold-start.json'));
  const coldB = loadJson(path.join(dirB, 'cold-start.json'));

  console.log('--- 1. COLD START LATENCY COMPARISON ---');
  const coldTable = coldA.map((rowA: any, idx: number) => {
    const rowB = coldB[idx];
    return {
      endpoint: rowA.endpoint,
      'A avg (ms)': rowA.avgMs,
      'B avg (ms)': rowB.avgMs,
      'Avg Δ (%)': pctDiff(rowA.avgMs, rowB.avgMs),
      'A p50 (ms)': rowA.p50Ms,
      'B p50 (ms)': rowB.p50Ms,
      'p50 Δ (%)': pctDiff(rowA.p50Ms, rowB.p50Ms),
    };
  });
  console.table(coldTable);

  // 2. Warm Single-User (100 sequential requests each)
  const warmA = loadJson(path.join(dirA, 'warm-single-user.json'));
  const warmB = loadJson(path.join(dirB, 'warm-single-user.json'));

  console.log('\n--- 2. WARM SINGLE-USER LATENCY (100 REQUESTS SEQUENTIAL) ---');
  const eps = [
    { key: 'products', name: 'GET /api/products' },
    { key: 'calcConfig', name: 'GET /api/orders/calculation-config' },
    { key: 'ordersHistory', name: 'GET /api/orders?page=1&pageSize=25' }
  ];

  const warmTable = eps.map(e => {
    const a = warmA[e.key];
    const b = warmB[e.key];
    return {
      endpoint: e.name,
      'A p50 (ms)': a.p50,
      'B p50 (ms)': b.p50,
      'p50 Δ (%)': pctDiff(a.p50, b.p50),
      'A p95 (ms)': a.p95,
      'B p95 (ms)': b.p95,
      'p95 Δ (%)': pctDiff(a.p95, b.p95),
      'A avg (ms)': a.avg,
      'B avg (ms)': b.avg,
      'Avg Δ (%)': pctDiff(a.avg, b.avg),
    };
  });
  console.table(warmTable);

  // 3. Browsing Concurrency Matrix
  const browseA = loadJson(path.join(dirA, 'browsing-concurrency.json'));
  const browseB = loadJson(path.join(dirB, 'browsing-concurrency.json'));

  console.log('\n--- 3. CUSTOMER BROWSING CONCURRENCY BENCHMARK (k6) ---');
  const browseTable = browseA.map((rowA: any, idx: number) => {
    const rowB = browseB[idx];
    return {
      VUs: rowA.vus,
      'A Reqs': rowA.reqs,
      'B Reqs': rowB.reqs,
      'A p50 (ms)': rowA.medMs,
      'B p50 (ms)': rowB.medMs,
      'p50 Δ (%)': pctDiff(rowA.medMs, rowB.medMs),
      'A p95 (ms)': rowA.p95Ms,
      'B p95 (ms)': rowB.p95Ms,
      'p95 Δ (%)': pctDiff(rowA.p95Ms, rowB.p95Ms),
      'A P2024': rowA.p2024,
      'B P2024': rowB.p2024
    };
  });
  console.table(browseTable);

  // 4. Order Creation Concurrency Matrix
  const ordersA = loadJson(path.join(dirA, 'orders-concurrency.json'));
  const ordersB = loadJson(path.join(dirB, 'orders-concurrency.json'));

  console.log('\n--- 4. CONCURRENT ORDER CREATION BENCHMARK (k6) ---');
  const ordersTable = ordersA.map((rowA: any, idx: number) => {
    const rowB = ordersB[idx];
    return {
      ConcurrentVUs: rowA.vus,
      'A Orders Reqs': rowA.reqs,
      'B Orders Reqs': rowB.reqs,
      'A p50 (ms)': rowA.medMs,
      'B p50 (ms)': rowB.medMs,
      'p50 Δ (%)': pctDiff(rowA.medMs, rowB.medMs),
      'A p95 (ms)': rowA.p95Ms,
      'B p95 (ms)': rowB.p95Ms,
      'p95 Δ (%)': pctDiff(rowA.p95Ms, rowB.p95Ms),
      'A P2024': rowA.p2024,
      'B P2024': rowB.p2024
    };
  });
  console.table(ordersTable);

  console.log('\n======================================================================');
}

main().catch(console.error);
