import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

// Custom metrics
const sellerLoginDuration = new Trend('seller_login_duration', true);
const sellerOrdersPage1Duration = new Trend('seller_orders_p1_duration', true);
const sellerOrdersPage2Duration = new Trend('seller_orders_p2_duration', true);
const p2024Errors = new Counter('p2024_connection_errors');

const testData = JSON.parse(open('./test-data.json'));
const BASE_URL = __ENV.TARGET_URL || 'https://ktng-order-system.vercel.app';

export default function () {
  const seller = testData.seller;
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'k6-load-tester/1.0',
  };

  // 1. Seller Login
  const loginRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: seller.email,
    password: seller.password,
  }), { headers });
  sellerLoginDuration.add(loginRes.timings.duration);

  check(loginRes, {
    'seller login is 200': (r) => r.status === 200,
  });

  // 2. Fetch Orders Page 1
  const p1Res = http.get(`${BASE_URL}/api/orders?page=1&pageSize=25`);
  sellerOrdersPage1Duration.add(p1Res.timings.duration);
  check(p1Res, {
    'orders page 1 is 200': (r) => r.status === 200,
  });

  // 3. Fetch Orders Page 2
  const p2Res = http.get(`${BASE_URL}/api/orders?page=2&pageSize=25`);
  sellerOrdersPage2Duration.add(p2Res.timings.duration);
  check(p2Res, {
    'orders page 2 is 200': (r) => r.status === 200,
  });

  sleep(1);
}
