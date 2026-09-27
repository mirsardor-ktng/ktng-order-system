import prisma from '../src/lib/db';
import {
  signToken,
  verifyToken,
  validateSessionVersion,
  updateCachedSessionVersion,
  invalidateCachedSessionVersion,
  SessionExpiredError
} from '../src/lib/auth';
import { OrdersService } from '../src/lib/orders/orders.service';

async function main() {
  console.log('--- STARTING PHASE 4 TEST SUITE ---');

  // ==========================================
  // PART A: Single Active Session per Account
  // ==========================================
  console.log('\n[Part A - Test 1] Testing User.sessionVersion & In-memory cache...');
  
  // Find or create a test user
  const testEmail = `phase4_test_user_${Date.now()}@example.com`;
  const testUser = await prisma.user.create({
    data: {
      email: testEmail,
      name: 'Phase 4 Test User',
      passwordHash: 'hashed_password_placeholder',
      role: 'CUSTOMER',
      sessionVersion: 1
    }
  });

  try {
    console.log(`Created test user ${testUser.id} with sessionVersion = ${testUser.sessionVersion}`);
    if (testUser.sessionVersion !== 1) {
      throw new Error(`Expected sessionVersion 1, got ${testUser.sessionVersion}`);
    }

    // Device A logs in
    const updatedUserDevA = await prisma.user.update({
      where: { id: testUser.id },
      data: { sessionVersion: { increment: 1 } },
      select: { id: true, sessionVersion: true }
    });
    updateCachedSessionVersion(updatedUserDevA.id, updatedUserDevA.sessionVersion);
    const tokenPayloadA = {
      userId: testUser.id,
      email: testUser.email,
      role: 'CUSTOMER',
      roleName: 'Клиент',
      permissions: ['orders:view'],
      sessionVersion: updatedUserDevA.sessionVersion
    };
    const tokenA = signToken(tokenPayloadA);
    const decodedA = verifyToken(tokenA);
    console.log(`Device A logged in with sessionVersion = ${decodedA?.sessionVersion}`);

    // Validate Device A session
    const isDevAValidInitial = await validateSessionVersion(decodedA);
    if (!isDevAValidInitial) {
      throw new Error('Device A session should be valid immediately after login');
    }
    console.log('✓ Device A session is active and valid');

    // Device B logs in (new login has priority)
    const updatedUserDevB = await prisma.user.update({
      where: { id: testUser.id },
      data: { sessionVersion: { increment: 1 } },
      select: { id: true, sessionVersion: true }
    });
    updateCachedSessionVersion(updatedUserDevB.id, updatedUserDevB.sessionVersion);
    const tokenPayloadB = {
      userId: testUser.id,
      email: testUser.email,
      role: 'CUSTOMER',
      roleName: 'Клиент',
      permissions: ['orders:view'],
      sessionVersion: updatedUserDevB.sessionVersion
    };
    const tokenB = signToken(tokenPayloadB);
    const decodedB = verifyToken(tokenB);
    console.log(`Device B logged in with sessionVersion = ${decodedB?.sessionVersion}`);

    // Check Device B is valid
    const isDevBValid = await validateSessionVersion(decodedB);
    if (!isDevBValid) {
      throw new Error('Device B session should be valid');
    }
    console.log('✓ Device B session is active and valid');

    // Check Device A is now INVALID
    const isDevAValidAfterB = await validateSessionVersion(decodedA);
    if (isDevAValidAfterB) {
      throw new Error('Device A session should be INVALID after Device B login');
    }
    console.log('✓ Device A session is successfully invalidated upon Device B login');

    // Test Cache Invalidation behavior (invalidate cache and verify direct DB fallback also invalidates Device A)
    invalidateCachedSessionVersion(testUser.id);
    const isDevAValidAfterCacheClear = await validateSessionVersion(decodedA);
    if (isDevAValidAfterCacheClear) {
      throw new Error('Device A session should still be invalid even on DB cache miss');
    }
    const isDevBValidAfterCacheClear = await validateSessionVersion(decodedB);
    if (!isDevBValidAfterCacheClear) {
      throw new Error('Device B session should be valid on DB cache miss');
    }
    console.log('✓ In-memory cache TTL / invalidation correctly checks DB and preserves single-session invariant');

    // ==========================================
    // PART B: Order Validation & Visibility Rules
    // ==========================================
    console.log('\n[Part B - Test 2] Testing Order Visibility & Validation permissions...');

    // Get an existing product
    const product = await prisma.product.findFirst();
    if (!product) throw new Error('No product found in DB for testing');

    const companyId = 'cmrw76d1m000c88hdazrxpcpx';

    // Create test customer session (Company AB)
    const customerSession = {
      userId: testUser.id,
      email: testUser.email,
      role: 'CUSTOMER',
      roleName: 'Клиент',
      permissions: ['orders:view'],
      companyId: companyId,
      sessionVersion: updatedUserDevB.sessionVersion
    };

    // Colleague of Customer in the SAME company
    const colleagueSession = {
      userId: 'colleague-user-id',
      email: 'colleague@example.com',
      role: 'CUSTOMER',
      roleName: 'Клиент',
      permissions: ['orders:view'],
      companyId: companyId,
      sessionVersion: 1
    };

    // Customer in ANOTHER company
    const otherCompanyCustomerSession = {
      userId: 'other-company-user-id',
      email: 'other@example.com',
      role: 'CUSTOMER',
      roleName: 'Клиент',
      permissions: ['orders:view'],
      companyId: 'different-company-id',
      sessionVersion: 1
    };

    // Create normal seller user in DB
    const normalSellerUser = await prisma.user.create({
      data: {
        email: `seller_normal_${Date.now()}@example.com`,
        name: 'Normal Seller',
        passwordHash: 'hash',
        role: 'SELLER',
        sessionVersion: 1
      }
    });

    // Create validator seller user in DB
    const validatorSellerUser = await prisma.user.create({
      data: {
        email: `seller_validator_${Date.now()}@example.com`,
        name: 'Validator Seller',
        passwordHash: 'hash',
        role: 'SELLER',
        sessionVersion: 1
      }
    });

    // Create normal seller session (has orders:view_all, but NOT orders:validation:view or orders:validation:accept)
    const normalSellerSession = {
      userId: normalSellerUser.id,
      email: normalSellerUser.email,
      role: 'SELLER',
      roleName: 'Менеджер продаж',
      permissions: ['orders:view_all', 'orders:export'],
      sessionVersion: 1
    };

    // Create validator seller session (has orders:validation:view and orders:validation:accept)
    const validatorSellerSession = {
      userId: validatorSellerUser.id,
      email: validatorSellerUser.email,
      role: 'SELLER',
      roleName: 'Валидатор заказов',
      permissions: ['orders:view_all', 'orders:validation:view', 'orders:validation:accept'],
      sessionVersion: 1
    };

    // Create Superadmin session
    const superadminSession = {
      userId: 'superadmin-test-id',
      email: 'superadmin@example.com',
      role: 'ADMIN',
      roleName: 'Суперадминистратор',
      permissions: ['*'],
      sessionVersion: 1
    };

    // Create an order in NEW status for Company AB
    const testOrder = await prisma.order.create({
      data: {
        orderNumber: `TEST-ORD-${Date.now()}`,
        status: 'NEW',
        customerId: testUser.id,
        companyId: companyId,
        totalPrice: 100000,
        totalPacks: 100,
        totalBlocks: 10,
        totalCases: 0.2,
        items: {
          create: [
            {
              productId: product.id,
              quantityPacks: 100,
              baseQuantityPacks: 100,
              totalQuantityPacks: 100,
              price: 1000,
              itemTotalPrice: 100000
            }
          ]
        }
      }
    });
    console.log(`Created test order ${testOrder.id} with status = NEW for company ${companyId}`);

    // Create a DRAFT order for testUser to test DRAFT isolation
    const testDraftOrder = await prisma.order.create({
      data: {
        orderNumber: `TEST-DRAFT-${Date.now()}`,
        status: 'DRAFT',
        customerId: testUser.id,
        companyId: companyId,
        totalPrice: 50000,
        totalPacks: 50,
        totalBlocks: 5,
        totalCases: 0.1
      }
    });

    // 1. canUserAccessOrder checks
    const custCanAccess = OrdersService.canUserAccessOrder(customerSession, testOrder);
    if (!custCanAccess) {
      throw new Error('Customer should be able to access their own NEW order');
    }
    console.log('✓ Customer can access their own NEW order');

    // Colleague in SAME company must be able to access NEW order
    const colleagueCanAccess = OrdersService.canUserAccessOrder(colleagueSession, testOrder);
    if (!colleagueCanAccess) {
      throw new Error('Colleague in the SAME company MUST be able to access NEW order!');
    }
    console.log('✓ Colleague in the same company CAN access NEW order (avoids duplicate orders)');

    // Customer in ANOTHER company must NOT be able to access NEW order
    const otherCustCanAccess = OrdersService.canUserAccessOrder(otherCompanyCustomerSession, testOrder);
    if (otherCustCanAccess) {
      throw new Error('Customer in another company MUST NOT access foreign NEW order!');
    }
    console.log('✓ Customer in another company CANNOT access foreign NEW order');

    // Colleague must NOT access colleague\'s private DRAFT
    const colleagueCanAccessDraft = OrdersService.canUserAccessOrder(colleagueSession, testDraftOrder);
    if (colleagueCanAccessDraft) {
      throw new Error('Colleague MUST NOT access another user\'s private DRAFT order');
    }
    console.log('✓ DRAFT order is strictly private to owner (Colleague access = false)');

    const normalSellerCanAccess = OrdersService.canUserAccessOrder(normalSellerSession, testOrder);
    if (normalSellerCanAccess) {
      throw new Error('Normal seller MUST NOT be able to access another company\'s NEW order');
    }
    console.log('✓ Normal seller CANNOT access foreign NEW order (canUserAccessOrder = false)');

    const validatorCanAccess = OrdersService.canUserAccessOrder(validatorSellerSession, testOrder);
    if (!validatorCanAccess) {
      throw new Error('Validator seller SHOULD be able to access NEW order');
    }
    console.log('✓ Validator seller can access NEW order');

    const superadminCanAccess = OrdersService.canUserAccessOrder(superadminSession, testOrder);
    if (!superadminCanAccess) {
      throw new Error('Superadmin SHOULD be able to access NEW order');
    }
    console.log('✓ Superadmin can access NEW order');

    // 2. getOrders query-level filtering
    const customerOrders = await OrdersService.getOrders(customerSession);
    const hasOrderCustomer = customerOrders.some(o => o.id === testOrder.id);
    if (!hasOrderCustomer) {
      throw new Error('getOrders for Customer should include their own NEW order');
    }
    console.log('✓ getOrders for Customer returns the NEW order');

    // Colleague in same company queries getOrders -> MUST see the NEW order
    const colleagueOrders = await OrdersService.getOrders(colleagueSession);
    const hasOrderColleague = colleagueOrders.some(o => o.id === testOrder.id);
    if (!hasOrderColleague) {
      throw new Error('getOrders for Colleague in SAME company MUST include NEW order!');
    }
    console.log('✓ getOrders for Colleague in SAME company returns the NEW order');

    // Colleague must NOT see DRAFT order in getOrders
    const hasDraftColleague = colleagueOrders.some(o => o.id === testDraftOrder.id);
    if (hasDraftColleague) {
      throw new Error('getOrders for Colleague MUST NOT include another user\'s DRAFT order!');
    }
    console.log('✓ getOrders for Colleague excludes another user\'s DRAFT order');

    // Customer in another company queries getOrders -> MUST NOT see the order
    const otherCompanyOrders = await OrdersService.getOrders(otherCompanyCustomerSession);
    const hasOrderOtherComp = otherCompanyOrders.some(o => o.id === testOrder.id);
    if (hasOrderOtherComp) {
      throw new Error('getOrders for Customer in ANOTHER company MUST NOT include foreign order!');
    }
    console.log('✓ getOrders for Customer in ANOTHER company excludes foreign order');

    const normalSellerOrders = await OrdersService.getOrders(normalSellerSession);
    const hasOrderNormalSeller = normalSellerOrders.some(o => o.id === testOrder.id);
    if (hasOrderNormalSeller) {
      throw new Error('getOrders for Normal seller MUST NOT include NEW order!');
    }
    console.log('✓ getOrders for Normal seller excludes NEW order at database query level');

    const validatorOrders = await OrdersService.getOrders(validatorSellerSession);
    const hasOrderValidator = validatorOrders.some(o => o.id === testOrder.id);
    if (!hasOrderValidator) {
      throw new Error('getOrders for Validator seller MUST include NEW order');
    }
    console.log('✓ getOrders for Validator seller includes NEW order');

    // 3. Accept order transition
    console.log('\n[Part B - Test 3] Testing atomic Order Acceptance & Concurrency...');

    // Attempt accept with normal seller (should fail because normal seller lacks orders:validation:accept)
    let normalSellerBlocked = false;
    try {
      await OrdersService.acceptOrder(normalSellerSession, testOrder.id);
    } catch (err: any) {
      normalSellerBlocked = true;
      console.log(`✓ Normal seller blocked from accepting: "${err.message}"`);
    }
    if (!normalSellerBlocked) {
      throw new Error('Normal seller should have been blocked from accepting order');
    }

    const { order: acceptedOrder } = await OrdersService.acceptOrder(validatorSellerSession, testOrder.id);

    if (acceptedOrder.status !== 'ACCEPTED') {
      throw new Error(`Expected order status to be ACCEPTED, got ${acceptedOrder.status}`);
    }
    console.log('✓ Order status successfully transitioned from NEW to ACCEPTED');

    // Verify AuditLog was recorded
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        action: 'ACCEPT_ORDER',
        userId: validatorSellerUser.id
      }
    });
    if (!auditLog || !auditLog.details.includes(testOrder.orderNumber)) {
      throw new Error('AuditLog entry with action ACCEPT_ORDER was not created');
    }
    console.log(`✓ AuditLog recorded: action=${auditLog.action}, details="${auditLog.details}"`);

    // Verify second accept call fails (order is already ACCEPTED, not NEW)
    let secondAcceptFailed = false;
    try {
      await OrdersService.acceptOrder(validatorSellerSession, testOrder.id);
    } catch (err: any) {
      secondAcceptFailed = true;
      console.log(`✓ Second accept call rejected as expected: "${err.message}"`);
    }
    if (!secondAcceptFailed) {
      throw new Error('Second accept call should have failed!');
    }

    // Verify that now normal seller CAN see the ACCEPTED order!
    const normalSellerOrdersAfterAccept = await OrdersService.getOrders(normalSellerSession);
    const hasOrderAfterAccept = normalSellerOrdersAfterAccept.some(o => o.id === testOrder.id);
    if (!hasOrderAfterAccept) {
      throw new Error('Normal seller SHOULD see order after it is ACCEPTED');
    }
    console.log('✓ Normal seller now sees the order after it was ACCEPTED');

    const normalSellerCanAccessAfter = OrdersService.canUserAccessOrder(normalSellerSession, acceptedOrder);
    if (!normalSellerCanAccessAfter) {
      throw new Error('Normal seller should now have access to ACCEPTED order');
    }
    console.log('✓ canUserAccessOrder is now TRUE for Normal seller');

    // 4. Concurrency Test for AcceptOrder
    console.log('\n[Part B - Test 4] Testing parallel race-condition atomic accept...');
    const concurrentOrder = await prisma.order.create({
      data: {
        orderNumber: `RACE-ORD-${Date.now()}`,
        status: 'NEW',
        customerId: testUser.id,
        totalPrice: 50000,
        totalPacks: 50,
        totalBlocks: 5,
        totalCases: 0.1
      }
    });

    // Fire 5 simultaneous accept calls
    const raceResults = await Promise.allSettled(
      Array.from({ length: 5 }, (_, idx) =>
        OrdersService.acceptOrder(validatorSellerSession, concurrentOrder.id)
      )
    );

    const fulfilled = raceResults.filter(r => r.status === 'fulfilled');
    const rejected = raceResults.filter(r => r.status === 'rejected');

    console.log(`Race test results: ${fulfilled.length} fulfilled, ${rejected.length} rejected`);
    if (fulfilled.length !== 1 || rejected.length !== 4) {
      throw new Error(`Expected exactly 1 accept to succeed and 4 to fail, got ${fulfilled.length} fulfilled and ${rejected.length} rejected`);
    }
    console.log('✓ Concurrency test passed: Atomic updateMany ensures exactly one transition succeeds without race conditions');

    // Cleanup test orders & logs
    await prisma.auditLog.deleteMany({
      where: { userId: { in: [validatorSellerUser.id, normalSellerUser.id, testUser.id] } }
    });
    await prisma.orderItemSku.deleteMany({
      where: { orderItem: { orderId: testOrder.id } }
    });
    await prisma.orderItem.deleteMany({
      where: { orderId: { in: [testOrder.id, concurrentOrder.id] } }
    });
    await prisma.order.deleteMany({
      where: { id: { in: [testOrder.id, concurrentOrder.id, testDraftOrder.id] } }
    });

    console.log('\n=== ALL PHASE 4 TESTS PASSED SUCCESSFULLY! ===');
  } finally {
    // Cleanup test users
    await prisma.auditLog.deleteMany({
      where: { userId: { in: [testUser.id] } }
    }).catch(() => {});
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'seller_normal_' } }
    }).catch(() => {});
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'seller_validator_' } }
    }).catch(() => {});
    await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
  }
}

main()
  .catch((e) => {
    console.error('Test execution failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
