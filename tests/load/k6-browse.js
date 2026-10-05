import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// Custom metrics
const loginDuration = new Trend('login_duration', true);
const authMeDuration = new Trend('auth_me_duration', true);
const productsDuration = new Trend('products_duration', true);
const calcConfigDuration = new Trend('calc_config_duration', true);
const ordersHistoryDuration = new Trend('orders_history_duration', true);
const p2024Errors = new Counter('p2024_connection_errors');
const server500Errors = new Counter('server_500_errors');
const successfulJourneys = new Rate('successful_journeys');

// Load test user data
const testData = JSON.parse(open('./test-data.json'));

const BASE_URL = __ENV.TARGET_URL || 'https://ktng-order-system.vercel.app';

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    'successful_journeys': ['rate>0.90'],
    'p2024_connection_errors': ['count==0'],
  },
};

// VU-scoped state
let isAuthenticated = false;

export default function () {
  const userIdx = ((__VU - 1) % testData.customers.length);
  const user = testData.customers[userIdx];
  let journeySuccess = true;

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'k6-load-tester/1.0',
  };

  // 1. Authenticate if not already authenticated in this VU
  if (!isAuthenticated) {
    const loginPayload = JSON.stringify({
      email: user.email,
      password: user.password,
    });

    const loginRes = http.post(`${BASE_URL}/api/auth/login`, loginPayload, { headers });
    loginDuration.add(loginRes.timings.duration);

    const loginCheck = check(loginRes, {
      'login status is 200': (r) => r.status === 200,
    });

    if (!loginCheck) {
      journeySuccess = false;
      if (loginRes.status >= 500) server500Errors.add(1);
      if (loginRes.body && (loginRes.body.includes('P2024') || loginRes.body.includes('Timed out fetching a new connection'))) {
        p2024Errors.add(1);
      }
      successfulJourneys.add(false);
      sleep(1);
      return;
    }
    isAuthenticated = true;
  }

  // 2. GET /api/auth/me
  const meRes = http.get(`${BASE_URL}/api/auth/me`);
  authMeDuration.add(meRes.timings.duration);
  if (meRes.status === 401) {
    isAuthenticated = false; // Re-login next iteration
  }
  const meCheck = check(meRes, {
    'auth/me status is 200': (r) => r.status === 200,
  });
  if (!meCheck) {
    journeySuccess = false;
    if (meRes.status >= 500) server500Errors.add(1);
    if (meRes.body && (meRes.body.includes('P2024') || meRes.body.includes('Timed out fetching a new connection'))) {
      p2024Errors.add(1);
    }
  }

  // 3. GET /api/products
  const prodRes = http.get(`${BASE_URL}/api/products`);
  productsDuration.add(prodRes.timings.duration);
  const prodCheck = check(prodRes, {
    'products status is 200': (r) => r.status === 200,
    'products has data': (r) => r.body && r.body.length > 50,
  });
  if (!prodCheck) {
    journeySuccess = false;
    if (prodRes.status >= 500) server500Errors.add(1);
    if (prodRes.body && (prodRes.body.includes('P2024') || prodRes.body.includes('Timed out fetching a new connection'))) {
      p2024Errors.add(1);
    }
  }

  // 4. GET /api/orders/calculation-config
  const configRes = http.get(`${BASE_URL}/api/orders/calculation-config`);
  calcConfigDuration.add(configRes.timings.duration);
  const configCheck = check(configRes, {
    'calc-config status is 200': (r) => r.status === 200,
    'calc-config has products': (r) => r.body && r.body.includes('products'),
  });
  if (!configCheck) {
    journeySuccess = false;
    if (configRes.status >= 500) server500Errors.add(1);
    if (configRes.body && (configRes.body.includes('P2024') || configRes.body.includes('Timed out fetching a new connection'))) {
      p2024Errors.add(1);
    }
  }

  // 5. GET /api/orders?page=1&pageSize=25 (Customer orders history)
  const ordersRes = http.get(`${BASE_URL}/api/orders?page=1&pageSize=25`);
  ordersHistoryDuration.add(ordersRes.timings.duration);
  const ordersCheck = check(ordersRes, {
    'orders status is 200': (r) => r.status === 200,
  });
  if (!ordersCheck) {
    journeySuccess = false;
    if (ordersRes.status >= 500) server500Errors.add(1);
    if (ordersRes.body && (ordersRes.body.includes('P2024') || ordersRes.body.includes('Timed out fetching a new connection'))) {
      p2024Errors.add(1);
    }
  }

  successfulJourneys.add(journeySuccess);

  // Think time simulating human browsing (1.5s to 3s)
  sleep(1.5 + Math.random() * 1.5);
}
