import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { spawnSync, execSync } from 'child_process';
import prisma from '../../src/lib/db';

const K6_BIN = 'C:\\Program Files\\k6\\k6.exe';

interface Stats {
  count: number;
  successCount: number;
  failCount: number;
  successRate: string;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

function computeStats(arr: number[]): Stats {
  if (arr.length === 0) {
    return { count: 0, successCount: 0, failCount: 0, successRate: '0%', min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
  }
  const sorted = [...arr].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    successCount: sorted.length,
    failCount: 0,
    successRate: '100.0%',
    min: Number(sorted[0].toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
    avg: Number((sum / sorted.length).toFixed(2)),
    p50: Number(sorted[Math.floor(sorted.length * 0.50)].toFixed(2)),
    p90: Number(sorted[Math.floor(sorted.length * 0.90)].toFixed(2)),
    p95: Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(2)),
    p99: Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))].toFixed(2)),
  };
}

async function requestUrl(url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; duration: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const reqHeaders = { ...options.headers };
    if (options.body) {
      reqHeaders['Content-Length'] = Buffer.byteLength(options.body).toString();
      if (!reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
    }

    const t0 = performance.now();
    const req = lib.request(url, {
      method: options.method || 'GET',
      headers: reqHeaders,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const duration = performance.now() - t0;
        const respHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (Array.isArray(v)) respHeaders[k.toLowerCase()] = v.join('; ');
          else if (v) respHeaders[k.toLowerCase()] = v;
        }
        resolve({
          status: res.statusCode || 0,
          duration: Number(duration.toFixed(2)),
          body: data,
          headers: respHeaders
        });
      });
    });

    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

