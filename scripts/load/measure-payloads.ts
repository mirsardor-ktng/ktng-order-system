import prisma from '../../src/lib/db';
import { signToken } from '../../src/lib/auth';

async function main() {
  const user = await prisma.user.findFirst({ where: { email: 'loadtest-user-001@ktng-test.local' } });
  if (!user) {
    console.error('User not found');
    return;
  }

  const token = signToken({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: 'CUSTOMER',
    permissions: ['orders:view_own', 'orders:create', 'products:read', 'promotions:read'],
    companyId: user.companyId || undefined
  });

  const endpoints = [
    { method: 'GET', url: '/api/auth/me' },
    { method: 'GET', url: '/api/products' },
    { method: 'GET', url: '/api/orders/calculation-config' },
    { method: 'GET', url: '/api/orders?page=1&pageSize=25' }
  ];

  console.log('--- Measuring Payload Sizes (Vercel Production) ---');
  for (const ep of endpoints) {
    const t0 = performance.now();
    const res = await fetch(`https://ktng-order-system.vercel.app${ep.url}`, {
      method: ep.method,
      headers: {
        'Cookie': `b2b_auth_token=${token}`
      }
    });
    const elapsed = Math.round(performance.now() - t0);
    const text = await res.text();
    const bytes = Buffer.byteLength(text, 'utf-8');
    const kb = (bytes / 1024).toFixed(2);
    console.log(`${ep.method} ${ep.url}: Status ${res.status}, Size: ${bytes} bytes (${kb} KB), Latency: ${elapsed}ms`);
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
