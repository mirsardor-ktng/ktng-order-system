import prisma from '../src/lib/db';
import { NextRequest } from 'next/server';
import { PUT as updateProductsRoute } from '../src/app/api/admin/products/route';
import { signToken } from '../src/lib/auth';

async function main() {
  console.log('=== STARTING PRODUCT TAGS & BULK ASSIGNMENT TEST SUITE ===\n');

  const ts = Date.now();

  // 1. Setup test tags
  const tagA = await prisma.tag.create({
    data: { name: `Tag-A-${ts}`, color: '#3b82f6' }
  });
  const tagB = await prisma.tag.create({
    data: { name: `Tag-B-${ts}`, color: '#10b981' }
  });

  // 2. Setup 5 test products
  const products: any[] = [];
  for (let i = 1; i <= 5; i++) {
    const p = await prisma.product.create({
      data: {
        sku: `SKU-TAG-${ts}-${i}`,
        name: `Tag Test Product ${ts} ${i}`,
        basePrice: 10000 * i,
        stockPacks: 100,
        imageUrl: 'default-pack',
        isActive: true
      }
    });
    products.push(p);
  }
  const productIds = products.map(p => p.id);

  // 3. Setup test users:
  // User 1: Tag Manager (has tags:manage only)
  const tagManagerUser = await prisma.user.create({
    data: {
      email: `tagmgr_${ts}@example.com`,
      name: 'Tag Manager',
      passwordHash: 'dummy',
      role: 'CUSTOMER'
    }
  });

  // User 2: Unauthorized User (no product or tag permissions)
  const unauthCustomer = await prisma.user.create({
    data: {
      email: `unauth_${ts}@example.com`,
      name: 'Unauth Customer',
      passwordHash: 'dummy',
      role: 'CUSTOMER'
    }
  });

  const tagManagerToken = signToken({
    userId: tagManagerUser.id,
    email: tagManagerUser.email,
    name: tagManagerUser.name,
    role: 'CUSTOMER',
    permissions: ['tags:manage']
  });

  const unauthToken = signToken({
    userId: unauthCustomer.id,
    email: unauthCustomer.email,
    name: unauthCustomer.name,
    role: 'CUSTOMER',
    permissions: ['orders:view_own']
  });

  try {
    // -------------------------------------------------------------
    // Test 1: Bulk Tag Assignment via tags:manage permission
    // -------------------------------------------------------------
    console.log('[Test 1] Testing bulk tag assignment with tags:manage permission...');

    const req1 = new NextRequest('http://localhost:3000/api/admin/products', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        cookie: `b2b_auth_token=${tagManagerToken}`
      },
      body: JSON.stringify({
        ids: productIds,
        tagIds: [tagA.id, tagB.id]
      })
    });

    const res1 = await updateProductsRoute(req1);
    const data1 = await res1.json();

    if (res1.status !== 200 || !data1.success) {
      throw new Error(`Bulk tag assignment failed with status ${res1.status}: ${JSON.stringify(data1)}`);
    }

    // Verify all 5 products now have both tags
    const productsAfter1 = await prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { tags: true }
    });

    for (const p of productsAfter1) {
      const assignedTagIds = p.tags.map(t => t.id);
      if (!assignedTagIds.includes(tagA.id) || !assignedTagIds.includes(tagB.id)) {
        throw new Error(`Product ${p.sku} missing assigned tags: ${assignedTagIds}`);
      }
    }
    console.log(`✓ Successfully assigned 2 tags to all ${productIds.length} products concurrently`);

    // -------------------------------------------------------------
    // Test 2: Tag Validation (Non-existent Tag ID returns 400 Bad Request)
    // -------------------------------------------------------------
    console.log('\n[Test 2] Testing tag validation with invalid / non-existent tag ID...');
    const fakeTagId = 'non-existent-tag-id-12345';
    const req2 = new NextRequest('http://localhost:3000/api/admin/products', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        cookie: `b2b_auth_token=${tagManagerToken}`
      },
      body: JSON.stringify({
        ids: productIds,
        tagIds: [tagA.id, fakeTagId]
      })
    });

    const res2 = await updateProductsRoute(req2);
    const data2 = await res2.json();

    if (res2.status !== 400 || !data2.error || !data2.error.includes('Указанные теги не найдены')) {
      throw new Error(`Expected 400 Bad Request with missing tag message, got status ${res2.status}: ${JSON.stringify(data2)}`);
    }

    const productsAfter2 = await prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { tags: true }
    });

    for (const p of productsAfter2) {
      const assignedTagIds = p.tags.map(t => t.id);
      // Still has tagA and tagB from Test 1, because operation was aborted
      if (!assignedTagIds.includes(tagA.id) || !assignedTagIds.includes(tagB.id)) {
        throw new Error(`Product ${p.sku} was unexpectedly modified: ${assignedTagIds}`);
      }
    }
    console.log('✓ Invalid tag ID correctly rejected with 400 Bad Request and zero product modifications');

    // -------------------------------------------------------------
    // Test 3: Clearing tags in bulk
    // -------------------------------------------------------------
    console.log('\n[Test 3] Testing clearing tags in bulk...');
    const req3 = new NextRequest('http://localhost:3000/api/admin/products', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        cookie: `b2b_auth_token=${tagManagerToken}`
      },
      body: JSON.stringify({
        ids: productIds,
        tagIds: []
      })
    });

    const res3 = await updateProductsRoute(req3);
    const data3 = await res3.json();

    if (res3.status !== 200 || !data3.success) {
      throw new Error(`Clearing tags failed: ${JSON.stringify(data3)}`);
    }

    const productsAfter3 = await prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { tags: true }
    });

    for (const p of productsAfter3) {
      if (p.tags.length !== 0) {
        throw new Error(`Product ${p.sku} still has tags: ${p.tags.length}`);
      }
    }
    console.log('✓ Tags successfully cleared in bulk from all products');

    // -------------------------------------------------------------
    // Test 4: Permission Enforcement
    // -------------------------------------------------------------
    console.log('\n[Test 4] Testing permission enforcement...');
    // Unauthorized user attempts tag update
    const reqUnauth = new NextRequest('http://localhost:3000/api/admin/products', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        cookie: `b2b_auth_token=${unauthToken}`
      },
      body: JSON.stringify({
        ids: productIds,
        tagIds: [tagA.id]
      })
    });

    const resUnauth = await updateProductsRoute(reqUnauth);
    if (resUnauth.status !== 403) {
      throw new Error(`Expected 403 for unauthorized user, got ${resUnauth.status}`);
    }
    console.log('✓ Unauthorized user correctly blocked with 403 Forbidden');

    // Tag manager attempts to modify price (restricted to products:manage)
    const reqPriceBreach = new NextRequest('http://localhost:3000/api/admin/products', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        cookie: `b2b_auth_token=${tagManagerToken}`
      },
      body: JSON.stringify({
        id: productIds[0],
        basePrice: 99999
      })
    });

    const resPriceBreach = await updateProductsRoute(reqPriceBreach);
    if (resPriceBreach.status !== 403) {
      throw new Error(`Expected 403 when tag manager modifies price, got ${resPriceBreach.status}`);
    }
    console.log('✓ Tag manager blocked with 403 from modifying product pricing');

    console.log('\n=== ALL PRODUCT TAG TESTS PASSED! ===');
  } finally {
    // Cleanup
    await prisma.product.deleteMany({ where: { id: { in: productIds } } }).catch(() => {});
    await prisma.tag.deleteMany({ where: { id: { in: [tagA.id, tagB.id] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [tagManagerUser.id, unauthCustomer.id] } } }).catch(() => {});
  }
}

main().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
