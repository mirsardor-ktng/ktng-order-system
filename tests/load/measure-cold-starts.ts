import https from 'https';
import fs from 'fs';
import path from 'path';

async function requestUrl(url: string, headers: Record<string, string> = {}): Promise<{ status: number; duration: number; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = https.request(url, { headers }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
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
          headers: respHeaders
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function loginUser(baseUrl: string) {
  return new Promise<string>((resolve, reject) => {
    const testData = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'test-data.json'), 'utf-8'));
    const user = testData.customers[0];
    const payload = JSON.stringify({ email: user.email, password: user.password });
    const req = https.request(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let b = '';
      res.on('data', chunk => { b += chunk; });
      res.on('end', () => {
        const cookie = (res.headers['set-cookie'] || [])[0] || '';
        resolve(cookie.split(';')[0]);
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const targetUrl = process.argv[2] || 'https://ktng-order-system.vercel.app';
  const regionTag = process.argv[3] || 'region_a';
  const outDir = path.resolve(__dirname, `results-13c/${regionTag}`);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log(`=== MEASURING COLD START SAMPLES FOR: ${regionTag} ===`);
  console.log(`Target: ${targetUrl}\n`);

  const token = await loginUser(targetUrl);
  const authHeaders = { Cookie: token };

  const endpoints = [
    { name: '/api/products', url: `${targetUrl}/api/products`, headers: authHeaders },
    { name: '/api/orders/calculation-config', url: `${targetUrl}/api/orders/calculation-config`, headers: authHeaders },
    { name: '/api/orders?page=1&pageSize=25', url: `${targetUrl}/api/orders?page=1&pageSize=25`, headers: authHeaders },
  ];

  const results: Record<string, number[]> = {
    '/api/products': [],
    '/api/orders/calculation-config': [],
    '/api/orders?page=1&pageSize=25': []
  };

  // Run 5 samples with 3s pause between iterations
  for (let sample = 1; sample <= 5; sample++) {
    console.log(`Sample ${sample}/5:`);
    for (const ep of endpoints) {
      const res = await requestUrl(ep.url, ep.headers);
      console.log(`  ${ep.name}: ${res.duration}ms (status: ${res.status}, x-vercel-id: ${res.headers['x-vercel-id'] || 'none'})`);
      results[ep.name].push(res.duration);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  const summary = endpoints.map(ep => {
    const arr = results[ep.name];
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return {
      endpoint: ep.name,
      sample1: arr[0],
      sample2: arr[1],
      sample3: arr[2],
      sample4: arr[3],
      sample5: arr[4],
      avgMs: Number(avg.toFixed(2)),
      p50Ms: arr.sort((a,b)=>a-b)[2]
    };
  });

  console.log('\n--- Cold Start Summary ---');
  console.table(summary);

  fs.writeFileSync(path.join(outDir, 'cold-start.json'), JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`\n✓ Saved to ${path.join(outDir, 'cold-start.json')}`);
}

main().catch(console.error);
