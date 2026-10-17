import { assertSafeLocalTestDatabase } from './test-db-safety';
import prisma from '../src/lib/db';
import { OrdersService } from '../src/lib/orders/orders.service';
import { JWTPayload, signToken } from '../src/lib/auth';
import { validateK6Target } from '../tests/load/k6-http-safety.js';
import { validateNonProductionHttpTarget } from './test-http-safety';
import { DELETE as deletePromotionHandler } from '../src/app/api/admin/promotions/[id]/route';
import { NextRequest } from 'next/server';
import { getOrderCalculationConfig, invalidateOrderCalculationConfig } from '../src/lib/calculation/config-cache';

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  details?: string;
}

const results: TestResult[] = [];

function record(id: string, name: string, passed: boolean, details?: string) {
  results.push({ id, name, passed, details });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${id}: ${name}${details ? ` -> ${details}` : ''}`);
  if (!passed) {
    throw new Error(`Test failed: ${id} - ${name} (${details})`);
  }
}

function createBarrier(timeoutMs: number = 8000) {
  let resolve: () => void = () => {};
  let reject: (err: any) => void = () => {};
  let isResolved = false;
  let isRejected = false;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => {
      isResolved = true;
      res();
    };
    reject = (err) => {
      isRejected = true;
      rej(err);
    };
  });
  const timer = setTimeout(() => {
    if (!isResolved && !isRejected) {
      reject(new Error(`Barrier timed out after ${timeoutMs}ms`));
    }
  }, timeoutMs);
  return {
    promise: promise.finally(() => clearTimeout(timer)),
    resolve,
    reject,
    isResolved: () => isResolved
  };
}

async function main() {
  console.log('======================================================================');
  console.log('=== PHASE B — CRITICAL SECURITY FIXES REGRESSION VERIFICATION      ===');
  console.log('======================================================================\n');

  // STEP 0: POSITIVE DATABASE SAFETY ASSERTION
  const dbVerif = await assertSafeLocalTestDatabase(prisma, 'test-phase-b-critical-security.ts');
  console.log(`✓ Safety verification passed: Target DB is "${dbVerif.database}" on "${dbVerif.serverAddr}:${dbVerif.serverPort}" with user "${dbVerif.user}".\n`);

  // =========================================================================
  // TASK 2 VERIFICATION: FAIL-CLOSED TARGET VALIDATION (k6 & LOAD TESTING)
  // =========================================================================
  console.log('--- TASK 2: FAIL-CLOSED TARGET VALIDATORS ---');

  // 2.1 k6 validator: missing target fails closed
  try {
    validateK6Target(undefined as any, 'k6-test');
    record('T2.1', 'k6 validator rejects undefined target', false, 'Expected error was not thrown');
  } catch (err: any) {
    record('T2.1', 'k6 validator rejects undefined target', err.message.includes('SAFETY HALT'));
  }

  // 2.2 k6 validator: production Vercel fails closed
  try {
    validateK6Target('https://ktng-order-system.vercel.app', 'k6-test');
    record('T2.2', 'k6 validator rejects production Vercel', false, 'Expected error was not thrown');
  } catch (err: any) {
    record('T2.2', 'k6 validator rejects production Vercel', err.message.includes('SAFETY HALT'));
  }

  // 2.3 k6 validator: credentials in target fail closed
  try {
    validateK6Target('http://user:password@127.0.0.1:3000', 'k6-test');
    record('T2.3', 'k6 validator rejects embedded credentials', false, 'Expected error was not thrown');
  } catch (err: any) {
    record('T2.3', 'k6 validator rejects embedded credentials', err.message.includes('SAFETY HALT'));
  }

  // 2.4 k6 validator: database port fails closed
  try {
    validateK6Target('http://127.0.0.1:5432', 'k6-test');
    record('T2.4', 'k6 validator rejects forbidden port 5432', false, 'Expected error was not thrown');
  } catch (err: any) {
    record('T2.4', 'k6 validator rejects forbidden port 5432', err.message.includes('SAFETY HALT'));
  }

  // 2.5 k6 validator: valid local target succeeds
  const k6Valid = validateK6Target('http://127.0.0.1:3000', 'k6-test');
  record('T2.5', 'k6 validator accepts valid local 127.0.0.1:3000', k6Valid === 'http://127.0.0.1:3000');

  // 2.6 Node validator: missing target fails closed
  try {
    validateNonProductionHttpTarget(undefined, 'node-test');
    record('T2.6', 'Node validator rejects undefined target', false, 'Expected error was not thrown');
  } catch (err: any) {
    record('T2.6', 'Node validator rejects undefined target', err.message.includes('SAFETY HALT'));
  }

  // 2.7 Node validator: production Vercel fails closed
  try {
    validateNonProductionHttpTarget('https://ktng-order-system.vercel.app', 'node-test');
    record('T2.7', 'Node validator rejects production Vercel', false, 'Expected error was not thrown');
  } catch (err: any) {
    record('T2.7', 'Node validator rejects production Vercel', err.message.includes('SAFETY HALT'));
  }

  // 2.8 Node validator: valid local target succeeds
  const nodeValid = validateNonProductionHttpTarget('http://127.0.0.1:3000', 'node-test');
  record('T2.8', 'Node validator accepts valid local 127.0.0.1:3000', nodeValid === 'http://127.0.0.1:3000');

  // =========================================================================
  // SETUP TEST DATA FOR TASK 1 AND TASK 3
  // =========================================================================
  console.log('\n--- SETTING UP INTEGRATION TEST DATA ---');
  const timestamp = Date.now();
  const testCompanyA = await prisma.company.create({
    data: {
      name: `Security Test Company A ${timestamp}`,
      code: `SECA_${timestamp}`
    }
  });

  const testCompanyB = await prisma.company.create({
    data: {
      name: `Security Test Company B ${timestamp}`,
      code: `SECB_${timestamp}`
    }
  });

  const testUserA = await prisma.user.create({
    data: {
      email: `user_a_${timestamp}@test.local`,
      name: 'User Company A',
      companyId: testCompanyA.id,
      role: 'CLIENT',
      passwordHash: 'dummy_hash_for_test'
    }
  });

  const testProduct = await prisma.product.create({
    data: {
      name: `Security Test Cigarette ${timestamp}`,
      sku: `SKU_SEC_${timestamp}`,
      basePrice: 15000,
      stockPacks: 1000,
      imageUrl: '/placeholder.png'
    }
  });

  const testOrder = await prisma.order.create({
    data: {
      orderNumber: `ORD_SEC_${timestamp}`,
      customerId: testUserA.id,
      companyId: testCompanyA.id,
      status: 'NEW',
      totalPacks: 10,
      totalBlocks: 1,
      totalCases: 0.02,
      totalPrice: 150000,
      items: {
        create: [
          {
            productId: testProduct.id,
            productNameSnapshot: testProduct.name,
            skuSnapshot: testProduct.sku,
            baseQuantityPacks: 10,
            baseQuantityBlocks: 1,
            baseQuantityCases: 0.02,
            totalQuantityPacks: 10,
            totalQuantityBlocks: 1,
            totalQuantityCases: 0.02,
            quantityPacks: 10,
            quantityBlocks: 1,
            quantityCases: 0.02,
            price: 15000,
            effectivePrice: 15000,
            itemTotalPrice: 150000
          }
        ]
      }
    }
  });

  const staffUserA = await prisma.user.create({
    data: {
      email: `staff_a_${timestamp}@test.local`,
      name: 'Staff Company A',
      companyId: testCompanyA.id,
      role: 'CLIENT',
      passwordHash: 'dummy_hash'
    }
  });

  const staffUserB = await prisma.user.create({
    data: {
      email: `staff_b_${timestamp}@test.local`,
      name: 'Staff Company B',
      companyId: testCompanyB.id,
      role: 'CLIENT',
      passwordHash: 'dummy_hash'
    }
  });

  const adminUser = await prisma.user.create({
    data: {
      email: `admin_${timestamp}@ktng.local`,
      name: 'Super Admin',
      role: 'ADMIN',
      passwordHash: 'dummy_hash'
    }
  });

  try {
    // =========================================================================
    // TASK 1 VERIFICATION: TENANT ISOLATION IN OrdersService.updateOrderStatus
    // =========================================================================
    console.log('\n--- TASK 1: TENANT ISOLATION IN updateOrderStatus ---');

    // Sessions
    const sessionCompanyAStaff: JWTPayload = {
      userId: staffUserA.id,
      email: staffUserA.email,
      name: staffUserA.name,
      companyId: testCompanyA.id,
      permissions: ['orders:status_change']
    };

    const sessionCompanyBStaff: JWTPayload = {
      userId: staffUserB.id,
      email: staffUserB.email,
      name: staffUserB.name,
      companyId: testCompanyB.id,
      permissions: ['orders:status_change']
    };

    const sessionCompanyBStaffWithViewAll: JWTPayload = {
      userId: staffUserB.id,
      email: staffUserB.email,
      name: 'Staff Company B (View All)',
      companyId: testCompanyB.id,
      permissions: ['orders:status_change', 'orders:view_all']
    };

    const sessionCompanyBStaffWithValidation: JWTPayload = {
      userId: staffUserB.id,
      email: staffUserB.email,
      name: 'Staff Company B (Validator)',
      companyId: testCompanyB.id,
      permissions: ['orders:status_change', 'orders:view_all', 'orders:validation:accept']
    };

    const sessionGlobalStaff: JWTPayload = {
      userId: adminUser.id,
      email: 'global_staff@ktng.local',
      name: 'Global Staff (No Company)',
      companyId: undefined,
      permissions: ['orders:status_change', 'orders:view_all']
    };

    const sessionSuperadmin: JWTPayload = {
      userId: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      role: 'ADMIN',
      permissions: ['*']
    };

    // 1.1 Company A staff updating Company A order -> SUCCESS
    const resA = await OrdersService.updateOrderStatus(sessionCompanyAStaff, {
      orderId: testOrder.id,
      status: 'ASSEMBLY'
    });
    record('T1.1', 'Company A staff updating Company A order succeeds', resA.order.status === 'ASSEMBLY');

    // 1.2 Company B staff updating Company A order -> REJECTED (403)
    try {
      await OrdersService.updateOrderStatus(sessionCompanyBStaff, {
        orderId: testOrder.id,
        status: 'CANCELLED',
        reason: 'Malicious cross-company cancellation attempt'
      });
      record('T1.2', 'Cross-company status update rejected with 403', false, 'Expected 403 error was not thrown');
    } catch (err: any) {
      const is403 = err.status === 403 || err.message?.includes('Нет доступа к заказам другой компании.');
      record('T1.2', 'Cross-company status update rejected with 403', is403, err.message);
    }

    // 1.3 Verify side-effect free: Order status in database remains ASSEMBLY
    const dbOrderAfterAttempt = await prisma.order.findUnique({
      where: { id: testOrder.id },
      select: { status: true }
    });
    record('T1.3', 'Order status remains ASSEMBLY without side effects', dbOrderAfterAttempt?.status === 'ASSEMBLY');

    // 1.4 Company B staff with orders:view_all but no validation permission -> REJECTED (403)
    try {
      await OrdersService.updateOrderStatus(sessionCompanyBStaffWithViewAll, {
        orderId: testOrder.id,
        status: 'CANCELLED'
      });
      record('T1.4', 'Company-scoped staff with orders:view_all cannot modify cross-company order', false, 'Expected 403 error was not thrown');
    } catch (err: any) {
      const is403 = err.status === 403 || err.message?.includes('Нет доступа к заказам другой компании.');
      record('T1.4', 'Company-scoped staff with orders:view_all cannot modify cross-company order', is403, err.message);
    }

    // 1.5 Company B staff with validation permission -> SUCCESS
    const resVal = await OrdersService.updateOrderStatus(sessionCompanyBStaffWithValidation, {
      orderId: testOrder.id,
      status: 'SHIPPED'
    });
    record('T1.5', 'Staff with orders:validation:accept can update cross-company order', resVal.order.status === 'SHIPPED');

    // 1.6 Global staff (no companyId) updating order -> SUCCESS
    const resGlobal = await OrdersService.updateOrderStatus(sessionGlobalStaff, {
      orderId: testOrder.id,
      status: 'COMPLETED'
    });
    record('T1.6', 'Global staff without companyId can update order status', resGlobal.order.status === 'COMPLETED');

    // 1.7 Superadmin updating order -> SUCCESS
    const resSuper = await OrdersService.updateOrderStatus(sessionSuperadmin, {
      orderId: testOrder.id,
      status: 'ACCEPTED'
    });
    record('T1.7', 'Superadmin can update order status across tenants', resSuper.order.status === 'ACCEPTED');

    // =========================================================================
    // TASK 3 VERIFICATION: PROMOTION DELETION INTEGRITY
    // =========================================================================
    console.log('\n--- TASK 3: PROMOTION DELETION INTEGRITY ---');

    const adminSessionForRoute: JWTPayload = {
      userId: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      role: 'ADMIN',
      permissions: ['promotions:manage']
    };
    const adminToken = signToken(adminSessionForRoute);

    // 3.1 Unused promotion can be deleted cleanly
    const unusedPromo = await prisma.promotion.create({
      data: {
        name: `Test Unused Promotion ${timestamp}`,
        type: 'ORDER_PERCENTAGE',
        discountPercent: 5,
        isActive: true
      }
    });

    const deleteUnusedReq = new NextRequest(`http://127.0.0.1:3000/api/admin/promotions/${unusedPromo.id}`, {
      method: 'DELETE',
      headers: {
        cookie: `b2b_auth_token=${adminToken}`
      }
    });
    const unusedDeleteRes = await deletePromotionHandler(deleteUnusedReq, { params: { id: unusedPromo.id } });
    const unusedDeleteBody = await unusedDeleteRes.json();
    const unusedInDbAfter = await prisma.promotion.findUnique({ where: { id: unusedPromo.id } });
    record(
      'T3.1',
      'Unused promotion can be deleted cleanly (HTTP 200, removed from DB)',
      unusedDeleteRes.status === 200 && unusedDeleteBody.success === true && unusedInDbAfter === null
    );

    // 3.2 Promotion referenced by OrderItem.promotionId CANNOT be deleted
    const itemPromo = await prisma.promotion.create({
      data: {
        name: `Test Item-Referenced Promotion ${timestamp}`,
        type: 'SKU_BONUS',
        bonusMode: 'SAME_SKU',
        minimumBlocks: 50,
        bonusBlocks: 5,
        isActive: true
      }
    });

    const orderWithPromoItem = await prisma.order.create({
      data: {
        orderNumber: `ORD_PROMO_ITM_${timestamp}`,
        customerId: testUserA.id,
        companyId: testCompanyA.id,
        status: 'NEW',
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0.02,
        totalPrice: 150000,
        items: {
          create: [
            {
              productId: testProduct.id,
              productNameSnapshot: testProduct.name,
              skuSnapshot: testProduct.sku,
              baseQuantityPacks: 10,
              baseQuantityBlocks: 1,
              baseQuantityCases: 0.02,
              totalQuantityPacks: 10,
              totalQuantityBlocks: 1,
              totalQuantityCases: 0.02,
              quantityPacks: 10,
              quantityBlocks: 1,
              quantityCases: 0.02,
              price: 15000,
              effectivePrice: 15000,
              itemTotalPrice: 150000,
              promotionId: itemPromo.id,
              promotionNote: 'Тестовый бонус'
            }
          ]
        }
      }
    });

    const deleteItemPromoReq = new NextRequest(`http://127.0.0.1:3000/api/admin/promotions/${itemPromo.id}`, {
      method: 'DELETE',
      headers: {
        cookie: `b2b_auth_token=${adminToken}`
      }
    });
    const itemPromoDeleteRes = await deletePromotionHandler(deleteItemPromoReq, { params: { id: itemPromo.id } });
    const itemPromoDeleteBody = await itemPromoDeleteRes.json();
    const itemPromoInDbAfter = await prisma.promotion.findUnique({ where: { id: itemPromo.id } });

    record(
      'T3.2',
      'Promotion referenced by OrderItem cannot be deleted (HTTP 400, preserved in DB)',
      itemPromoDeleteRes.status === 400 &&
      itemPromoDeleteBody.error?.includes('Невозможно удалить промо-акцию') &&
      itemPromoDeleteBody.error?.includes('деактивируйте акцию (isActive: false)') &&
      itemPromoInDbAfter !== null
    );

    // 3.3 Promotion referenced by Order.appliedPromotions CANNOT be deleted
    const budgetPromo = await prisma.promotion.create({
      data: {
        name: `Test Budget-Referenced Promotion ${timestamp}`,
        type: 'ORDER_FIXED_AMOUNT',
        allocatedAmount: 1000000,
        remainingAmount: 900000,
        isActive: true
      }
    });

    const orderWithAppliedBudget = await prisma.order.create({
      data: {
        orderNumber: `ORD_PROMO_BDG_${timestamp}`,
        customerId: testUserA.id,
        companyId: testCompanyA.id,
        status: 'NEW',
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0.02,
        totalPrice: 150000,
        appliedPromotions: [{ promotionId: budgetPromo.id, amount: 100000 }] as any,
        items: {
          create: [
            {
              productId: testProduct.id,
              productNameSnapshot: testProduct.name,
              skuSnapshot: testProduct.sku,
              baseQuantityPacks: 10,
              baseQuantityBlocks: 1,
              baseQuantityCases: 0.02,
              totalQuantityPacks: 10,
              totalQuantityBlocks: 1,
              totalQuantityCases: 0.02,
              quantityPacks: 10,
              quantityBlocks: 1,
              quantityCases: 0.02,
              price: 15000,
              effectivePrice: 15000,
              itemTotalPrice: 150000
            }
          ]
        }
      }
    });

    const deleteBudgetPromoReq = new NextRequest(`http://127.0.0.1:3000/api/admin/promotions/${budgetPromo.id}`, {
      method: 'DELETE',
      headers: {
        cookie: `b2b_auth_token=${adminToken}`
      }
    });
    const budgetPromoDeleteRes = await deletePromotionHandler(deleteBudgetPromoReq, { params: { id: budgetPromo.id } });
    const budgetPromoDeleteBody = await budgetPromoDeleteRes.json();
    const budgetPromoInDbAfter = await prisma.promotion.findUnique({ where: { id: budgetPromo.id } });

    record(
      'T3.3',
      'Promotion referenced by Order.appliedPromotions cannot be deleted (HTTP 400, preserved in DB)',
      budgetPromoDeleteRes.status === 400 &&
      budgetPromoDeleteBody.error?.includes('Невозможно удалить промо-акцию') &&
      budgetPromoDeleteBody.error?.includes('деактивируйте акцию (isActive: false)') &&
      budgetPromoInDbAfter !== null
    );

    // 3.3b Single-object appliedPromotions format (historical variations)
    const budgetPromoObj = await prisma.promotion.create({
      data: {
        name: `Test Object-Referenced Promotion ${timestamp}`,
        type: 'ORDER_FIXED_AMOUNT',
        allocatedAmount: 500000,
        remainingAmount: 400000,
        isActive: true
      }
    });

    const orderWithObjBudget = await prisma.order.create({
      data: {
        orderNumber: `ORD_PROMO_OBJ_${timestamp}`,
        customerId: testUserA.id,
        companyId: testCompanyA.id,
        status: 'NEW',
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0.02,
        totalPrice: 150000,
        appliedPromotions: { promotionId: budgetPromoObj.id, amount: 50000 } as any,
        items: {
          create: [
            {
              productId: testProduct.id,
              productNameSnapshot: testProduct.name,
              skuSnapshot: testProduct.sku,
              baseQuantityPacks: 10,
              baseQuantityBlocks: 1,
              baseQuantityCases: 0.02,
              totalQuantityPacks: 10,
              totalQuantityBlocks: 1,
              totalQuantityCases: 0.02,
              quantityPacks: 10,
              quantityBlocks: 1,
              quantityCases: 0.02,
              price: 15000,
              effectivePrice: 15000,
              itemTotalPrice: 150000
            }
          ]
        }
      }
    });

    const deleteObjPromoReq = new NextRequest(`http://127.0.0.1:3000/api/admin/promotions/${budgetPromoObj.id}`, {
      method: 'DELETE',
      headers: { cookie: `b2b_auth_token=${adminToken}` }
    });
    const objPromoDeleteRes = await deletePromotionHandler(deleteObjPromoReq, { params: { id: budgetPromoObj.id } });
    const objPromoInDbAfter = await prisma.promotion.findUnique({ where: { id: budgetPromoObj.id } });
    record(
      'T3.3b',
      'Promotion referenced by single-object appliedPromotions cannot be deleted (HTTP 400, preserved in DB)',
      objPromoDeleteRes.status === 400 && objPromoInDbAfter !== null
    );

    // 3.4 Reference query failure aborts deletion and returns 500 without leaking internals
    const errorPromo = await prisma.promotion.create({
      data: {
        name: `Test Error Promotion ${timestamp}`,
        type: 'ORDER_PERCENTAGE',
        discountPercent: 10,
        isActive: true
      }
    });

    // Temporarily spy/stub prisma.$transaction to simulate an internal query failure
    const originalTransaction = prisma.$transaction.bind(prisma);
    (prisma as any).$transaction = async () => {
      const err: any = new Error('simulated_db_catalog_error: relation "Order" does not exist (syntax_error at or near)');
      throw err;
    };

    const deleteErrorReq = new NextRequest(`http://127.0.0.1:3000/api/admin/promotions/${errorPromo.id}`, {
      method: 'DELETE',
      headers: { cookie: `b2b_auth_token=${adminToken}` }
    });
    const errorDeleteRes = await deletePromotionHandler(deleteErrorReq, { params: { id: errorPromo.id } });
    const errorDeleteBody = await errorDeleteRes.json();
    (prisma as any).$transaction = originalTransaction;

    const errorPromoInDbAfter = await prisma.promotion.findUnique({ where: { id: errorPromo.id } });
    record(
      'T3.4',
      'Database query failure aborts deletion (HTTP 500, no internal SQL leak, preserved in DB)',
      errorDeleteRes.status === 500 &&
      errorDeleteBody.error === 'Не удалось удалить промо-акцию из-за внутренней ошибки сервера.' &&
      !errorDeleteBody.error?.includes('syntax_error') &&
      errorPromoInDbAfter !== null
    );
    await prisma.promotion.delete({ where: { id: errorPromo.id } });

    // =========================================================================
    // 3.5 DETERMINISTIC CONCURRENCY TESTS (SEPARATE TRANSACTIONS & BARRIERS)
    // =========================================================================

    // 3.5a SCENARIO A: Order/Draft acquires FOR SHARE lock first -> blocks concurrent DELETE
    const concPromoA = await prisma.promotion.create({
      data: {
        name: `Test Concurrent Promo A ${timestamp}`,
        type: 'ORDER_PERCENTAGE',
        discountPercent: 10,
        isActive: true,
        applyToAllCompanies: true
      }
    });

    const orderALockedBarrier = createBarrier();
    const allowOrderACommitBarrier = createBarrier();
    let orderACreated: any = null;

    const orderATxPromise = prisma.$transaction(async (tx) => {
      // 1. Acquire FOR SHARE lock using identical production protocol
      const activePromos = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM "Promotion"
        WHERE id = ANY(${[concPromoA.id]}::text[])
          AND "isActive" = true
        ORDER BY id ASC
        FOR SHARE
      `;
      if (activePromos.length !== 1) {
        throw new Error('Promotion missing or inactive');
      }

      // Signal that Order transaction holds FOR SHARE lock on concPromoA
      orderALockedBarrier.resolve();

      // Wait until orchestrator verifies DELETE is blocked attempting to acquire FOR UPDATE
      await allowOrderACommitBarrier.promise;

      // Persist draft order referencing concPromoA under the held lock
      orderACreated = await tx.order.create({
        data: {
          orderNumber: `ORD_CONC_A_${timestamp}`,
          customerId: testUserA.id,
          companyId: testCompanyA.id,
          status: 'DRAFT',
          totalPacks: 10,
          totalBlocks: 1,
          totalCases: 0.02,
          totalPrice: 150000,
          items: {
            create: [
              {
                productId: testProduct.id,
                productNameSnapshot: testProduct.name,
                skuSnapshot: testProduct.sku,
                quantityPacks: 10,
                quantityBlocks: 1,
                quantityCases: 0.02,
                price: 15000,
                itemTotalPrice: 150000,
                promotionId: concPromoA.id
              }
            ]
          }
        }
      });
      return orderACreated;
    }, { timeout: 10000, maxWait: 5000 });

    // Wait until Order transaction holds FOR SHARE lock
    await orderALockedBarrier.promise;

    // Launch DELETE on concPromoA using the production route handler
    const deleteConcAReq = new NextRequest(`http://127.0.0.1:3000/api/admin/promotions/${concPromoA.id}`, {
      method: 'DELETE',
      headers: { cookie: `b2b_auth_token=${adminToken}` }
    });

    let deleteACompleted = false;
    const deleteAPromise = deletePromotionHandler(deleteConcAReq, { params: { id: concPromoA.id } })
      .then(res => {
        deleteACompleted = true;
        return res;
      });

    // Bounded delay: give DELETE transaction time to issue query and block on FOR UPDATE in PostgreSQL
    await new Promise(r => setTimeout(r, 150));

    // Assert that DELETE is actively blocked waiting for Order's FOR SHARE lock
    const wasDeleteBlockedByOrderLock = !deleteACompleted;

    // Release Order transaction to persist reference and commit
    allowOrderACommitBarrier.resolve();

    await orderATxPromise;
    const deleteARes = await deleteAPromise;
    const deleteABody = await deleteARes.json();

    const concPromoAInDbAfter = await prisma.promotion.findUnique({ where: { id: concPromoA.id } });
    const concAOrdersAfter = await prisma.orderItem.findMany({ where: { promotionId: concPromoA.id } });

    record(
      'T3.5a',
      'Order acquires lock first: blocks concurrent DELETE and rejects deletion upon commit (HTTP 400)',
      wasDeleteBlockedByOrderLock === true &&
      deleteARes.status === 400 &&
      deleteABody.error?.includes('Невозможно удалить промо-акцию') &&
      concPromoAInDbAfter !== null &&
      concAOrdersAfter.length === 1
    );

    // 3.5b SCENARIO B: DELETE acquires FOR UPDATE lock first -> blocks concurrent Order/Draft and forces rollback
    const concPromoB = await prisma.promotion.create({
      data: {
        name: `Test Concurrent Promo B ${timestamp}`,
        type: 'ORDER_PERCENTAGE',
        discountPercent: 10,
        isActive: true,
        applyToAllCompanies: true
      }
    });

    const deleteBLockedBarrier = createBarrier();
    const allowDeleteBCommitBarrier = createBarrier();
    let deleteBTxCommitted = false;

    const deleteBTxPromise = prisma.$transaction(async (tx) => {
      // 1. Exclusively lock promotion
      const lockedRows = await tx.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT id, name
        FROM "Promotion"
        WHERE id = ${concPromoB.id}
        FOR UPDATE
      `;
      if (!lockedRows || lockedRows.length === 0) throw new Error('Promotion not found');

      // 2. Perform reference checks (0 references exist initially)
      const linkedItemCount = await tx.orderItem.count({ where: { promotionId: concPromoB.id } });
      const appliedRows = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "Order"
        WHERE "appliedPromotions" IS NOT NULL
          AND (
            (jsonb_typeof("appliedPromotions"::jsonb) = 'array' AND "appliedPromotions"::jsonb @> ${JSON.stringify([{ promotionId: concPromoB.id }])}::jsonb)
            OR (jsonb_typeof("appliedPromotions"::jsonb) = 'object' AND "appliedPromotions"::jsonb @> ${JSON.stringify({ promotionId: concPromoB.id })}::jsonb)
            OR ("appliedPromotions"::text LIKE ${'%"promotionId":"' + concPromoB.id + '"%'} OR "appliedPromotions"::text LIKE ${'%"promotionId": "' + concPromoB.id + '"%'})
          )
      `;
      if (linkedItemCount + Number(appliedRows[0]?.count || 0) > 0) throw new Error('References exist');

      // Signal that DELETE holds FOR UPDATE and verified 0 references
      deleteBLockedBarrier.resolve();

      // Wait until Order attempts to acquire lock and gets blocked
      await allowDeleteBCommitBarrier.promise;

      // 3. Delete row and commit
      await tx.promotion.delete({ where: { id: concPromoB.id } });
      deleteBTxCommitted = true;
      return { success: true };
    }, { timeout: 10000, maxWait: 5000 });

    // Wait until DELETE holds FOR UPDATE lock
    await deleteBLockedBarrier.promise;

    // Launch Order transaction attempting to acquire FOR SHARE on concPromoB
    let orderBCompleted = false;
    let orderBCreated: any = null;

    const orderBTxPromise = prisma.$transaction(async (tx) => {
      // Production locking protocol
      const activePromos = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM "Promotion"
        WHERE id = ANY(${[concPromoB.id]}::text[])
          AND "isActive" = true
        ORDER BY id ASC
        FOR SHARE
      `;
      if (activePromos.length !== 1) {
        throw new Error('Одна или несколько примененных акций были изменены или удалены. Пожалуйста, обновите заказ.');
      }

      orderBCreated = await tx.order.create({
        data: {
          orderNumber: `ORD_CONC_B_${timestamp}`,
          customerId: testUserA.id,
          companyId: testCompanyA.id,
          status: 'DRAFT',
          totalPacks: 10,
          totalBlocks: 1,
          totalCases: 0.02,
          totalPrice: 150000,
          items: {
            create: [
              {
                productId: testProduct.id,
                productNameSnapshot: testProduct.name,
                skuSnapshot: testProduct.sku,
                quantityPacks: 10,
                quantityBlocks: 1,
                quantityCases: 0.02,
                price: 15000,
                itemTotalPrice: 150000,
                promotionId: concPromoB.id
              }
            ]
          }
        }
      });
      return orderBCreated;
    }, { timeout: 10000, maxWait: 5000 })
      .then(res => {
        orderBCompleted = true;
        return res;
      })
      .catch(err => {
        orderBCompleted = true;
        throw err;
      });

    // Bounded delay: give Order time to issue query and block on FOR SHARE in PostgreSQL
    await new Promise(r => setTimeout(r, 150));

    // Assert that Order is actively blocked waiting for DELETE's FOR UPDATE lock
    const wasOrderBlockedByDeleteLock = !orderBCompleted;

    // Release DELETE to delete row and commit
    allowDeleteBCommitBarrier.resolve();

    await deleteBTxPromise;

    // Await Order (expected to fail when it unblocks and sees promotion is gone)
    let orderBFailedExpected = false;
    try {
      await orderBTxPromise;
    } catch (err: any) {
      if (err.message?.includes('были изменены или удалены')) {
        orderBFailedExpected = true;
      }
    }

    const concPromoBInDbAfter = await prisma.promotion.findUnique({ where: { id: concPromoB.id } });
    const concBOrdersAfter = await prisma.orderItem.findMany({ where: { promotionId: concPromoB.id } });

    record(
      'T3.5b',
      'DELETE acquires lock first: blocks concurrent Order/Draft and causes safe rollback with 0 dangling references',
      wasOrderBlockedByDeleteLock === true &&
      deleteBTxCommitted === true &&
      orderBFailedExpected === true &&
      concPromoBInDbAfter === null &&
      concBOrdersAfter.length === 0
    );

    // 3.6 Deactivated promotion budget restoration upon order cancellation
    const deactPromo = await prisma.promotion.create({
      data: {
        name: `Test Deactivated Promo ${timestamp}`,
        type: 'ORDER_FIXED_AMOUNT',
        allocatedAmount: 1000000,
        remainingAmount: 900000,
        isActive: true
      }
    });

    const orderToCancel = await prisma.order.create({
      data: {
        orderNumber: `ORD_DEACT_CANCEL_${timestamp}`,
        customerId: testUserA.id,
        companyId: testCompanyA.id,
        status: 'NEW',
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0.02,
        totalPrice: 150000,
        appliedPromotions: [{ promotionId: deactPromo.id, amount: 100000 }] as any,
        items: {
          create: [
            {
              productId: testProduct.id,
              productNameSnapshot: testProduct.name,
              skuSnapshot: testProduct.sku,
              baseQuantityPacks: 10,
              baseQuantityBlocks: 1,
              baseQuantityCases: 0.02,
              totalQuantityPacks: 10,
              totalQuantityBlocks: 1,
              totalQuantityCases: 0.02,
              quantityPacks: 10,
              quantityBlocks: 1,
              quantityCases: 0.02,
              price: 15000,
              effectivePrice: 15000,
              itemTotalPrice: 150000
            }
          ]
        }
      }
    });

    // Deactivate the promotion
    await prisma.promotion.update({
      where: { id: deactPromo.id },
      data: { isActive: false }
    });

    // Cancel order - should restore budget to deactivated promotion cleanly
    const cancelRes = await OrdersService.updateOrderStatus(sessionCompanyAStaff, {
      orderId: orderToCancel.id,
      status: 'CANCELLED'
    });

    const deactPromoAfterCancel = await prisma.promotion.findUnique({ where: { id: deactPromo.id } });
    record(
      'T3.6',
      'Deactivated promotion does not break order cancellation or budget restoration (900k -> 1000k)',
      cancelRes.order.status === 'CANCELLED' && deactPromoAfterCancel?.remainingAmount === 1000000
    );

    // 3.7 Cache invalidation occurs only after successful committed change
    const cachePromo = await prisma.promotion.create({
      data: {
        name: `Test Cache Promo ${timestamp}`,
        type: 'ORDER_PERCENTAGE',
        discountPercent: 15,
        isActive: true
      }
    });

    // Populate cache
    await getOrderCalculationConfig(testCompanyA.id);
    await getOrderCalculationConfig(testCompanyA.id);

    // Call DELETE on an order-referenced promo (fails with 400)
    const deleteBlockedReq = new NextRequest(`http://127.0.0.1:3000/api/admin/promotions/${itemPromo.id}`, {
      method: 'DELETE',
      headers: { cookie: `b2b_auth_token=${adminToken}` }
    });
    await deletePromotionHandler(deleteBlockedReq, { params: { id: itemPromo.id } });

    // Cache should STILL be warm (cacheHit === true) because transaction aborted
    const { cacheHit: hitAfterBlockedDelete } = await getOrderCalculationConfig(testCompanyA.id);

    // Call DELETE on unreferenced promo (succeeds with 200)
    const deleteSuccessReq = new NextRequest(`http://127.0.0.1:3000/api/admin/promotions/${cachePromo.id}`, {
      method: 'DELETE',
      headers: { cookie: `b2b_auth_token=${adminToken}` }
    });
    await deletePromotionHandler(deleteSuccessReq, { params: { id: cachePromo.id } });

    // Cache should NOW be invalidated (cacheHit === false) because transaction committed
    const { cacheHit: hitAfterSuccessfulDelete } = await getOrderCalculationConfig(testCompanyA.id);

    record(
      'T3.7',
      'Cache invalidation occurs only after successful committed deletion',
      hitAfterBlockedDelete === true && hitAfterSuccessfulDelete === false
    );

    // CLEANUP
    console.log('\n--- CLEANING UP TEST DATA ---');
    const allOrderIdsToDelete = [
      testOrder.id,
      orderWithPromoItem.id,
      orderWithAppliedBudget.id,
      orderWithObjBudget.id,
      orderToCancel.id,
      orderACreated?.id,
      orderBCreated?.id
    ].filter((id): id is string => Boolean(id));

    await prisma.orderItemSku.deleteMany({
      where: { orderItem: { orderId: { in: allOrderIdsToDelete } } }
    });
    await prisma.orderItem.deleteMany({
      where: { orderId: { in: allOrderIdsToDelete } }
    });
    await prisma.order.deleteMany({
      where: { id: { in: allOrderIdsToDelete } }
    });
    await prisma.promotion.deleteMany({
      where: {
        id: { in: [itemPromo.id, budgetPromo.id, budgetPromoObj.id, concPromoA.id, concPromoB.id, deactPromo.id] }
      }
    });
    await prisma.product.delete({ where: { id: testProduct.id } });
    await prisma.user.deleteMany({
      where: { id: { in: [testUserA.id, staffUserA.id, staffUserB.id, adminUser.id] } }
    });
    await prisma.company.deleteMany({
      where: {
        id: { in: [testCompanyA.id, testCompanyB.id] }
      }
    });
    console.log('✓ Cleanup completed successfully.');

  } catch (error) {
    console.error('Error during test execution:', error);
    // Cleanup best-effort
    try {
      await prisma.orderItemSku.deleteMany({ where: { orderItem: { order: { companyId: { in: [testCompanyA.id, testCompanyB.id] } } } } });
      await prisma.orderItem.deleteMany({ where: { order: { companyId: { in: [testCompanyA.id, testCompanyB.id] } } } });
      await prisma.order.deleteMany({ where: { companyId: { in: [testCompanyA.id, testCompanyB.id] } } });
      await prisma.product.deleteMany({ where: { id: testProduct.id } });
      await prisma.user.deleteMany({ where: { id: { in: [testUserA.id, staffUserA.id, staffUserB.id, adminUser.id] } } });
      await prisma.company.deleteMany({ where: { id: { in: [testCompanyA.id, testCompanyB.id] } } });
    } catch (_) {}
    throw error;
  }

  console.log('\n======================================================================');
  console.log(`=== ALL ${results.length} CRITICAL SECURITY VERIFICATION TESTS PASSED! ===`);
  console.log('======================================================================\n');
}

main()
  .catch((err) => {
    console.error('\n❌ FATAL TEST FAILURE:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
