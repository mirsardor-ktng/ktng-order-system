import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// Custom metrics
const loginDuration = new Trend('login_duration', true);
const orderCreateDuration = new Trend('order_create_duration', true);
const p2024Errors = new Counter('p2024_connection_errors');
const orderFailedErrors = new Counter('order_failed_errors');
const successfulOrders = new Rate('successful_orders');

// Load test user data
const testData = JSON.parse(open('./test-data.json'));

const BASE_URL = __ENV.TARGET_URL || 'https://ktng-order-system.vercel.app';

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    'successful_orders': ['rate>0.85'],
    'p2024_connection_errors': ['count==0'],
  },
};

// VU-scoped state
let isAuthenticated = false;

export default function () {
  const userIdx = ((__VU - 1) % testData.customers.length);
  const user = testData.customers[userIdx];
  const prod = testData.products[0];

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'k6-load-tester/1.0',
  };

  // 1. Login once per VU session
  if (!isAuthenticated) {
    const loginPayload = JSON.stringify({
      email: user.email,
      password: user.password,
    });

    const loginRes = http.post(`${BASE_URL}/api/auth/login`, loginPayload, { headers });
    loginDuration.add(loginRes.timings.duration);

    const loginOk = check(loginRes, {
      'login status is 200': (r) => r.status === 200,
    });

    if (!loginOk) {
      orderFailedErrors.add(1);
      successfulOrders.add(false);
      sleep(1);
      return;
    }
    isAuthenticated = true;
  }

  // 2. Submit Order
  const orderPayload = JSON.stringify({
    items: [
      {
        productId: prod.id,
        quantityPacks: 10,
      },
    ],
    status: 'NEW',
  });

  const orderRes = http.post(`${BASE_URL}/api/orders`, orderPayload, { headers });
  orderCreateDuration.add(orderRes.timings.duration);

  if (orderRes.status === 401) {
    isAuthenticated = false; // Re-login next iteration
  }

  let isP2024 = false;
  if (orderRes.body && (orderRes.body.includes('P2024') || orderRes.body.includes('Timed out fetching a new connection'))) {
    p2024Errors.add(1);
    isP2024 = true;
  }

  const orderOk = check(orderRes, {
    'order create status is 200': (r) => r.status === 200,
    'order has orderNumber': (r) => r.body && r.body.includes('ORD-'),
    'no P2024 error': () => !isP2024,
  });

  if (orderOk) {
    successfulOrders.add(true);
  } else {
    orderFailedErrors.add(1);
    successfulOrders.add(false);
  }

  // Realistic human pause before next order (2 to 4 seconds)
  sleep(2 + Math.random() * 2);
}