export async function runBenchmarkSuite(targetUrl: string, regionTag: string) {
  console.log(`======================================================================`);
  console.log(`=== STARTING PHASE 13C-A BENCHMARK FOR REGION: ${regionTag} ===`);
  console.log(`=== Target URL: ${targetUrl} ===`);
  console.log(`======================================================================\n`);

  const resultsDir = path.resolve(__dirname, `results-13c/${regionTag}`);
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const testData = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'test-data.json'), 'utf-8'));
  const testCustomer = testData.customers[0];

  // 1. Initial login to acquire session cookie
  console.log('--- 1. Authenticating test user ---');
  const loginRes = await requestUrl(`${targetUrl}/api/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email: testCustomer.email, password: testCustomer.password })
  });

  const rawCookie = loginRes.headers['set-cookie'] || '';
  const authToken = rawCookie.split(';')[0];
  const authHeaders = { Cookie: authToken };

  console.log(`Login status: ${loginRes.status} | Duration: ${loginRes.duration}ms`);
  console.log(`X-Vercel-Id: ${loginRes.headers['x-vercel-id'] || 'None'}`);

  // 2. Warm-up Phase (Section 8)
  console.log('\n--- 2. Executing Warm-up Phase (10 requests per endpoint, discarded) ---');
  for (let i = 0; i < 10; i++) {
    await requestUrl(`${targetUrl}/api/products`, { headers: authHeaders });
    await requestUrl(`${targetUrl}/api/orders/calculation-config`, { headers: authHeaders });
    await requestUrl(`${targetUrl}/api/orders?page=1&pageSize=25`, { headers: authHeaders });
  }
  console.log('✓ Warm-up completed.');

  // 3. Warm Single-User Benchmark (Section 10 - 100 requests each)
  console.log('\n--- 3. Warm Single-User Benchmark (100 sequential requests each) ---');
  
  // Test 1: GET /api/products
  console.log('Executing 100 requests: GET /api/products...');
  const prodTimes: number[] = [];
  let prodFails = 0;
  for (let i = 0; i < 100; i++) {
    const res = await requestUrl(`${targetUrl}/api/products`, { headers: authHeaders });
    if (res.status === 200) prodTimes.push(res.duration);
    else prodFails++;
  }
  const prodStats = computeStats(prodTimes);
  prodStats.failCount = prodFails;
  prodStats.successRate = `${((prodStats.successCount / 100) * 100).toFixed(1)}%`;

  // Test 2: GET /api/orders/calculation-config
  console.log('Executing 100 requests: GET /api/orders/calculation-config...');
  const calcTimes: number[] = [];
  let calcFails = 0;
  for (let i = 0; i < 100; i++) {
    const res = await requestUrl(`${targetUrl}/api/orders/calculation-config`, { headers: authHeaders });
    if (res.status === 200) calcTimes.push(res.duration);
    else calcFails++;
  }
  const calcStats = computeStats(calcTimes);
  calcStats.failCount = calcFails;
  calcStats.successRate = `${((calcStats.successCount / 100) * 100).toFixed(1)}%`;

  // Test 3: GET /api/orders?page=1&pageSize=25
  console.log('Executing 100 requests: GET /api/orders?page=1&pageSize=25...');
  const ordersTimes: number[] = [];
  let ordersFails = 0;
  for (let i = 0; i < 100; i++) {
    const res = await requestUrl(`${targetUrl}/api/orders?page=1&pageSize=25`, { headers: authHeaders });
    if (res.status === 200) ordersTimes.push(res.duration);
    else ordersFails++;
  }
  const ordersStats = computeStats(ordersTimes);
  ordersStats.failCount = ordersFails;
  ordersStats.successRate = `${((ordersStats.successCount / 100) * 100).toFixed(1)}%`;

  const warmResults = {
    products: prodStats,
    calcConfig: calcStats,
    ordersHistory: ordersStats
  };

  fs.writeFileSync(path.join(resultsDir, 'warm-single-user.json'), JSON.stringify(warmResults, null, 2), 'utf-8');
  console.log('\n--- Warm Single-User Benchmark Summary ---');
  console.table([
    { endpoint: 'GET /api/products', ...prodStats },
    { endpoint: 'GET /api/orders/calculation-config', ...calcStats },
    { endpoint: 'GET /api/orders?page=1&pageSize=25', ...ordersStats },
  ]);

  // 4. Customer Browsing Concurrency Benchmark (Section 11)
  console.log('\n--- 4. Customer Browsing Concurrency Benchmark (1, 5, 10, 20, 30 VU) ---');
  const browsingTiers = [1, 5, 10, 20, 30];
  const browsingResults: any[] = [];

  for (const vus of browsingTiers) {
    const testName = `browse_${vus}vu`;
    console.log(`Running k6 browsing test: ${vus} VU (25s)...`);
    const summaryExportPath = path.join(resultsDir, `${testName}.json`);
    const logExportPath = path.join(resultsDir, `${testName}.log`);

    const args = [
      'run',
      '--vus', String(vus),
      '--duration', '25s',
      '--summary-trend-stats', 'avg,min,med,max,p(90),p(95),p(99)',
      '--summary-export', summaryExportPath,
      path.resolve(__dirname, 'k6-browse.js')
    ];

    const k6Res = spawnSync(K6_BIN, args, {
      cwd: path.resolve(__dirname),
      encoding: 'utf-8',
      stdio: 'pipe',
      env: { ...process.env, TARGET_URL: targetUrl }
    });

    fs.writeFileSync(logExportPath, (k6Res.stdout || '') + '\n' + (k6Res.stderr || ''), 'utf-8');

    if (fs.existsSync(summaryExportPath)) {
      const summary = JSON.parse(fs.readFileSync(summaryExportPath, 'utf-8'));
      const m = summary.metrics || {};
      const httpDur = m.http_req_duration || {};
      const reqs = m.http_reqs?.count || 0;
      const fails = m.http_req_failed?.passes || 0;
      const p2024 = m.p2024_connection_errors?.count || 0;
      browsingResults.push({
        vus,
        reqs,
        fails,
        successRate: `${(((reqs - fails) / (reqs || 1)) * 100).toFixed(1)}%`,
        p2024,
        avgMs: Math.round(httpDur.avg || 0),
        medMs: Math.round(httpDur.med || 0),
        p90Ms: Math.round(httpDur['p(90)'] || 0),
        p95Ms: Math.round(httpDur['p(95)'] || 0),
        p99Ms: Math.round(httpDur['p(99)'] || 0),
        maxMs: Math.round(httpDur.max || 0)
      });
    }

    spawnSync('powershell', ['-Command', 'Start-Sleep -Seconds 2']);
  }

  fs.writeFileSync(path.join(resultsDir, 'browsing-concurrency.json'), JSON.stringify(browsingResults, null, 2), 'utf-8');
  console.log('\n--- Browsing Concurrency Summary Table ---');
  console.table(browsingResults);

  // 5. Order Creation Concurrency Benchmark (Section 12 & 13)
  console.log('\n--- 5. Order Creation Concurrency Benchmark (1, 5, 10, 20 concurrent orders) ---');
  const orderTiers = [1, 5, 10, 20];
  const orderResults: any[] = [];

  for (const vus of orderTiers) {
    // Record initial stock
    const pBefore = await prisma.product.findUnique({ where: { sku: 'LOADTEST-SKU-1' } });
    const stockBefore = pBefore?.stockPacks || 0;

    const testName = `orders_${vus}vu`;
    console.log(`Running k6 order creation: ${vus} VU (20s)...`);
    const summaryExportPath = path.join(resultsDir, `${testName}.json`);
    const logExportPath = path.join(resultsDir, `${testName}.log`);

    const args = [
      'run',
      '--vus', String(vus),
      '--duration', '20s',
      '--summary-trend-stats', 'avg,min,med,max,p(90),p(95),p(99)',
      '--summary-export', summaryExportPath,
      path.resolve(__dirname, 'k6-orders.js')
    ];

    const k6Res = spawnSync(K6_BIN, args, {
      cwd: path.resolve(__dirname),
      encoding: 'utf-8',
      stdio: 'pipe',
      env: { ...process.env, TARGET_URL: targetUrl }
    });

    fs.writeFileSync(logExportPath, (k6Res.stdout || '') + '\n' + (k6Res.stderr || ''), 'utf-8');

    let tierResult: any = { vus };
    if (fs.existsSync(summaryExportPath)) {
      const summary = JSON.parse(fs.readFileSync(summaryExportPath, 'utf-8'));
      const m = summary.metrics || {};
      const orderDur = m.order_create_duration || m.http_req_duration || {};
      const reqs = m.order_create_duration?.count || m.http_reqs?.count || 0;
      const fails = m.order_failed_errors?.count || 0;
      const p2024 = m.p2024_connection_errors?.count || 0;
      tierResult = {
        vus,
        reqs,
        fails,
        successRate: `${(((reqs - fails) / (reqs || 1)) * 100).toFixed(1)}%`,
        p2024,
        avgMs: Math.round(orderDur.avg || 0),
        medMs: Math.round(orderDur.med || 0),
        p90Ms: Math.round(orderDur['p(90)'] || 0),
        p95Ms: Math.round(orderDur['p(95)'] || 0),
        p99Ms: Math.round(orderDur['p(99)'] || 0),
        maxMs: Math.round(orderDur.max || 0)
      };
      orderResults.push(tierResult);
    }

    // Verify stock deduction and reconcile
    const pAfter = await prisma.product.findUnique({ where: { sku: 'LOADTEST-SKU-1' } });
    const stockAfter = pAfter?.stockPacks || 0;
    const actualDeduction = stockBefore - stockAfter;

    const company = await prisma.company.findUnique({ where: { code: 'LOADTEST' } });
    const createdOrders = await prisma.order.findMany({
      where: { companyId: company!.id },
      include: { items: true }
    });

    let expectedDeduction = 0;
    for (const ord of createdOrders) {
      for (const item of ord.items) {
        if (item.productId === pBefore?.id) expectedDeduction += item.quantityPacks;
      }
    }

    const reconciled = expectedDeduction === actualDeduction;
    console.log(`  Stock before: ${stockBefore} | Deducted: ${actualDeduction} | Expected: ${expectedDeduction} | Reconciled: ${reconciled ? 'YES ✓' : 'NO ✗'}`);

    if (!reconciled) {
      throw new Error(`Stock mismatch at tier ${vus}! Expected ${expectedDeduction}, actual ${actualDeduction}`);
    }

    // Cleanup orders and restore stock
    execSync('npx tsx scripts/load/cleanup-test-data.ts', { stdio: 'pipe' });
    spawnSync('powershell', ['-Command', 'Start-Sleep -Seconds 2']);
  }

  fs.writeFileSync(path.join(resultsDir, 'orders-concurrency.json'), JSON.stringify(orderResults, null, 2), 'utf-8');
  console.log('\n--- Orders Concurrency Summary Table ---');
  console.table(orderResults);

  console.log(`\n======================================================================`);
  console.log(`=== PHASE 13C-A BENCHMARK COMPLETED FOR ${regionTag} ===`);
  console.log(`======================================================================\n`);
}

if (require.main === module) {
  const targetUrl = process.argv[2] || process.env.TARGET_URL || 'https://ktng-order-system.vercel.app';
  const regionTag = process.argv[3] || process.env.REGION_TAG || 'region_a';

  runBenchmarkSuite(targetUrl, regionTag)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Benchmark suite error:', err);
      process.exit(1);
    });
}
