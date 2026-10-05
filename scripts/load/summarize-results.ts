import fs from 'fs';
import path from 'path';

const dir = path.resolve(__dirname, '../../tests/load/results');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

interface MetricRow {
  test: string;
  vus: number;
  reqs: number;
  fails: number;
  failRate: string;
  p2024: number;
  avgMs: number;
  medMs: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

const rows: MetricRow[] = [];
const customMetrics: Record<string, any> = {};

for (const file of files) {
  try {
    const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
    const data = JSON.parse(raw);
    const m = data.metrics || {};
    const testName = file.replace('.json', '');
    const httpDur = m.http_req_duration || {};
    const reqs = m.http_reqs?.count || 0;
    const fails = m.http_req_failed?.passes || 0; // In k6, http_req_failed passes = failed requests
    const failRate = ((m.http_req_failed?.rate || 0) * 100).toFixed(1) + '%';
    const p2024Count = m.p2024_connection_errors?.count || 0;
    const vus = m.vus?.max || m.vus_max?.value || 0;

    rows.push({
      test: testName,
      vus,
      reqs,
      fails,
      failRate,
      p2024: p2024Count,
      avgMs: Math.round(httpDur.avg || 0),
      medMs: Math.round(httpDur.med || 0),
      p90Ms: Math.round(httpDur['p(90)'] || 0),
      p95Ms: Math.round(httpDur['p(95)'] || 0),
      p99Ms: Math.round(httpDur['p(99)'] || 0),
      maxMs: Math.round(httpDur.max || 0)
    });

    customMetrics[testName] = {
      login: m.login_duration,
      products: m.products_duration,
      calcConfig: m.calc_config_duration,
      ordersHistory: m.orders_history_duration,
      orderCreate: m.order_create_duration,
      sellerLogin: m.seller_login_duration,
      sellerOrdersP1: m.seller_orders_p1_duration,
      sellerOrdersP2: m.seller_orders_p2_duration
    };
  } catch (err: any) {
    console.error(`Error reading ${file}:`, err.message);
  }
}

// Sort by test group and VU count
const sortOrder = [
  'browse_1vu', 'browse_5vu', 'browse_10vu', 'browse_20vu', 'browse_30vu', 'browse_50vu',
  'orders_1vu', 'orders_5vu', 'orders_10vu', 'orders_20vu', 'orders_25vu', 'orders_30vu',
  'seller_1vu', 'seller_5vu'
];

rows.sort((a, b) => sortOrder.indexOf(a.test) - sortOrder.indexOf(b.test));

console.log('\n===============================================================');
console.log('=== OVERALL HTTP REQUEST METRICS TABLE ===');
console.log('===============================================================\n');
console.table(rows);

console.log('\n===============================================================');
console.log('=== ENDPOINT-LEVEL DETAILED BREAKDOWN ===');
console.log('===============================================================\n');

for (const testName of sortOrder) {
  const metrics = customMetrics[testName];
  if (!metrics) continue;

  console.log(`\n--- Test: ${testName} ---`);
  const endpointRows = [];
  for (const [epName, vals] of Object.entries(metrics)) {
    if (vals && typeof vals === 'object' && (vals as any).avg) {
      const v = vals as any;
      endpointRows.push({
        endpoint: epName,
        avgMs: Math.round(v.avg),
        medMs: Math.round(v.med),
        p90Ms: Math.round(v['p(90)']),
        p95Ms: Math.round(v['p(95)']),
        maxMs: Math.round(v.max)
      });
    }
  }
  if (endpointRows.length > 0) {
    console.table(endpointRows);
  }
}

// Write compiled data to tests/load/results/compiled-summary.json
fs.writeFileSync(
  path.join(dir, 'compiled-summary.json'),
  JSON.stringify({ overview: rows, endpoints: customMetrics }, null, 2),
  'utf-8'
);
console.log('\n✓ Saved compiled summary to tests/load/results/compiled-summary.json');
