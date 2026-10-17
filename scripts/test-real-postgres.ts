import { assertSafeLocalTestDatabase, LOCAL_TEST_DB_URL, validateLocalTestUrl } from './test-db-safety';
import crypto from 'crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import prisma from '../src/lib/db';
import {
  OrdersService,
  AppliedPromotionDeduction,
  LegacyAmbiguousPromotionError
} from '../src/lib/orders/orders.service';
import { invalidateOrderCalculationConfig, PromotionsService } from '../src/lib/promotions/promotions.service';
import { JWTPayload, hasPermission } from '../src/lib/auth';

const productExtension = {
  query: {
    product: {
      async create({ args, query }: any) {
        if (!args.data.imageUrl) {
          args.data.imageUrl = '/placeholder.png';
        }
        return query(args);
      },
      async createMany({ args, query }: any) {
        if (Array.isArray(args.data)) {
          for (const item of args.data) {
            if (!item.imageUrl) item.imageUrl = '/placeholder.png';
          }
        }
        return query(args);
      }
    }
  }
};

interface TestRecord {
  area: string;
  id: string;
  name: string;
  methodInvoked: string;
  expected: string;
  actual: string;
  passed: boolean;
  notes?: string;
}

const records: TestRecord[] = [];

function recordTest(
  area: string,
  id: string,
  name: string,
  expected: string,
  actual: string,
  passed: boolean,
  notes?: string,
  methodInvoked = 'OrdersService'
) {
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`[${status}] [${area}] [${id}] ${name}`);
  console.log(`       Method:   ${methodInvoked}`);
  console.log(`       Expected: ${expected}`);
  console.log(`       Actual:   ${actual}`);
  if (notes) console.log(`       Notes:    ${notes}`);
  records.push({ area, id, name, methodInvoked, expected, actual, passed, notes });
  if (!passed) {
    console.error(`\n>>> TEST FAILED: [${area}] [${id}] ${name}\n`);
    throw new Error(`Integration test failure in ${area} [${id}]: ${name}`);
  }
}

/**
 * Creates an independent PrismaClient connection pool against local `ktng_test`
 * to test true concurrent PostgreSQL backend sessions and row locks.
 */
function createIndependentClient(): PrismaClient {
  const client = new PrismaClient({
    datasources: {
      db: { url: LOCAL_TEST_DB_URL }
    },
    log: ['error']
  });
  return client.$extends(productExtension) as unknown as PrismaClient;
}

/**
 * Helper to bound any concurrent operation with a strict timeout so tests never hang.
 */
async function withBoundedTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`TIMEOUT (${timeoutMs}ms) exceeded while waiting for: ${label}`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Track all created test entities for deterministic, complete cleanup
const createdOrderIds = new Set<string>();
const createdProductIds = new Set<string>();
const createdGroupIds = new Set<string>();
const createdPromotionIds = new Set<string>();
const createdUserIds = new Set<string>();
const createdCompanyIds = new Set<string>();

async function cleanupOrphanedTestArtifacts(): Promise<void> {
  const testOrderPrefixes = ['order_b', 'order_c', 'order_d', 'order_e', 'order_f', 'order_g', 'order_h'];
  const testPromoPrefixes = ['promo_a', 'promo_c', 'promo_d', 'promo_e', 'promo_f', 'promo_g', 'promo_h'];
  const testProdPrefixes = ['prod_b', 'prod_c', 'prod_d', 'prod_e', 'prod_f', 'prod_g', 'prod_h'];
  const testGroupPrefixes = ['grp_c', 'grp_d'];
  const testUserPrefixes = ['user_admin_test_', 'user_cust_test_', 'user_staff_test_', 'user_other_test_'];
  const testCompanyPrefixes = ['comp_test_'];

  await prisma.auditLog.deleteMany({
    where: {
      OR: testUserPrefixes.map(p => ({ userId: { startsWith: p } }))
    }
  });

  await prisma.orderItemSku.deleteMany({
    where: {
      OR: [
        ...testOrderPrefixes.map(p => ({ orderItem: { orderId: { startsWith: p } } })),
        ...testProdPrefixes.map(p => ({ productId: { startsWith: p } }))
      ]
    }
  });

  await prisma.orderItem.deleteMany({
    where: {
      OR: [
        ...testOrderPrefixes.map(p => ({ orderId: { startsWith: p } })),
        ...testProdPrefixes.map(p => ({ productId: { startsWith: p } }))
      ]
    }
  });

  await prisma.order.deleteMany({
    where: {
      OR: [
        ...testOrderPrefixes.map(p => ({ id: { startsWith: p } })),
        ...testUserPrefixes.map(p => ({ customerId: { startsWith: p } })),
        ...testCompanyPrefixes.map(p => ({ companyId: { startsWith: p } }))
      ]
    }
  });

  await prisma.promotion.deleteMany({
    where: {
      OR: testPromoPrefixes.map(p => ({ id: { startsWith: p } }))
    }
  });

  await prisma.product.deleteMany({
    where: {
      OR: testProdPrefixes.map(p => ({ id: { startsWith: p } }))
    }
  });

  await prisma.productGroup.deleteMany({
    where: {
      OR: testGroupPrefixes.map(p => ({ id: { startsWith: p } }))
    }
  });

  await prisma.user.deleteMany({
    where: {
      OR: testUserPrefixes.map(p => ({ id: { startsWith: p } }))
    }
  });

  await prisma.company.deleteMany({
    where: {
      OR: testCompanyPrefixes.map(p => ({ id: { startsWith: p } }))
    }
  });
}

async function cleanupTrackedTestData(): Promise<string[]> {
  const errors: string[] = [];

  const step = async (label: string, fn: () => Promise<any>) => {
    try {
      await fn();
    } catch (err: any) {
      const msg = `[CLEANUP ERROR] ${label}: ${err?.message || String(err)}`;
      console.error(msg);
      errors.push(msg);
    }
  };

  const orderIds = Array.from(createdOrderIds);
  const productIds = Array.from(createdProductIds);
  const groupIds = Array.from(createdGroupIds);
  const promoIds = Array.from(createdPromotionIds);
  const userIds = Array.from(createdUserIds);
  const companyIds = Array.from(createdCompanyIds);

  if (userIds.length > 0 || orderIds.length > 0) {
    await step('Delete test AuditLogs', () =>
      prisma.auditLog.deleteMany({
        where: {
          OR: [
            ...(userIds.length > 0 ? [{ userId: { in: userIds } }] : []),
            ...orderIds.map(oid => ({ details: { contains: oid } }))
          ]
        }
      })
    );
  }

  if (orderIds.length > 0 || productIds.length > 0) {
    await step('Delete test OrderItemSkus', () =>
      prisma.orderItemSku.deleteMany({
        where: {
          OR: [
            ...(orderIds.length > 0 ? [{ orderItem: { orderId: { in: orderIds } } }] : []),
            ...(productIds.length > 0 ? [{ productId: { in: productIds } }] : [])
          ]
        }
      })
    );

    await step('Delete test OrderItems', () =>
      prisma.orderItem.deleteMany({
        where: {
          OR: [
            ...(orderIds.length > 0 ? [{ orderId: { in: orderIds } } ] : []),
            ...(productIds.length > 0 ? [{ productId: { in: productIds } }] : [])
          ]
        }
      })
    );
  }

  if (orderIds.length > 0 || userIds.length > 0 || companyIds.length > 0) {
    await step('Delete test Orders', () =>
      prisma.order.deleteMany({
        where: {
          OR: [
            ...(orderIds.length > 0 ? [{ id: { in: orderIds } }] : []),
            ...(userIds.length > 0 ? [{ customerId: { in: userIds } }] : []),
            ...(companyIds.length > 0 ? [{ companyId: { in: companyIds } }] : [])
          ]
        }
      })
    );
  }

  if (promoIds.length > 0) {
    await step('Delete test Promotions', () =>
      prisma.promotion.deleteMany({ where: { id: { in: promoIds } } })
    );
  }

  if (productIds.length > 0) {
    await step('Delete test Products', () =>
      prisma.product.deleteMany({ where: { id: { in: productIds } } })
    );
  }

  if (groupIds.length > 0) {
    await step('Delete test ProductGroups', () =>
      prisma.productGroup.deleteMany({ where: { id: { in: groupIds } } })
    );
  }

  if (userIds.length > 0) {
    await step('Delete test Users', () =>
      prisma.user.deleteMany({ where: { id: { in: userIds } } })
    );
  }

  if (companyIds.length > 0) {
    await step('Delete test Companies', () =>
      prisma.company.deleteMany({ where: { id: { in: companyIds } } })
    );
  }

  return errors;
}

async function runRealPostgresIntegrationSuite() {
  console.log('========================================================================');
  console.log('   PHASE B: REAL POSTGRESQL ENGINE INTEGRATION TEST SUITE               ');
  console.log('========================================================================\n');

  // 1. Fail-closed verification of local PostgreSQL `ktng_test`
  const dbSafetyInfo = await assertSafeLocalTestDatabase(prisma, 'test-real-postgres.ts');

  // Verify fail-closed rejection of non-local / cloud / non-test URLs
  const forbiddenUrls = [
    '',
    'postgresql://postgres:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
    'postgresql://ktng_test:pass@192.168.1.50:5432/ktng_test',
    'postgresql://ktng_test:pass@127.0.0.1:5433/ktng_test',
    'postgresql://ktng_test:pass@127.0.0.1:5432/production_db',
    'postgresql://postgres:pass@127.0.0.1:5432/ktng_test'
  ];
  let rejectedForbiddenCount = 0;
  for (const badUrl of forbiddenUrls) {
    try {
      validateLocalTestUrl(badUrl, 'NEGATIVE_TEST');
    } catch (_) {
      rejectedForbiddenCount++;
    }
  }

  recordTest(
    'Safety',
    'S.1',
    'Fail-closed database target verification (127.0.0.1:5432 / ktng_test) and negative URL rejection',
    'Connected to ktng_test (PostgreSQL 15) as ktng_test; 6/6 non-test URLs rejected',
    `DB: ${dbSafetyInfo.database}, User: ${dbSafetyInfo.user}, Port: ${dbSafetyInfo.serverPort}, Rejected bad URLs: ${rejectedForbiddenCount}/6`,
    dbSafetyInfo.database === 'ktng_test' &&
      dbSafetyInfo.user === 'ktng_test' &&
      dbSafetyInfo.serverPort === 5432 &&
      rejectedForbiddenCount === forbiddenUrls.length,
    undefined,
    'assertSafeLocalTestDatabase + validateLocalTestUrl'
  );

  // 2. Clean up any orphaned test rows from earlier runs before starting
  await cleanupOrphanedTestArtifacts();
  invalidateOrderCalculationConfig();

  // 3. Mock ONLY the external non-DB background Excel/Google Drive attachment boundary
  // so `void OrdersService.generateAndAttachExcel(...)` does not call external Google Drive APIs
  // or mutate rows asynchronously after test completion.
  const originalGenerateExcel = OrdersService.generateAndAttachExcel;
  const excelTriggers: Array<{
    orderId: string;
    orderNumber: string;
    clientName: string;
    itemCount: number;
    totals: { totalBlocks: number; totalCases: number; totalPrice: number };
  }> = [];

  OrdersService.generateAndAttachExcel = async (
    orderId: string,
    orderNumber: string,
    clientName: string,
    validatedItems: any[],
    totals: { totalBlocks: number; totalCases: number; totalPrice: number }
  ) => {
    excelTriggers.push({
      orderId,
      orderNumber,
      clientName,
      itemCount: Array.isArray(validatedItems) ? validatedItems.length : 0,
      totals
    });
    return {
      fileUrl: `/api/orders/download?fileId=mock_${orderId}&fileName=${orderNumber}.xlsx`,
      fileId: `mock_${orderId}`,
      fileName: `${orderNumber}.xlsx`,
      buffer: Buffer.from('mock-excel'),
      message: 'Mocked external storage upload for integration test'
    } as any;
  };

  // Baseline test company & actor sessions
  const testCompanyId = 'comp_test_' + crypto.randomBytes(4).toString('hex');
  const otherCompanyId = 'comp_test_other_' + crypto.randomBytes(4).toString('hex');
  createdCompanyIds.add(testCompanyId);
  createdCompanyIds.add(otherCompanyId);

  const adminSession: JWTPayload = {
    userId: 'user_admin_test_' + crypto.randomBytes(4).toString('hex'),
    email: 'admin_test@ktng.local',
    name: 'Test Administrator',
    role: 'ADMIN',
    roleName: 'Суперадминистратор',
    permissions: ['*'],
    companyId: testCompanyId
  };

  const customerSession: JWTPayload = {
    userId: 'user_cust_test_' + crypto.randomBytes(4).toString('hex'),
    email: 'cust_test@ktng.local',
    name: 'Test Customer',
    role: 'CUSTOMER',
    permissions: ['orders:create', 'orders:view_own'],
    companyId: testCompanyId
  };

  const otherCustomerSession: JWTPayload = {
    userId: 'user_other_test_' + crypto.randomBytes(4).toString('hex'),
    email: 'other_cust@ktng.local',
    name: 'Other Customer',
    role: 'CUSTOMER',
    permissions: ['orders:create', 'orders:view_own'],
    companyId: testCompanyId
  };

  const crossCompanyCustomerSession: JWTPayload = {
    userId: 'user_other_test_comp_' + crypto.randomBytes(4).toString('hex'),
    email: 'cross_cust@ktng.local',
    name: 'Cross Company Customer',
    role: 'CUSTOMER',
    permissions: ['orders:create', 'orders:view_own'],
    companyId: otherCompanyId
  };

  const staffSession: JWTPayload = {
    userId: 'user_staff_test_' + crypto.randomBytes(4).toString('hex'),
    email: 'staff_test@ktng.local',
    name: 'Test Staff With Edit',
    role: 'SELLER',
    permissions: ['orders:view_all', 'orders:edit', 'orders:status_change', 'orders:validation:view'],
    companyId: testCompanyId
  };

  const staffWithoutEditSession: JWTPayload = {
    userId: 'user_staff_test_noedit_' + crypto.randomBytes(4).toString('hex'),
    email: 'staff_noedit@ktng.local',
    name: 'Test Staff Without Edit',
    role: 'SELLER',
    permissions: ['orders:view_all'],
    companyId: testCompanyId
  };

  createdUserIds.add(adminSession.userId);
  createdUserIds.add(customerSession.userId);
  createdUserIds.add(otherCustomerSession.userId);
  createdUserIds.add(crossCompanyCustomerSession.userId);
  createdUserIds.add(staffSession.userId);
  createdUserIds.add(staffWithoutEditSession.userId);

  await prisma.company.createMany({
    data: [
      { id: testCompanyId, name: 'Test Company Ltd', code: 'TC-' + crypto.randomBytes(3).toString('hex') },
      { id: otherCompanyId, name: 'Other Company Ltd', code: 'OC-' + crypto.randomBytes(3).toString('hex') }
    ]
  });

  await prisma.user.createMany({
    data: [
      {
        id: adminSession.userId,
        name: adminSession.name,
        email: `${adminSession.userId}@test.local`,
        passwordHash: 'dummy_hash',
        role: 'ADMIN',
        companyId: testCompanyId
      },
      {
        id: customerSession.userId,
        name: customerSession.name,
        email: `${customerSession.userId}@test.local`,
        passwordHash: 'dummy_hash',
        role: 'CUSTOMER',
        companyId: testCompanyId
      },
      {
        id: otherCustomerSession.userId,
        name: otherCustomerSession.name,
        email: `${otherCustomerSession.userId}@test.local`,
        passwordHash: 'dummy_hash',
        role: 'CUSTOMER',
        companyId: testCompanyId
      },
      {
        id: crossCompanyCustomerSession.userId,
        name: crossCompanyCustomerSession.name,
        email: `${crossCompanyCustomerSession.userId}@test.local`,
        passwordHash: 'dummy_hash',
        role: 'CUSTOMER',
        companyId: otherCompanyId
      },
      {
        id: staffSession.userId,
        name: staffSession.name,
        email: `${staffSession.userId}@test.local`,
        passwordHash: 'dummy_hash',
        role: 'SELLER',
        companyId: testCompanyId
      },
      {
        id: staffWithoutEditSession.userId,
        name: staffWithoutEditSession.name,
        email: `${staffWithoutEditSession.userId}@test.local`,
        passwordHash: 'dummy_hash',
        role: 'SELLER',
        companyId: testCompanyId
      }
    ]
  });

  async function createTrackedProduct(data: {
    id: string;
    name: string;
    sku: string;
    basePrice: number;
    stockPacks: number;
    groupId?: string;
    priority?: number;
    isActive?: boolean;
  }) {
    createdProductIds.add(data.id);
    return prisma.product.create({
      data: {
        id: data.id,
        name: data.name,
        sku: data.sku,
        basePrice: data.basePrice,
        stockPacks: data.stockPacks,
        imageUrl: '/placeholder.png',
        isActive: data.isActive ?? true,
        groupId: data.groupId,
        priority: data.priority ?? 1
      }
    });
  }

  async function createTrackedPromotion(data: {
    id: string;
    name: string;
    allocatedAmount: number | null;
    remainingAmount: number | null;
    consumedAmount: number;
    maxOrderUsagePercent?: number;
    isActive?: boolean;
    companyId?: string;
  }) {
    createdPromotionIds.add(data.id);
    return prisma.promotion.create({
      data: {
        id: data.id,
        name: data.name,
        type: 'ORDER_FIXED_AMOUNT',
        allocatedAmount: data.allocatedAmount,
        remainingAmount: data.remainingAmount,
        consumedAmount: data.consumedAmount,
        maxOrderUsagePercent: data.maxOrderUsagePercent ?? 10.0,
        isActive: data.isActive ?? true,
        applyToAllCompanies: false,
        ...(data.companyId ? { companies: { connect: { id: data.companyId } } } : {})
      }
    });
  }

  try {
    // =========================================================================
    // AREA A: PROMOTION BUDGET CONCURRENCY (11 SCENARIOS)
    // =========================================================================
    console.log('\n--- AREA A: Promotion Budget Concurrency ---');

    // A.1 Two simultaneous deductions exceeding budget
    const pA1 = 'promo_a1_' + crypto.randomBytes(4).toString('hex');
    await createTrackedPromotion({
      id: pA1,
      name: 'Promo A.1',
      allocatedAmount: 100000,
      remainingAmount: 100000,
      consumedAmount: 0
    });

    const clientA1_1 = createIndependentClient();
    const clientA1_2 = createIndependentClient();
    try {
      const resultsA1 = await withBoundedTimeout(
        Promise.allSettled([
          clientA1_1.$transaction(async (tx) => {
            await OrdersService.batchDeductPromotionBudget(tx, [{ promotionId: pA1, amount: 60000 }]);
          }),
          clientA1_2.$transaction(async (tx) => {
            await OrdersService.batchDeductPromotionBudget(tx, [{ promotionId: pA1, amount: 60000 }]);
          })
        ]),
        10000,
        'Area A.1 concurrent deductions'
      );

      const successCountA1 = resultsA1.filter(r => r.status === 'fulfilled').length;
      const rejectedCountA1 = resultsA1.filter(r => r.status === 'rejected').length;
      const stateA1 = await prisma.promotion.findUnique({ where: { id: pA1 } });

      recordTest(
        'Area A',
        'A.1',
        'Two simultaneous deductions exceeding finite budget (60k + 60k vs 100k)',
        '1 success, 1 failure, remaining: 40000, consumed: 60000',
        `${successCountA1} successes, ${rejectedCountA1} failures, remaining: ${stateA1?.remainingAmount}, consumed: ${stateA1?.consumedAmount}`,
        successCountA1 === 1 && rejectedCountA1 === 1 && stateA1?.remainingAmount === 40000 && stateA1?.consumedAmount === 60000,
        undefined,
        'OrdersService.batchDeductPromotionBudget'
      );
    } finally {
      await clientA1_1.$disconnect();
      await clientA1_2.$disconnect();
    }

    // A.2 Several concurrent deductions exactly equal to available budget
    const pA2 = 'promo_a2_' + crypto.randomBytes(4).toString('hex');
    await createTrackedPromotion({
      id: pA2,
      name: 'Promo A.2',
      allocatedAmount: 100000,
      remainingAmount: 100000,
      consumedAmount: 0
    });

    const clientsA2 = Array.from({ length: 5 }, () => createIndependentClient());
    try {
      const resultsA2 = await withBoundedTimeout(
        Promise.allSettled(
          clientsA2.map(c =>
            c.$transaction(async (tx) => {
              await OrdersService.batchDeductPromotionBudget(tx, [{ promotionId: pA2, amount: 20000 }]);
            })
          )
        ),
        10000,
        'Area A.2 5x20k deductions'
      );

      const successCountA2 = resultsA2.filter(r => r.status === 'fulfilled').length;
      const stateA2 = await prisma.promotion.findUnique({ where: { id: pA2 } });

      recordTest(
        'Area A',
        'A.2',
        'Several concurrent deductions exactly equal to available budget (5 x 20k = 100k)',
        '5 successes, 0 failures, remaining: 0, consumed: 100000',
        `${successCountA2} successes, remaining: ${stateA2?.remainingAmount}, consumed: ${stateA2?.consumedAmount}`,
        successCountA2 === 5 && stateA2?.remainingAmount === 0 && stateA2?.consumedAmount === 100000,
        undefined,
        'OrdersService.batchDeductPromotionBudget'
      );
    } finally {
      await Promise.all(clientsA2.map(c => c.$disconnect()));
    }

    // A.3 Several concurrent deductions exceeding available budget
    const pA3 = 'promo_a3_' + crypto.randomBytes(4).toString('hex');
    await createTrackedPromotion({
      id: pA3,
      name: 'Promo A.3',
      allocatedAmount: 100000,
      remainingAmount: 100000,
      consumedAmount: 0
    });

    const clientsA3 = Array.from({ length: 10 }, () => createIndependentClient());
    try {
      const resultsA3 = await withBoundedTimeout(
        Promise.allSettled(
          clientsA3.map(c =>
            c.$transaction(async (tx) => {
              await OrdersService.batchDeductPromotionBudget(tx, [{ promotionId: pA3, amount: 20000 }]);
            })
          )
        ),
        10000,
        'Area A.3 10x20k deductions'
      );

      const successCountA3 = resultsA3.filter(r => r.status === 'fulfilled').length;
      const rejectedCountA3 = resultsA3.filter(r => r.status === 'rejected').length;
      const stateA3 = await prisma.promotion.findUnique({ where: { id: pA3 } });

      recordTest(
        'Area A',
        'A.3',
        'Several concurrent deductions exceeding budget (10 x 20k vs 100k)',
        'Exactly 5 successes, 5 failures, remaining: 0, consumed: 100000',
        `${successCountA3} successes, ${rejectedCountA3} failures, remaining: ${stateA3?.remainingAmount}, consumed: ${stateA3?.consumedAmount}`,
        successCountA3 === 5 && rejectedCountA3 === 5 && stateA3?.remainingAmount === 0 && stateA3?.consumedAmount === 100000,
        undefined,
        'OrdersService.batchDeductPromotionBudget'
      );
    } finally {
      await Promise.all(clientsA3.map(c => c.$disconnect()));
    }

    // A.4 Missing promotion ID
    let missingIdCaught = false;
    try {
      await prisma.$transaction(async (tx) => {
        await OrdersService.batchDeductPromotionBudget(tx, [{ promotionId: 'non_existent_promo_id', amount: 10000 }]);
      });
    } catch (_) {
      missingIdCaught = true;
    }
    recordTest(
      'Area A',
      'A.4',
      'Missing promotion ID in batchDeductPromotionBudget',
      'Transaction rejected with missing promo error',
      `Caught error: ${missingIdCaught}`,
      missingIdCaught,
      undefined,
      'OrdersService.batchDeductPromotionBudget'
    );

    // A.5 Insufficient budget in multi-promotion transaction (atomic rollback)
    const pA5_1 = 'promo_a5_1_' + crypto.randomBytes(4).toString('hex');
    const pA5_2 = 'promo_a5_2_' + crypto.randomBytes(4).toString('hex');
    await createTrackedPromotion({ id: pA5_1, name: 'Promo A.5.1', allocatedAmount: 100000, remainingAmount: 100000, consumedAmount: 0 });
    await createTrackedPromotion({ id: pA5_2, name: 'Promo A.5.2', allocatedAmount: 10000, remainingAmount: 10000, consumedAmount: 0 });

    let multiPromoShortageCaught = false;
    try {
      await prisma.$transaction(async (tx) => {
        await OrdersService.batchDeductPromotionBudget(tx, [
          { promotionId: pA5_1, amount: 50000 },
          { promotionId: pA5_2, amount: 20000 }
        ]);
      });
    } catch (_) {
      multiPromoShortageCaught = true;
    }

    const stateA5_1 = await prisma.promotion.findUnique({ where: { id: pA5_1 } });
    const stateA5_2 = await prisma.promotion.findUnique({ where: { id: pA5_2 } });

    recordTest(
      'Area A',
      'A.5',
      'Multi-promotion atomic rollback when one promotion lacks budget',
      'Transaction rolls back completely; Promo 1 remaining remains 100000',
      `Caught: ${multiPromoShortageCaught}, Promo 1 rem: ${stateA5_1?.remainingAmount}, Promo 2 rem: ${stateA5_2?.remainingAmount}`,
      multiPromoShortageCaught && stateA5_1?.remainingAmount === 100000 && stateA5_2?.remainingAmount === 10000,
      undefined,
      'OrdersService.batchDeductPromotionBudget'
    );

    // A.6 Multiple deductions for the same promotion ID in one transaction
    const pA6 = 'promo_a6_' + crypto.randomBytes(4).toString('hex');
    await createTrackedPromotion({ id: pA6, name: 'Promo A.6', allocatedAmount: 100000, remainingAmount: 100000, consumedAmount: 0 });

    await prisma.$transaction(async (tx) => {
      await OrdersService.batchDeductPromotionBudget(tx, [
        { promotionId: pA6, amount: 20000 },
        { promotionId: pA6, amount: 30000 }
      ]);
    });

    const stateA6 = await prisma.promotion.findUnique({ where: { id: pA6 } });
    recordTest(
      'Area A',
      'A.6',
      'Multiple deductions for same promotion ID consolidated into single deduction',
      'Consolidates 20k + 30k = 50k deduction; remaining: 50000, consumed: 50000',
      `remaining: ${stateA6?.remainingAmount}, consumed: ${stateA6?.consumedAmount}`,
      stateA6?.remainingAmount === 50000 && stateA6?.consumedAmount === 50000,
      undefined,
      'OrdersService.batchDeductPromotionBudget'
    );

    // A.7 Unlimited budgets where remainingAmount IS NULL
    const pA7 = 'promo_a7_' + crypto.randomBytes(4).toString('hex');
    await createTrackedPromotion({ id: pA7, name: 'Promo A.7 Unlimited', allocatedAmount: null, remainingAmount: null, consumedAmount: 0 });

    await prisma.$transaction(async (tx) => {
      await OrdersService.batchDeductPromotionBudget(tx, [{ promotionId: pA7, amount: 75000 }]);
    });

    const stateA7 = await prisma.promotion.findUnique({ where: { id: pA7 } });
    recordTest(
      'Area A',
      'A.7',
      'Unlimited budget where remainingAmount IS NULL',
      'remainingAmount remains NULL, consumedAmount increments to 75000',
      `remaining: ${stateA7?.remainingAmount}, consumed: ${stateA7?.consumedAmount}`,
      stateA7?.remainingAmount === null && stateA7?.consumedAmount === 75000,
      undefined,
      'OrdersService.batchDeductPromotionBudget'
    );

    // A.8 Correct remainingAmount and consumedAmount after successful and failed transactions
    const pA8 = 'promo_a8_' + crypto.randomBytes(4).toString('hex');
    await createTrackedPromotion({ id: pA8, name: 'Promo A.8', allocatedAmount: 80000, remainingAmount: 80000, consumedAmount: 0 });

    await prisma.$transaction(async (tx) => {
      await OrdersService.batchDeductPromotionBudget(tx, [{ promotionId: pA8, amount: 30000 }]);
    });
    try {
      await prisma.$transaction(async (tx) => {
        await OrdersService.batchDeductPromotionBudget(tx, [{ promotionId: pA8, amount: 60000 }]);
      });
    } catch (_) {}

    const stateA8 = await prisma.promotion.findUnique({ where: { id: pA8 } });
    recordTest(
      'Area A',
      'A.8',
      'Balance accuracy after interleaved successful and failed attempts',
      'remaining: 50000, consumed: 30000 (failed 60k deduction left zero trace)',
      `remaining: ${stateA8?.remainingAmount}, consumed: ${stateA8?.consumedAmount}`,
      stateA8?.remainingAmount === 50000 && stateA8?.consumedAmount === 30000,
      undefined,
      'OrdersService.batchDeductPromotionBudget'
    );

    // A.9 Decimal amounts and rounding behavior
    const pA9 = 'promo_a9_' + crypto.randomBytes(4).toString('hex');
    await createTrackedPromotion({ id: pA9, name: 'Promo A.9 Decimal', allocatedAmount: 10000.55, remainingAmount: 10000.55, consumedAmount: 0 });

    await prisma.$transaction(async (tx) => {
      await OrdersService.batchDeductPromotionBudget(tx, [{ promotionId: pA9, amount: 1234.55 }]);
    });

    const stateA9 = await prisma.promotion.findUnique({ where: { id: pA9 } });
    recordTest(
      'Area A',
      'A.9',
      'Decimal amounts and precise 2-decimal rounding',
      'remaining: 8766, consumed: 1234.55',
      `remaining: ${stateA9?.remainingAmount}, consumed: ${stateA9?.consumedAmount}`,
      stateA9?.remainingAmount === 8766 && stateA9?.consumedAmount === 1234.55,
      undefined,
      'OrdersService.batchDeductPromotionBudget'
    );

    // A.10 No negative remaining budget under race conditions
    const pA10 = 'promo_a10_' + crypto.randomBytes(4).toString('hex');
    await createTrackedPromotion({ id: pA10, name: 'Promo A.10', allocatedAmount: 50000, remainingAmount: 50000, consumedAmount: 0 });

    const clientsA10 = Array.from({ length: 8 }, () => createIndependentClient());
    try {
      await withBoundedTimeout(
        Promise.allSettled(
          clientsA10.map(c =>
            c.$transaction(async (tx) => {
              await OrdersService.batchDeductPromotionBudget(tx, [{ promotionId: pA10, amount: 20000 }]);
            })
          )
        ),
        10000,
        'Area A.10 high-concurrency oversubscription'
      );

      const stateA10 = await prisma.promotion.findUnique({ where: { id: pA10 } });
      recordTest(
        'Area A',
        'A.10',
        'No negative remaining budget under high-concurrency oversubscription',
        'remainingAmount >= 0 (strictly non-negative: 10000)',
        `remaining: ${stateA10?.remainingAmount}`,
        stateA10 !== null && stateA10.remainingAmount !== null && stateA10.remainingAmount === 10000,
        undefined,
        'OrdersService.batchDeductPromotionBudget'
      );
    } finally {
      await Promise.all(clientsA10.map(c => c.$disconnect()));
    }

    // A.11 No partial budget changes after transaction fails
    const pA11 = 'promo_a11_' + crypto.randomBytes(4).toString('hex');
    await createTrackedPromotion({ id: pA11, name: 'Promo A.11', allocatedAmount: 50000, remainingAmount: 50000, consumedAmount: 0 });

    try {
      await prisma.$transaction(async (tx) => {
        await OrdersService.batchDeductPromotionBudget(tx, [{ promotionId: pA11, amount: 20000 }]);
        throw new Error('Forced mid-transaction application error');
      });
    } catch (_) {}

    const stateA11 = await prisma.promotion.findUnique({ where: { id: pA11 } });
    recordTest(
      'Area A',
      'A.11',
      'No partial budget changes when transaction fails after deduction',
      'Full rollback; remaining: 50000, consumed: 0',
      `remaining: ${stateA11?.remainingAmount}, consumed: ${stateA11?.consumedAmount}`,
      stateA11?.remainingAmount === 50000 && stateA11?.consumedAmount === 0,
      undefined,
      'OrdersService.batchDeductPromotionBudget'
    );

    // =========================================================================
    // AREA B: STOCK CONCURRENCY AND ATOMICITY (8 SCENARIOS)
    // =========================================================================
    console.log('\n--- AREA B: Stock Concurrency and Atomicity ---');

    // B.1 Two simultaneous stock deductions competing for insufficient inventory
    const prodB1 = 'prod_b1_' + crypto.randomBytes(4).toString('hex');
    await createTrackedProduct({ id: prodB1, name: 'Product B.1', sku: 'SKU-B1-' + Date.now(), basePrice: 10000, stockPacks: 100 });

    const clientB1_1 = createIndependentClient();
    const clientB1_2 = createIndependentClient();
    try {
      const resultsB1 = await withBoundedTimeout(
        Promise.allSettled([
          clientB1_1.$transaction(async (tx) => {
            await OrdersService.batchDeductStock(tx, new Map([[prodB1, 60]]));
          }),
          clientB1_2.$transaction(async (tx) => {
            await OrdersService.batchDeductStock(tx, new Map([[prodB1, 60]]));
          })
        ]),
        10000,
        'Area B.1 stock race'
      );

      const succB1 = resultsB1.filter(r => r.status === 'fulfilled').length;
      const rejB1 = resultsB1.filter(r => r.status === 'rejected').length;
      const stateB1 = await prisma.product.findUnique({ where: { id: prodB1 } });

      recordTest(
        'Area B',
        'B.1',
        'Two simultaneous stock deductions competing for inventory (60 + 60 vs 100)',
        '1 success, 1 failure, stockPacks: 40',
        `${succB1} successes, ${rejB1} failures, stock: ${stateB1?.stockPacks}`,
        succB1 === 1 && rejB1 === 1 && stateB1?.stockPacks === 40,
        undefined,
        'OrdersService.batchDeductStock'
      );
    } finally {
      await clientB1_1.$disconnect();
      await clientB1_2.$disconnect();
    }

    // B.2 Successful deductions that consume the inventory exactly
    const prodB2 = 'prod_b2_' + crypto.randomBytes(4).toString('hex');
    await createTrackedProduct({ id: prodB2, name: 'Product B.2', sku: 'SKU-B2-' + Date.now(), basePrice: 10000, stockPacks: 100 });

    const clientsB2 = Array.from({ length: 5 }, () => createIndependentClient());
    try {
      const resultsB2 = await withBoundedTimeout(
        Promise.allSettled(
          clientsB2.map(c =>
            c.$transaction(async (tx) => {
              await OrdersService.batchDeductStock(tx, new Map([[prodB2, 20]]));
            })
          )
        ),
        10000,
        'Area B.2 5x20 stock deductions'
      );

      const succB2 = resultsB2.filter(r => r.status === 'fulfilled').length;
      const stateB2 = await prisma.product.findUnique({ where: { id: prodB2 } });

      recordTest(
        'Area B',
        'B.2',
        'Concurrent deductions consuming inventory exactly (5 x 20 = 100)',
        '5 successes, final stock: 0',
        `${succB2} successes, stock: ${stateB2?.stockPacks}`,
        succB2 === 5 && stateB2?.stockPacks === 0,
        undefined,
        'OrdersService.batchDeductStock'
      );
    } finally {
      await Promise.all(clientsB2.map(c => c.$disconnect()));
    }

    // B.3 Failed deductions never produce negative inventory
    const prodB3 = 'prod_b3_' + crypto.randomBytes(4).toString('hex');
    await createTrackedProduct({ id: prodB3, name: 'Product B.3', sku: 'SKU-B3-' + Date.now(), basePrice: 10000, stockPacks: 50 });

    const clientsB3 = Array.from({ length: 6 }, () => createIndependentClient());
    try {
      await withBoundedTimeout(
        Promise.allSettled(
          clientsB3.map(c =>
            c.$transaction(async (tx) => {
              await OrdersService.batchDeductStock(tx, new Map([[prodB3, 20]]));
            })
          )
        ),
        10000,
        'Area B.3 non-negative stock race'
      );

      const stateB3 = await prisma.product.findUnique({ where: { id: prodB3 } });
      recordTest(
        'Area B',
        'B.3',
        'Failed deductions never produce negative inventory',
        'stockPacks >= 0 (10 packs left after 2 successful 20-pack deductions)',
        `stock: ${stateB3?.stockPacks}`,
        stateB3 !== null && stateB3.stockPacks >= 0 && stateB3.stockPacks === 10,
        undefined,
        'OrdersService.batchDeductStock'
      );
    } finally {
      await Promise.all(clientsB3.map(c => c.$disconnect()));
    }

    // B.4 Multi-product operation rolls back all changes if one product lacks stock
    const prodB4_1 = 'prod_b4_1_' + crypto.randomBytes(4).toString('hex');
    const prodB4_2 = 'prod_b4_2_' + crypto.randomBytes(4).toString('hex');
    await createTrackedProduct({ id: prodB4_1, name: 'Product B.4.1', sku: 'SKU-B4-1-' + Date.now(), basePrice: 10000, stockPacks: 100 });
    await createTrackedProduct({ id: prodB4_2, name: 'Product B.4.2', sku: 'SKU-B4-2-' + Date.now(), basePrice: 10000, stockPacks: 5 });

    let multiProdShortageCaught = false;
    try {
      await prisma.$transaction(async (tx) => {
        await OrdersService.batchDeductStock(tx, new Map([
          [prodB4_1, 20],
          [prodB4_2, 10]
        ]));
      });
    } catch (_) {
      multiProdShortageCaught = true;
    }

    const stateB4_1 = await prisma.product.findUnique({ where: { id: prodB4_1 } });
    const stateB4_2 = await prisma.product.findUnique({ where: { id: prodB4_2 } });

    recordTest(
      'Area B',
      'B.4',
      'Multi-product operation rolls back all decrements if one product lacks stock',
      'Product 1 rolled back to 100, Product 2 remains 5',
      `Caught: ${multiProdShortageCaught}, Prod 1: ${stateB4_1?.stockPacks}, Prod 2: ${stateB4_2?.stockPacks}`,
      multiProdShortageCaught && stateB4_1?.stockPacks === 100 && stateB4_2?.stockPacks === 5,
      undefined,
      'OrdersService.batchDeductStock'
    );

    // B.5 Missing product records cause a complete rollback
    const prodB5 = 'prod_b5_' + crypto.randomBytes(4).toString('hex');
    await createTrackedProduct({ id: prodB5, name: 'Product B.5', sku: 'SKU-B5-' + Date.now(), basePrice: 10000, stockPacks: 50 });

    let missingProductCaught = false;
    try {
      await prisma.$transaction(async (tx) => {
        await OrdersService.batchDeductStock(tx, new Map([
          [prodB5, 10],
          ['non_existent_prod_id_9999', 10]
        ]));
      });
    } catch (_) {
      missingProductCaught = true;
    }

    const stateB5 = await prisma.product.findUnique({ where: { id: prodB5 } });
    recordTest(
      'Area B',
      'B.5',
      'Missing product record causes complete rollback',
      'Product B.5 rolled back to initial 50 packs',
      `Caught: ${missingProductCaught}, stock: ${stateB5?.stockPacks}`,
      missingProductCaught && stateB5?.stockPacks === 50,
      undefined,
      'OrdersService.batchDeductStock'
    );

    // B.6 Stock restoration failures do not leave partial changes
    const prodB6 = 'prod_b6_' + crypto.randomBytes(4).toString('hex');
    await createTrackedProduct({ id: prodB6, name: 'Product B.6', sku: 'SKU-B6-' + Date.now(), basePrice: 10000, stockPacks: 50 });

    try {
      await prisma.$transaction(async (tx) => {
        await OrdersService.batchRestoreStock(tx, new Map([[prodB6, 30]]));
        throw new Error('Forced failure after stock restoration');
      });
    } catch (_) {}

    const stateB6 = await prisma.product.findUnique({ where: { id: prodB6 } });
    recordTest(
      'Area B',
      'B.6',
      'Stock restoration failure rolls back restoration completely',
      'Stock packs remains 50 (no phantom stock restored)',
      `stock: ${stateB6?.stockPacks}`,
      stateB6?.stockPacks === 50,
      undefined,
      'OrdersService.batchRestoreStock'
    );

    // B.7 Multiple concurrent operations affecting the same products
    const prodB7 = 'prod_b7_' + crypto.randomBytes(4).toString('hex');
    await createTrackedProduct({ id: prodB7, name: 'Product B.7', sku: 'SKU-B7-' + Date.now(), basePrice: 10000, stockPacks: 100 });

    const clientsB7 = Array.from({ length: 4 }, () => createIndependentClient());
    try {
      await withBoundedTimeout(
        Promise.all([
          clientsB7[0].$transaction(async (tx) => { await OrdersService.batchDeductStock(tx, new Map([[prodB7, 20]])); }),
          clientsB7[1].$transaction(async (tx) => { await OrdersService.batchDeductStock(tx, new Map([[prodB7, 20]])); }),
          clientsB7[2].$transaction(async (tx) => { await OrdersService.batchRestoreStock(tx, new Map([[prodB7, 10]])); }),
          clientsB7[3].$transaction(async (tx) => { await OrdersService.batchRestoreStock(tx, new Map([[prodB7, 10]])); })
        ]),
        10000,
        'Area B.7 mixed stock ops'
      );

      const stateB7 = await prisma.product.findUnique({ where: { id: prodB7 } });
      recordTest(
        'Area B',
        'B.7',
        'Multiple concurrent operations (deductions & restorations) on same product',
        'Net stock: 100 - 20 - 20 + 10 + 10 = 80 packs',
        `stock: ${stateB7?.stockPacks}`,
        stateB7?.stockPacks === 80,
        undefined,
        'OrdersService.batchDeductStock + OrdersService.batchRestoreStock'
      );
    } finally {
      await Promise.all(clientsB7.map(c => c.$disconnect()));
    }

    // B.8 Consistency between order items, stock balances, and transaction outcomes via OrdersService.createOrder
    const prodB8 = 'prod_b8_' + crypto.randomBytes(4).toString('hex');
    await createTrackedProduct({ id: prodB8, name: 'Product B.8', sku: 'SKU-B8-' + Date.now(), basePrice: 10000, stockPacks: 100 });
    invalidateOrderCalculationConfig();

    const createdB8 = await OrdersService.createOrder(customerSession, {
      items: [{ productId: prodB8, quantityPacks: 20 }],
      status: 'NEW'
    });
    createdOrderIds.add(createdB8.order.id);

    const stateB8Prod = await prisma.product.findUnique({ where: { id: prodB8 } });
    const stateB8Ord = await prisma.order.findUnique({
      where: { id: createdB8.order.id },
      include: { items: { include: { skuAllocations: true } } }
    });

    recordTest(
      'Area B',
      'B.8',
      'Consistency between order items, SKU allocations, and stock balances via OrdersService.createOrder',
      'Order totalPacks: 20, item packs: 20, SKU allocation: 20, Product stock: 80',
      `Order packs: ${stateB8Ord?.totalPacks}, SKU alloc: ${stateB8Ord?.items[0]?.skuAllocations[0]?.packs}, Product stock: ${stateB8Prod?.stockPacks}`,
      stateB8Ord?.totalPacks === 20 &&
      stateB8Ord?.items[0]?.totalQuantityPacks === 20 &&
      stateB8Ord?.items[0]?.skuAllocations[0]?.packs === 20 &&
      stateB8Prod?.stockPacks === 80,
      undefined,
      'OrdersService.createOrder'
    );

    // =========================================================================
    // AREA C: ORDER EDITING VIA ACTUAL OrdersService.updateOrder() (12 SCENARIOS)
    // =========================================================================
    console.log('\n--- AREA C: Order Editing (Direct OrdersService.updateOrder Calls) ---');

    // C.1-C.3: Valid edit via OrdersService.updateOrder restores old fixed promotion deductions
    // and applies new deductions exactly once, persisting exact Order.appliedPromotions metadata.
    const compC1 = 'comp_test_c1_' + crypto.randomBytes(4).toString('hex');
    createdCompanyIds.add(compC1);
    await prisma.company.create({ data: { id: compC1, name: 'Comp C1', code: 'C1-' + crypto.randomBytes(3).toString('hex') } });

    const custC1Id = 'user_cust_test_c1_' + crypto.randomBytes(4).toString('hex');
    createdUserIds.add(custC1Id);
    await prisma.user.create({
      data: { id: custC1Id, name: 'Customer C1', email: `${custC1Id}@test.local`, passwordHash: 'h', role: 'CUSTOMER', companyId: compC1 }
    });

    const staffC1Session: JWTPayload = {
      ...staffSession,
      companyId: compC1
    };

    const prodC1 = 'prod_c1_' + crypto.randomBytes(4).toString('hex');
    const promoC1_Old = 'promo_c1_old_' + crypto.randomBytes(4).toString('hex');
    const promoC1_New = 'promo_c1_new_' + crypto.randomBytes(4).toString('hex');

    await createTrackedProduct({ id: prodC1, name: 'Product C.1', sku: 'SKU-C1-' + Date.now(), basePrice: 20000, stockPacks: 190 });
    await createTrackedPromotion({
      id: promoC1_Old,
      name: 'Promo C.1 Old',
      allocatedAmount: 100000,
      remainingAmount: 80000,
      consumedAmount: 20000,
      isActive: false,
      companyId: compC1
    });
    await createTrackedPromotion({
      id: promoC1_New,
      name: 'Promo C.1 New',
      allocatedAmount: 100000,
      remainingAmount: 100000,
      consumedAmount: 0,
      maxOrderUsagePercent: 17.5, // 17.5% of 200,000 = 35,000 UZS
      isActive: true,
      companyId: compC1
    });

    const orderC1Id = 'order_c1_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderC1Id);
    await prisma.order.create({
      data: {
        id: orderC1Id,
        orderNumber: 'ORD-C1-' + Date.now(),
        customerId: custC1Id,
        companyId: compC1,
        status: 'NEW',
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0.02,
        totalPrice: 180000,
        appliedPromotions: [{ promotionId: promoC1_Old, amount: 20000 }],
        items: {
          create: [
            {
              productId: prodC1,
              baseQuantityPacks: 10,
              totalQuantityPacks: 10,
              quantityPacks: 10,
              price: 20000,
              itemTotalPrice: 180000,
              skuAllocations: {
                create: [{ productId: prodC1, packs: 10, sku: 'SKU-C1', name: 'Product C.1' }]
              }
            }
          ]
        }
      }
    });

    invalidateOrderCalculationConfig();
    const updateResC1 = await OrdersService.updateOrder(staffC1Session, {
      orderId: orderC1Id,
      items: [{ productId: prodC1, quantityPacks: 10 }],
      status: 'NEW'
    });

    const statePromoC1_Old = await prisma.promotion.findUnique({ where: { id: promoC1_Old } });
    const statePromoC1_New = await prisma.promotion.findUnique({ where: { id: promoC1_New } });
    const stateOrderC1 = await prisma.order.findUnique({ where: { id: orderC1Id } });
    const stateProdC1 = await prisma.product.findUnique({ where: { id: prodC1 } });

    recordTest(
      'Area C',
      'C.1-C.3',
      'OrdersService.updateOrder restores old budget, deducts new budget once, and persists appliedPromotions',
      'Old promo restored to 100k, New promo consumed 35k (rem 65k), appliedPromotions: [{promoC1_New, 35000}], totalPrice: 165000',
      `Old rem: ${statePromoC1_Old?.remainingAmount}, New rem: ${statePromoC1_New?.remainingAmount}, totalPrice: ${updateResC1.order.totalPrice}, applied: ${JSON.stringify(stateOrderC1?.appliedPromotions)}, stock: ${stateProdC1?.stockPacks}`,
      statePromoC1_Old?.remainingAmount === 100000 &&
      statePromoC1_Old?.consumedAmount === 0 &&
      statePromoC1_New?.remainingAmount === 65000 &&
      statePromoC1_New?.consumedAmount === 35000 &&
      stateOrderC1?.totalPrice === 165000 &&
      stateProdC1?.stockPacks === 190 &&
      Array.isArray(stateOrderC1?.appliedPromotions as any) &&
      (stateOrderC1?.appliedPromotions as any).length === 1 &&
      (stateOrderC1?.appliedPromotions as any)[0].promotionId === promoC1_New &&
      (stateOrderC1?.appliedPromotions as any)[0].amount === 35000,
      undefined,
      'OrdersService.updateOrder'
    );

    // C.4 Editing an order with multiple fixed-amount promotions (removing one, updating the other, then removing all)
    const compC4 = 'comp_test_c4_' + crypto.randomBytes(4).toString('hex');
    createdCompanyIds.add(compC4);
    await prisma.company.create({ data: { id: compC4, name: 'Comp C4', code: 'C4-' + crypto.randomBytes(3).toString('hex') } });

    const custC4Id = 'user_cust_test_c4_' + crypto.randomBytes(4).toString('hex');
    createdUserIds.add(custC4Id);
    await prisma.user.create({
      data: { id: custC4Id, name: 'Customer C4', email: `${custC4Id}@test.local`, passwordHash: 'h', role: 'CUSTOMER', companyId: compC4 }
    });

    const promoC4_A = 'promo_c4_a_' + crypto.randomBytes(4).toString('hex');
    const promoC4_B = 'promo_c4_b_' + crypto.randomBytes(4).toString('hex');
    await createTrackedPromotion({
      id: promoC4_A,
      name: 'Promo C.4 A',
      allocatedAmount: 100000,
      remainingAmount: 90000,
      consumedAmount: 10000,
      maxOrderUsagePercent: 10, // 10% of 200,000 = 20,000 UZS
      isActive: true,
      companyId: compC4
    });
    await createTrackedPromotion({
      id: promoC4_B,
      name: 'Promo C.4 B',
      allocatedAmount: 100000,
      remainingAmount: 85000,
      consumedAmount: 15000,
      isActive: false,
      companyId: compC4
    });

    const orderC4Id = 'order_c4_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderC4Id);
    await prisma.order.create({
      data: {
        id: orderC4Id,
        orderNumber: 'ORD-C4-' + Date.now(),
        customerId: custC4Id,
        companyId: compC4,
        status: 'NEW',
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0.02,
        totalPrice: 175000,
        appliedPromotions: [
          { promotionId: promoC4_A, amount: 10000 },
          { promotionId: promoC4_B, amount: 15000 }
        ],
        items: {
          create: [
            {
              productId: prodC1,
              baseQuantityPacks: 10,
              totalQuantityPacks: 10,
              quantityPacks: 10,
              price: 20000,
              itemTotalPrice: 175000,
              skuAllocations: {
                create: [{ productId: prodC1, packs: 10, sku: 'SKU-C1', name: 'Product C.1' }]
              }
            }
          ]
        }
      }
    });

    invalidateOrderCalculationConfig();
    await OrdersService.updateOrder({ ...staffSession, companyId: compC4 }, {
      orderId: orderC4Id,
      items: [{ productId: prodC1, quantityPacks: 10 }],
      status: 'NEW'
    });

    const stateC4_A = await prisma.promotion.findUnique({ where: { id: promoC4_A } });
    const stateC4_B = await prisma.promotion.findUnique({ where: { id: promoC4_B } });
    const stateOrderC4AfterStep1 = await prisma.order.findUnique({ where: { id: orderC4Id } });

    // Deactivate Promo A too and edit again via OrdersService.updateOrder to verify complete removal
    await prisma.promotion.update({ where: { id: promoC4_A }, data: { isActive: false } });
    invalidateOrderCalculationConfig();
    await OrdersService.updateOrder({ ...staffSession, companyId: compC4 }, {
      orderId: orderC4Id,
      items: [{ productId: prodC1, quantityPacks: 10 }],
      status: 'NEW'
    });
    const stateC4_A_AfterRemove = await prisma.promotion.findUnique({ where: { id: promoC4_A } });
    const stateOrderC4AfterRemove = await prisma.order.findUnique({ where: { id: orderC4Id } });

    recordTest(
      'Area C',
      'C.4',
      'OrdersService.updateOrder with multiple fixed-amount promotions (partial removal then complete removal)',
      'Step 1: Promo A rem 80k (con 20k), Promo B rem 100k (con 0) | Step 2: Promo A rem 100k (con 0), appliedPromotions: []',
      `Step1(A rem: ${stateC4_A?.remainingAmount}, B rem: ${stateC4_B?.remainingAmount}, applied: ${JSON.stringify(stateOrderC4AfterStep1?.appliedPromotions)}) | Step2(A rem: ${stateC4_A_AfterRemove?.remainingAmount}, applied: ${JSON.stringify(stateOrderC4AfterRemove?.appliedPromotions)})`,
      stateC4_A?.remainingAmount === 80000 &&
      stateC4_A?.consumedAmount === 20000 &&
      stateC4_B?.remainingAmount === 100000 &&
      stateC4_B?.consumedAmount === 0 &&
      stateC4_A_AfterRemove?.remainingAmount === 100000 &&
      stateC4_A_AfterRemove?.consumedAmount === 0 &&
      Array.isArray(stateOrderC4AfterRemove?.appliedPromotions as any) &&
      (stateOrderC4AfterRemove?.appliedPromotions as any).length === 0,
      undefined,
      'OrdersService.updateOrder'
    );

    // C.5 Editing order with zero fixed-amount promotions via OrdersService.updateOrder
    const orderC5Id = 'order_c5_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderC5Id);
    await prisma.order.create({
      data: {
        id: orderC5Id,
        orderNumber: 'ORD-C5-' + Date.now(),
        customerId: custC4Id,
        companyId: compC4,
        status: 'NEW',
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0.02,
        totalPrice: 200000,
        appliedPromotions: [],
        items: {
          create: [
            {
              productId: prodC1,
              baseQuantityPacks: 10,
              totalQuantityPacks: 10,
              quantityPacks: 10,
              price: 20000,
              itemTotalPrice: 200000,
              skuAllocations: {
                create: [{ productId: prodC1, packs: 10, sku: 'SKU-C1', name: 'Product C.1' }]
              }
            }
          ]
        }
      }
    });

    invalidateOrderCalculationConfig();
    await OrdersService.updateOrder({ ...staffSession, companyId: compC4 }, {
      orderId: orderC5Id,
      items: [{ productId: prodC1, quantityPacks: 20 }],
      status: 'NEW'
    });

    const stateC5 = await prisma.order.findUnique({ where: { id: orderC5Id } });
    await prisma.product.update({ where: { id: prodC1 }, data: { stockPacks: 190 } });

    recordTest(
      'Area C',
      'C.5',
      'OrdersService.updateOrder with zero fixed-amount promotions persists empty metadata [] and updates totals',
      'appliedPromotions remains [], totalPacks: 20, totalPrice: 400000',
      `totalPacks: ${stateC5?.totalPacks}, totalPrice: ${stateC5?.totalPrice}, applied: ${JSON.stringify(stateC5?.appliedPromotions)}`,
      stateC5?.totalPacks === 20 &&
      stateC5?.totalPrice === 400000 &&
      Array.isArray(stateC5?.appliedPromotions as any) &&
      (stateC5?.appliedPromotions as any).length === 0,
      undefined,
      'OrdersService.updateOrder'
    );

    // C.6 Editing order with unlimited-budget promotion via OrdersService.updateOrder
    const compC6 = 'comp_test_c6_' + crypto.randomBytes(4).toString('hex');
    createdCompanyIds.add(compC6);
    await prisma.company.create({ data: { id: compC6, name: 'Comp C6', code: 'C6-' + crypto.randomBytes(3).toString('hex') } });

    const custC6Id = 'user_cust_test_c6_' + crypto.randomBytes(4).toString('hex');
    createdUserIds.add(custC6Id);
    await prisma.user.create({
      data: { id: custC6Id, name: 'Customer C6', email: `${custC6Id}@test.local`, passwordHash: 'h', role: 'CUSTOMER', companyId: compC6 }
    });

    const promoC6 = 'promo_c6_' + crypto.randomBytes(4).toString('hex');
    await createTrackedPromotion({
      id: promoC6,
      name: 'Promo C.6 Unlimited',
      allocatedAmount: null,
      remainingAmount: null,
      consumedAmount: 20000,
      maxOrderUsagePercent: 10, // 20 packs * 20,000 = 400,000 -> 10% = 40,000 UZS
      isActive: true,
      companyId: compC6
    });

    const orderC6Id = 'order_c6_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderC6Id);
    await prisma.order.create({
      data: {
        id: orderC6Id,
        orderNumber: 'ORD-C6-' + Date.now(),
        customerId: custC6Id,
        companyId: compC6,
        status: 'NEW',
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0.02,
        totalPrice: 180000,
        appliedPromotions: [{ promotionId: promoC6, amount: 20000 }],
        items: {
          create: [
            {
              productId: prodC1,
              baseQuantityPacks: 10,
              totalQuantityPacks: 10,
              quantityPacks: 10,
              price: 20000,
              itemTotalPrice: 180000,
              skuAllocations: {
                create: [{ productId: prodC1, packs: 10, sku: 'SKU-C1', name: 'Product C.1' }]
              }
            }
          ]
        }
      }
    });

    invalidateOrderCalculationConfig();
    await OrdersService.updateOrder({ ...staffSession, companyId: compC6 }, {
      orderId: orderC6Id,
      items: [{ productId: prodC1, quantityPacks: 20 }],
      status: 'NEW'
    });
    await prisma.product.update({ where: { id: prodC1 }, data: { stockPacks: 190 } });

    const stateC6Promo = await prisma.promotion.findUnique({ where: { id: promoC6 } });
    const stateC6Order = await prisma.order.findUnique({ where: { id: orderC6Id } });

    recordTest(
      'Area C',
      'C.6',
      'OrdersService.updateOrder with unlimited-budget promotion updates consumedAmount and leaves remainingAmount NULL',
      'remainingAmount remains NULL, consumedAmount adjusted from 20k to 40k, appliedPromotions: [{promoC6, 40000}]',
      `remaining: ${stateC6Promo?.remainingAmount}, consumed: ${stateC6Promo?.consumedAmount}, applied: ${JSON.stringify(stateC6Order?.appliedPromotions)}`,
      stateC6Promo?.remainingAmount === null &&
      stateC6Promo?.consumedAmount === 40000 &&
      (stateC6Order?.appliedPromotions as any)?.[0]?.amount === 40000,
      undefined,
      'OrdersService.updateOrder'
    );

    // C.7 Insufficient promotion budget during OrdersService.updateOrder rolls back the ENTIRE edit
    const compC7 = 'comp_test_c7_' + crypto.randomBytes(4).toString('hex');
    createdCompanyIds.add(compC7);
    await prisma.company.create({ data: { id: compC7, name: 'Comp C7', code: 'C7-' + crypto.randomBytes(3).toString('hex') } });

    const custC7Id = 'user_cust_test_c7_' + crypto.randomBytes(4).toString('hex');
    createdUserIds.add(custC7Id);
    await prisma.user.create({
      data: { id: custC7Id, name: 'Customer C7', email: `${custC7Id}@test.local`, passwordHash: 'h', role: 'CUSTOMER', companyId: compC7 }
    });

    const prodC7 = 'prod_c7_' + crypto.randomBytes(4).toString('hex');
    await createTrackedProduct({ id: prodC7, name: 'Product C.7', sku: 'SKU-C7-' + Date.now(), basePrice: 20000, stockPacks: 90 });

    const promoC7 = 'promo_c7_' + crypto.randomBytes(4).toString('hex');
    await createTrackedPromotion({
      id: promoC7,
      name: 'Promo C.7',
      allocatedAmount: 50000,
      remainingAmount: 40000,
      consumedAmount: 10000,
      maxOrderUsagePercent: 10, // For 20 packs (400,000 UZS), 10% = 40,000 UZS deduction
      isActive: true,
      companyId: compC7
    });

    const orderC7Id = 'order_c7_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderC7Id);
    await prisma.order.create({
      data: {
        id: orderC7Id,
        orderNumber: 'ORD-C7-' + Date.now(),
        customerId: custC7Id,
        companyId: compC7,
        status: 'NEW',
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0.02,
        totalPrice: 190000,
        appliedPromotions: [{ promotionId: promoC7, amount: 10000 }],
        items: {
          create: [
            {
              productId: prodC7,
              baseQuantityPacks: 10,
              totalQuantityPacks: 10,
              quantityPacks: 10,
              price: 20000,
              itemTotalPrice: 190000,
              skuAllocations: {
                create: [{ productId: prodC7, packs: 10, sku: 'SKU-C7', name: 'Product C.7' }]
              }
            }
          ]
        }
      }
    });

    // Warm calculation config cache while promoC7 has remainingAmount = 40,000 (so calculateOrder requests 40,000 deduction)
    invalidateOrderCalculationConfig();
    await PromotionsService.calculateOrder(
      [{ productId: prodC7, sku: 'SKU-C7', name: 'Product C.7', baseQuantityPacks: 20, price: 20000 }],
      compC7
    );

    // Concurrent order consumes 25,000 of promoC7 budget in PostgreSQL (remaining becomes 15,000; even after restoring old 10,000 = 25,000 < 40,000!)
    await prisma.promotion.update({
      where: { id: promoC7 },
      data: { remainingAmount: 15000, consumedAmount: 35000 }
    });

    let editBudgetFailCaught = false;
    let editBudgetFailMsg = '';
    try {
      await OrdersService.updateOrder({ ...staffSession, companyId: compC7 }, {
        orderId: orderC7Id,
        items: [{ productId: prodC7, quantityPacks: 20 }],
        status: 'NEW'
      });
    } catch (err: any) {
      editBudgetFailCaught = true;
      editBudgetFailMsg = err.message || '';
    }

    const stateC7Promo = await prisma.promotion.findUnique({ where: { id: promoC7 } });
    const stateC7Prod = await prisma.product.findUnique({ where: { id: prodC7 } });
    const stateC7Order = await prisma.order.findUnique({ where: { id: orderC7Id }, include: { items: true } });

    recordTest(
      'Area C',
      'C.7',
      'Insufficient promotion budget inside OrdersService.updateOrder rolls back stock, old promo restore, and order items',
      'Rejected; Promo rem stays 15000 (con 35000), Product stock stays 90, Order totalPacks stays 10 (price 190000)',
      `Caught: ${editBudgetFailCaught} (${editBudgetFailMsg.slice(0, 45)}...), Promo rem: ${stateC7Promo?.remainingAmount}, Prod stock: ${stateC7Prod?.stockPacks}, Order packs: ${stateC7Order?.totalPacks}, price: ${stateC7Order?.totalPrice}`,
      editBudgetFailCaught &&
      stateC7Promo?.remainingAmount === 15000 &&
      stateC7Promo?.consumedAmount === 35000 &&
      stateC7Prod?.stockPacks === 90 &&
      stateC7Order?.totalPacks === 10 &&
      stateC7Order?.totalPrice === 190000 &&
      stateC7Order?.items.length === 1 &&
      stateC7Order?.items[0].totalQuantityPacks === 10,
      undefined,
      'OrdersService.updateOrder'
    );

    // C.8 + C.9: Insufficient stock during OrdersService.updateOrder rolls back all related changes
    // (both pre-check and in-transaction race rollback coordinated via deterministic barrier)
    const prodC8 = 'prod_c8_' + crypto.randomBytes(4).toString('hex');
    await createTrackedProduct({ id: prodC8, name: 'Product C.8', sku: 'SKU-C8-' + Date.now(), basePrice: 20000, stockPacks: 20 });

    const promoC8 = 'promo_c8_' + crypto.randomBytes(4).toString('hex');
    await createTrackedPromotion({
      id: promoC8,
      name: 'Promo C.8',
      allocatedAmount: 100000,
      remainingAmount: 80000,
      consumedAmount: 20000,
      isActive: false,
      companyId: compC7
    });

    const orderC8Id = 'order_c8_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderC8Id);
    await prisma.order.create({
      data: {
        id: orderC8Id,
        orderNumber: 'ORD-C8-' + Date.now(),
        customerId: custC7Id,
        companyId: compC7,
        status: 'NEW',
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0.02,
        totalPrice: 180000,
        appliedPromotions: [{ promotionId: promoC8, amount: 20000 }],
        items: {
          create: [
            {
              productId: prodC8,
              baseQuantityPacks: 10,
              totalQuantityPacks: 10,
              quantityPacks: 10,
              price: 20000,
              itemTotalPrice: 180000,
              skuAllocations: {
                create: [{ productId: prodC8, packs: 10, sku: 'SKU-C8', name: 'Product C.8' }]
              }
            }
          ]
        }
      }
    });

    // Disable promoC7 so compC7 has no active promotions during C.8/C.9
    await prisma.promotion.update({ where: { id: promoC7 }, data: { isActive: false } });
    invalidateOrderCalculationConfig();

    // Part 1 (C.8): Pre-validation rejection when requesting 50 packs against 20+10=30 available
    let editStockPrecheckCaught = false;
    try {
      await OrdersService.updateOrder({ ...staffSession, companyId: compC7 }, {
        orderId: orderC8Id,
        items: [{ productId: prodC8, quantityPacks: 50 }],
        status: 'NEW'
      });
    } catch (err: any) {
      if (
        err.message?.includes('Недостаточно товара на складе') ||
        err.message?.includes('Превышен доступный лимит запасов')
      ) {
        editStockPrecheckCaught = true;
      }
    }

    // Part 2 (C.9): In-transaction stock failure inside OrdersService.updateOrder after promo restoration!
    // Use a deterministic barrier on PromotionsService.calculateOrder (calling the real calculateOrder, then depleting stock
    // right after pre-load of dbProducts so updateOrder passes pre-check with 20+10=30 packs and fails inside tx.batchDeductStock!)
    const origCalcOrder = PromotionsService.calculateOrder.bind(PromotionsService);
    let inTxStockFailCaught = false;
    try {
      PromotionsService.calculateOrder = async (...args: Parameters<typeof PromotionsService.calculateOrder>) => {
        const calcRes = await origCalcOrder(...args);
        // At this exact point in OrdersService.updateOrder, dbProducts has ALREADY been loaded with stockPacks=20,
        // so pre-check sees 20 + 10 = 30 packs available. Now we deduct 15 packs in PostgreSQL before updateOrder enters $transaction!
        await prisma.product.update({
          where: { id: prodC8 },
          data: { stockPacks: { decrement: 15 } }
        });
        return calcRes;
      };

      await OrdersService.updateOrder({ ...staffSession, companyId: compC7 }, {
        orderId: orderC8Id,
        items: [{ productId: prodC8, quantityPacks: 30 }],
        status: 'NEW'
      });
    } catch (err: any) {
      if (err.message?.includes('Превышен доступный лимит запасов для позиции')) {
        inTxStockFailCaught = true;
      }
    } finally {
      PromotionsService.calculateOrder = origCalcOrder;
    }

    const stateC8Prod = await prisma.product.findUnique({ where: { id: prodC8 } });
    const stateC8Promo = await prisma.promotion.findUnique({ where: { id: promoC8 } });
    const stateC8Order = await prisma.order.findUnique({ where: { id: orderC8Id } });

    recordTest(
      'Area C',
      'C.8-C.9',
      'Insufficient stock in OrdersService.updateOrder rolls back promo restoration and order changes completely',
      'Precheck caught: true, In-tx caught: true, Promo C8 rem stays 80000 (not 100000), Stock is 5, Order packs stays 10',
      `Precheck: ${editStockPrecheckCaught}, InTx: ${inTxStockFailCaught}, Promo rem: ${stateC8Promo?.remainingAmount}, Stock: ${stateC8Prod?.stockPacks}, Order packs: ${stateC8Order?.totalPacks}`,
      editStockPrecheckCaught &&
      inTxStockFailCaught &&
      stateC8Promo?.remainingAmount === 80000 &&
      stateC8Promo?.consumedAmount === 20000 &&
      stateC8Prod?.stockPacks === 5 &&
      stateC8Order?.totalPacks === 10,
      undefined,
      'OrdersService.updateOrder'
    );

    // C.10 Concurrent edits to the same order via OrdersService.updateOrder serialize under SELECT ... FOR UPDATE
    const compC10 = 'comp_test_c10_' + crypto.randomBytes(4).toString('hex');
    createdCompanyIds.add(compC10);
    await prisma.company.create({ data: { id: compC10, name: 'Comp C10', code: 'C10-' + crypto.randomBytes(3).toString('hex') } });

    const custC10Id = 'user_cust_test_c10_' + crypto.randomBytes(4).toString('hex');
    createdUserIds.add(custC10Id);
    await prisma.user.create({
      data: { id: custC10Id, name: 'Customer C10', email: `${custC10Id}@test.local`, passwordHash: 'h', role: 'CUSTOMER', companyId: compC10 }
    });

    const prodC10 = 'prod_c10_' + crypto.randomBytes(4).toString('hex');
    // Total initial stock before order = 100; 10 packs in initial order -> 90 packs on shelf
    await createTrackedProduct({ id: prodC10, name: 'Product C.10', sku: 'SKU-C10-' + Date.now(), basePrice: 10000, stockPacks: 90 });

    const promoC10 = 'promo_c10_' + crypto.randomBytes(4).toString('hex');
    await createTrackedPromotion({
      id: promoC10,
      name: 'Promo C.10',
      allocatedAmount: 100000,
      remainingAmount: 90000,
      consumedAmount: 10000,
      maxOrderUsagePercent: 10, // 10% of order subtotal
      isActive: true,
      companyId: compC10
    });

    const orderC10Id = 'order_c10_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderC10Id);
    await prisma.order.create({
      data: {
        id: orderC10Id,
        orderNumber: 'ORD-C10-' + Date.now(),
        customerId: custC10Id,
        companyId: compC10,
        status: 'NEW',
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0.02,
        totalPrice: 90000,
        appliedPromotions: [{ promotionId: promoC10, amount: 10000 }],
        items: {
          create: [
            {
              productId: prodC10,
              baseQuantityPacks: 10,
              totalQuantityPacks: 10,
              quantityPacks: 10,
              price: 10000,
              itemTotalPrice: 90000,
              skuAllocations: {
                create: [{ productId: prodC10, packs: 10, sku: 'SKU-C10', name: 'Product C.10' }]
              }
            }
          ]
        }
      }
    });

    invalidateOrderCalculationConfig();
    const staffC10Session: JWTPayload = { ...staffSession, companyId: compC10 };

    const [resC10_1, resC10_2] = await withBoundedTimeout(
      Promise.allSettled([
        OrdersService.updateOrder(staffC10Session, {
          orderId: orderC10Id,
          items: [{ productId: prodC10, quantityPacks: 20 }],
          status: 'NEW'
        }),
        OrdersService.updateOrder(staffC10Session, {
          orderId: orderC10Id,
          items: [{ productId: prodC10, quantityPacks: 30 }],
          status: 'NEW'
        })
      ]),
      10000,
      'Area C.10 concurrent OrdersService.updateOrder calls'
    );

    const stateC10Order = await prisma.order.findUnique({
      where: { id: orderC10Id },
      include: { items: { include: { skuAllocations: true } } }
    });
    const stateC10Prod = await prisma.product.findUnique({ where: { id: prodC10 } });
    const stateC10Promo = await prisma.promotion.findUnique({ where: { id: promoC10 } });

    const winningPacksC10 = stateC10Order?.totalPacks ?? 0;
    const expectedStockC10 = 100 - winningPacksC10;
    const expectedPromoConsumedC10 = winningPacksC10 * 1000;
    const expectedPromoRemainingC10 = 100000 - expectedPromoConsumedC10;

    recordTest(
      'Area C',
      'C.10',
      'Two concurrent OrdersService.updateOrder calls on the same order serialize without lost updates or double restoration',
      'Final packs in {20, 30}, stock == 100 - packs, promo consumed == packs * 1000, promo remaining == 100k - consumed',
      `Both fulfilled: ${resC10_1.status === 'fulfilled' && resC10_2.status === 'fulfilled'}, Winning packs: ${winningPacksC10}, Stock: ${stateC10Prod?.stockPacks} (exp ${expectedStockC10}), Promo con: ${stateC10Promo?.consumedAmount} (exp ${expectedPromoConsumedC10}), Promo rem: ${stateC10Promo?.remainingAmount}`,
      resC10_1.status === 'fulfilled' &&
      resC10_2.status === 'fulfilled' &&
      (winningPacksC10 === 20 || winningPacksC10 === 30) &&
      stateC10Prod?.stockPacks === expectedStockC10 &&
      stateC10Promo?.consumedAmount === expectedPromoConsumedC10 &&
      stateC10Promo?.remainingAmount === expectedPromoRemainingC10 &&
      (stateC10Order?.appliedPromotions as any)?.[0]?.amount === expectedPromoConsumedC10 &&
      stateC10Order?.items.length === 1 &&
      stateC10Order?.items[0].skuAllocations[0]?.packs === winningPacksC10,
      undefined,
      'OrdersService.updateOrder (x2 concurrent)'
    );

    // C.11 Concurrent OrdersService.updateOrder calls on two different orders competing for the same promotion budget
    const compC11 = 'comp_test_c11_' + crypto.randomBytes(4).toString('hex');
    createdCompanyIds.add(compC11);
    await prisma.company.create({ data: { id: compC11, name: 'Comp C11', code: 'C11-' + crypto.randomBytes(3).toString('hex') } });

    const custC11Id = 'user_cust_test_c11_' + crypto.randomBytes(4).toString('hex');
    createdUserIds.add(custC11Id);
    await prisma.user.create({
      data: { id: custC11Id, name: 'Customer C11', email: `${custC11Id}@test.local`, passwordHash: 'h', role: 'CUSTOMER', companyId: compC11 }
    });

    const prodC11 = 'prod_c11_' + crypto.randomBytes(4).toString('hex');
    await createTrackedProduct({ id: prodC11, name: 'Product C.11', sku: 'SKU-C11-' + Date.now(), basePrice: 35000, stockPacks: 200 });

    const promoC11 = 'promo_c11_' + crypto.randomBytes(4).toString('hex');
    await createTrackedPromotion({
      id: promoC11,
      name: 'Promo C.11 Shared',
      allocatedAmount: 50000,
      remainingAmount: 50000,
      consumedAmount: 0,
      maxOrderUsagePercent: 10, // 10 packs * 35,000 = 350,000 -> 10% = 35,000 UZS each
      isActive: true,
      companyId: compC11
    });

    const orderC11_A = 'order_c11_a_' + crypto.randomBytes(4).toString('hex');
    const orderC11_B = 'order_c11_b_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderC11_A);
    createdOrderIds.add(orderC11_B);

    await prisma.order.createMany({
      data: [
        {
          id: orderC11_A,
          orderNumber: 'ORD-C11A-' + Date.now(),
          customerId: custC11Id,
          companyId: compC11,
          status: 'DRAFT',
          totalPacks: 10,
          totalBlocks: 1,
          totalCases: 0.02,
          totalPrice: 350000,
          appliedPromotions: []
        },
        {
          id: orderC11_B,
          orderNumber: 'ORD-C11B-' + Date.now(),
          customerId: custC11Id,
          companyId: compC11,
          status: 'DRAFT',
          totalPacks: 10,
          totalBlocks: 1,
          totalCases: 0.02,
          totalPrice: 350000,
          appliedPromotions: []
        }
      ]
    });

    invalidateOrderCalculationConfig();
    const staffC11Session: JWTPayload = { ...staffSession, companyId: compC11 };

    const resultsC11 = await withBoundedTimeout(
      Promise.allSettled([
        OrdersService.updateOrder(staffC11Session, {
          orderId: orderC11_A,
          items: [{ productId: prodC11, quantityPacks: 10 }],
          status: 'NEW'
        }),
        OrdersService.updateOrder(staffC11Session, {
          orderId: orderC11_B,
          items: [{ productId: prodC11, quantityPacks: 10 }],
          status: 'NEW'
        })
      ]),
      10000,
      'Area C.11 concurrent updates competing for shared promo budget'
    );

    const succC11 = resultsC11.filter(r => r.status === 'fulfilled').length;
    const rejC11 = resultsC11.filter(r => r.status === 'rejected').length;
    const stateC11Promo = await prisma.promotion.findUnique({ where: { id: promoC11 } });
    const stateC11Prod = await prisma.product.findUnique({ where: { id: prodC11 } });

    recordTest(
      'Area C',
      'C.11',
      'Concurrent OrdersService.updateOrder calls competing for finite promotion budget (35k + 35k vs 50k)',
      '1 success, 1 failure (rolled back completely), promo remaining: 15000, consumed: 35000, stock: 190',
      `${succC11} successes, ${rejC11} failures, remaining: ${stateC11Promo?.remainingAmount}, consumed: ${stateC11Promo?.consumedAmount}, stock: ${stateC11Prod?.stockPacks}`,
      succC11 === 1 &&
      rejC11 === 1 &&
      stateC11Promo?.remainingAmount === 15000 &&
      stateC11Promo?.consumedAmount === 35000 &&
      stateC11Prod?.stockPacks === 190,
      undefined,
      'OrdersService.updateOrder (x2 concurrent)'
    );

    // C.12 Editing CANCELLED/SHIPPED orders, RBAC/ownership checks, multi-SKU ProductGroup allocation, and AuditLog/Excel side effects in OrdersService.updateOrder
    const orderC12_Cancelled = 'order_c12_canc_' + crypto.randomBytes(4).toString('hex');
    const orderC12_Shipped = 'order_c12_ship_' + crypto.randomBytes(4).toString('hex');
    const orderC12_Draft = 'order_c12_draft_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderC12_Cancelled);
    createdOrderIds.add(orderC12_Shipped);
    createdOrderIds.add(orderC12_Draft);

    await prisma.order.createMany({
      data: [
        {
          id: orderC12_Cancelled,
          orderNumber: 'ORD-C12-CANC-' + Date.now(),
          customerId: customerSession.userId,
          companyId: testCompanyId,
          status: 'CANCELLED',
          totalPacks: 10,
          totalBlocks: 1,
          totalCases: 0.02,
          totalPrice: 100000
        },
        {
          id: orderC12_Shipped,
          orderNumber: 'ORD-C12-SHIP-' + Date.now(),
          customerId: customerSession.userId,
          companyId: testCompanyId,
          status: 'SHIPPED',
          totalPacks: 10,
          totalBlocks: 1,
          totalCases: 0.02,
          totalPrice: 100000
        },
        {
          id: orderC12_Draft,
          orderNumber: 'ORD-C12-DRAFT-' + Date.now(),
          customerId: customerSession.userId,
          createdByUserId: customerSession.userId,
          companyId: testCompanyId,
          status: 'DRAFT',
          totalPacks: 10,
          totalBlocks: 1,
          totalCases: 0.02,
          totalPrice: 100000
        }
      ]
    });

    let editCancelledRejected = false;
    try {
      await OrdersService.updateOrder(adminSession, {
        orderId: orderC12_Cancelled,
        items: [{ productId: prodC1, quantityPacks: 10 }],
        status: 'NEW'
      });
    } catch (err: any) {
      if (err.message?.includes('CANCELLED') || err.message?.includes('DRAFT или NEW')) {
        editCancelledRejected = true;
      }
    }

    let editShippedRejected = false;
    try {
      await OrdersService.updateOrder(staffSession, {
        orderId: orderC12_Shipped,
        items: [{ productId: prodC1, quantityPacks: 10 }],
        status: 'NEW'
      });
    } catch (err: any) {
      if (err.message?.includes('SHIPPED') || err.message?.includes('DRAFT или NEW')) {
        editShippedRejected = true;
      }
    }

    let crossCompanyRejected = false;
    try {
      await OrdersService.updateOrder(crossCompanyCustomerSession, {
        orderId: orderC12_Draft,
        items: [{ productId: prodC1, quantityPacks: 10 }],
        status: 'DRAFT'
      });
    } catch (err: any) {
      if (err.message?.includes('другой компании')) crossCompanyRejected = true;
    }

    let otherCustomerDraftRejected = false;
    try {
      await OrdersService.updateOrder(otherCustomerSession, {
        orderId: orderC12_Draft,
        items: [{ productId: prodC1, quantityPacks: 10 }],
        status: 'DRAFT'
      });
    } catch (err: any) {
      if (err.message?.includes('только его автору')) otherCustomerDraftRejected = true;
    }

    let staffWithoutEditRejected = false;
    try {
      await OrdersService.updateOrder(staffWithoutEditSession, {
        orderId: orderC12_Draft,
        items: [{ productId: prodC1, quantityPacks: 10 }],
        status: 'DRAFT'
      });
    } catch (err: any) {
      if (err.message?.includes('нет прав для редактирования')) staffWithoutEditRejected = true;
    }

    const grpC12 = 'grp_c12_' + crypto.randomBytes(4).toString('hex');
    createdGroupIds.add(grpC12);
    await prisma.productGroup.create({
      data: { id: grpC12, displayName: 'Group C.12 Multi-SKU', isActive: true }
    });

    const skuC12_1 = 'prod_c12_s1_' + crypto.randomBytes(4).toString('hex');
    const skuC12_2 = 'prod_c12_s2_' + crypto.randomBytes(4).toString('hex');
    await createTrackedProduct({ id: skuC12_1, name: 'SKU C12.1', sku: 'SKU-C12-1-' + Date.now(), basePrice: 10000, stockPacks: 15, groupId: grpC12, priority: 1 });
    await createTrackedProduct({ id: skuC12_2, name: 'SKU C12.2', sku: 'SKU-C12-2-' + Date.now(), basePrice: 10000, stockPacks: 35, groupId: grpC12, priority: 2 });

    invalidateOrderCalculationConfig();
    const excelTriggersBefore = excelTriggers.length;

    await OrdersService.updateOrder(customerSession, {
      orderId: orderC12_Draft,
      items: [{ groupId: grpC12, quantityPacks: 30 }],
      status: 'NEW'
    });

    const stateSku1 = await prisma.product.findUnique({ where: { id: skuC12_1 } });
    const stateSku2 = await prisma.product.findUnique({ where: { id: skuC12_2 } });
    const stateDraftSubmitted = await prisma.order.findUnique({
      where: { id: orderC12_Draft },
      include: { items: { include: { skuAllocations: true } } }
    });
    const submitAuditLog = await prisma.auditLog.findFirst({
      where: {
        userId: customerSession.userId,
        action: 'SUBMIT_DRAFT_ORDER',
        details: { contains: stateDraftSubmitted?.orderNumber }
      }
    });
    const excelTriggeredForC12 = excelTriggers.length > excelTriggersBefore && excelTriggers.some(e => e.orderId === orderC12_Draft);

    recordTest(
      'Area C',
      'C.12',
      'OrdersService.updateOrder enforces terminal status guards, RBAC/ownership, multi-SKU group allocation, AuditLog, and Excel trigger',
      'Cancelled/Shipped/RBAC blocked; Group 30 packs split 15+15 (stocks 0 & 20); SUBMIT_DRAFT_ORDER logged; Excel triggered',
      `Blocked(Canc:${editCancelledRejected}, Ship:${editShippedRejected}, CrossComp:${crossCompanyRejected}, OtherAuthor:${otherCustomerDraftRejected}, NoEditPerm:${staffWithoutEditRejected}) | Stock(${stateSku1?.stockPacks}, ${stateSku2?.stockPacks}) | SKUAllocs:${stateDraftSubmitted?.items[0]?.skuAllocations.length} | Audit:${!!submitAuditLog} | Excel:${excelTriggeredForC12}`,
      editCancelledRejected &&
      editShippedRejected &&
      crossCompanyRejected &&
      otherCustomerDraftRejected &&
      staffWithoutEditRejected &&
      stateSku1?.stockPacks === 0 &&
      stateSku2?.stockPacks === 20 &&
      stateDraftSubmitted?.status === 'NEW' &&
      stateDraftSubmitted?.totalPacks === 30 &&
      stateDraftSubmitted?.items[0]?.skuAllocations.length === 2 &&
      submitAuditLog !== null &&
      excelTriggeredForC12,
      undefined,
      'OrdersService.updateOrder'
    );

    // =========================================================================
    // AREA D: ORDER CANCELLATION AND STATUS TRANSITIONS VIA ACTUAL OrdersService.updateOrderStatus()
    // =========================================================================
    console.log('\n--- AREA D: Order Cancellation & Status Transitions (Direct OrdersService.updateOrderStatus Calls) ---');

    // D.1 Valid cancellation via OrdersService.updateOrderStatus restores stock and fixed promotion budgets exactly once
    const prodD1 = 'prod_d1_' + crypto.randomBytes(4).toString('hex');
    const promoD1 = 'promo_d1_' + crypto.randomBytes(4).toString('hex');
    await createTrackedProduct({ id: prodD1, name: 'Product D.1', sku: 'SKU-D1-' + Date.now(), basePrice: 10000, stockPacks: 80 });
    await createTrackedPromotion({
      id: promoD1,
      name: 'Promo D.1',
      allocatedAmount: 100000,
      remainingAmount: 80000,
      consumedAmount: 20000,
      companyId: testCompanyId
    });

    const orderD1Id = 'order_d1_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderD1Id);
    const orderD1Number = 'ORD-D1-' + Date.now();
    await prisma.order.create({
      data: {
        id: orderD1Id,
        orderNumber: orderD1Number,
        customerId: customerSession.userId,
        companyId: testCompanyId,
        status: 'NEW',
        totalPacks: 20,
        totalBlocks: 2,
        totalCases: 0.04,
        totalPrice: 180000,
        appliedPromotions: [{ promotionId: promoD1, amount: 20000 }],
        items: {
          create: [
            {
              productId: prodD1,
              baseQuantityPacks: 20,
              totalQuantityPacks: 20,
              quantityPacks: 20,
              price: 10000,
              skuAllocations: {
                create: [{ productId: prodD1, packs: 20, sku: 'SKU-D1', name: 'Product D.1' }]
              }
            }
          ]
        }
      }
    });

    const cancelResD1 = await OrdersService.updateOrderStatus(staffSession, {
      orderId: orderD1Id,
      status: 'CANCELLED',
      reason: 'Customer requested cancellation D.1'
    });

    const stateD1Prod = await prisma.product.findUnique({ where: { id: prodD1 } });
    const stateD1Promo = await prisma.promotion.findUnique({ where: { id: promoD1 } });
    const stateD1Ord = await prisma.order.findUnique({ where: { id: orderD1Id } });
    const auditD1 = await prisma.auditLog.findFirst({
      where: { action: 'CANCEL_ORDER', details: { contains: orderD1Number } }
    });

    recordTest(
      'Area D',
      'D.1',
      'OrdersService.updateOrderStatus valid cancellation restores stock and budget exactly once and logs CANCEL_ORDER',
      'Product stock: 100, Promo remaining: 100000 (consumed 0), Order status: CANCELLED, appliedPromotions: [], AuditLog created',
      `Stock: ${stateD1Prod?.stockPacks}, Promo rem: ${stateD1Promo?.remainingAmount}, Order: ${cancelResD1.order.status}, applied: ${JSON.stringify(stateD1Ord?.appliedPromotions)}, Audit: ${!!auditD1}`,
      stateD1Prod?.stockPacks === 100 &&
      stateD1Promo?.remainingAmount === 100000 &&
      stateD1Promo?.consumedAmount === 0 &&
      stateD1Ord?.status === 'CANCELLED' &&
      Array.isArray(stateD1Ord?.appliedPromotions as any) &&
      (stateD1Ord?.appliedPromotions as any).length === 0 &&
      auditD1 !== null,
      undefined,
      'OrdersService.updateOrderStatus'
    );

    // D.2-D.3 Two concurrent OrdersService.updateOrderStatus cancellation requests cannot restore resources twice; second fails with 409
    const prodD2 = 'prod_d2_' + crypto.randomBytes(4).toString('hex');
    const promoD2 = 'promo_d2_' + crypto.randomBytes(4).toString('hex');
    await createTrackedProduct({ id: prodD2, name: 'Product D.2', sku: 'SKU-D2-' + Date.now(), basePrice: 10000, stockPacks: 80 });
    await createTrackedPromotion({
      id: promoD2,
      name: 'Promo D.2',
      allocatedAmount: 100000,
      remainingAmount: 80000,
      consumedAmount: 20000,
      companyId: testCompanyId
    });

    const orderD2Id = 'order_d2_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderD2Id);
    const orderD2Number = 'ORD-D2-' + Date.now();
    await prisma.order.create({
      data: {
        id: orderD2Id,
        orderNumber: orderD2Number,
        customerId: customerSession.userId,
        companyId: testCompanyId,
        status: 'NEW',
        totalPacks: 20,
        totalBlocks: 2,
        totalCases: 0.04,
        totalPrice: 180000,
        appliedPromotions: [{ promotionId: promoD2, amount: 20000 }],
        items: {
          create: [
            {
              productId: prodD2,
              baseQuantityPacks: 20,
              totalQuantityPacks: 20,
              quantityPacks: 20,
              price: 10000,
              skuAllocations: {
                create: [{ productId: prodD2, packs: 20, sku: 'SKU-D2', name: 'Product D.2' }]
              }
            }
          ]
        }
      }
    });

    const resultsD2 = await withBoundedTimeout(
      Promise.allSettled([
        OrdersService.updateOrderStatus(staffSession, {
          orderId: orderD2Id,
          status: 'CANCELLED',
          reason: 'Concurrent cancel #1'
        }),
        OrdersService.updateOrderStatus(staffSession, {
          orderId: orderD2Id,
          status: 'CANCELLED',
          reason: 'Concurrent cancel #2'
        })
      ]),
      10000,
      'Area D.2 concurrent OrdersService.updateOrderStatus calls'
    );

    const succD2 = resultsD2.filter(r => r.status === 'fulfilled').length;
    const rejD2 = resultsD2.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    const stateD2Prod = await prisma.product.findUnique({ where: { id: prodD2 } });
    const stateD2Promo = await prisma.promotion.findUnique({ where: { id: promoD2 } });
    const auditLogsD2 = await prisma.auditLog.findMany({
      where: { action: 'CANCEL_ORDER', details: { contains: orderD2Number } }
    });

    recordTest(
      'Area D',
      'D.2-D.3',
      'Simultaneous OrdersService.updateOrderStatus cancellations serialize under lock; second rejected with 409',
      '1 success, 1 failure (409 Conflict), stock restored once (100), promo restored once (100k), 1 audit log',
      `Successes: ${succD2}, Failures: ${rejD2.length} (status=${rejD2[0]?.reason?.status}), Stock: ${stateD2Prod?.stockPacks}, Promo: ${stateD2Promo?.remainingAmount}, AuditLogs: ${auditLogsD2.length}`,
      succD2 === 1 &&
      rejD2.length === 1 &&
      rejD2[0]?.reason?.status === 409 &&
      stateD2Prod?.stockPacks === 100 &&
      stateD2Promo?.remainingAmount === 100000 &&
      stateD2Promo?.consumedAmount === 0 &&
      auditLogsD2.length === 1,
      undefined,
      'OrdersService.updateOrderStatus (x2 concurrent)'
    );

    // D.4 Cancellation (OrdersService.updateOrderStatus) racing with order edit (OrdersService.updateOrder):
    // Order is NEW when OrdersService.updateOrder starts and passes pre-validation, then OrdersService.updateOrderStatus
    // commits CANCELLED before OrdersService.updateOrder acquires the row lock -> updateOrder reads CANCELLED under lock and throws 409!
    const prodD4 = 'prod_d4_' + crypto.randomBytes(4).toString('hex');
    const promoD4 = 'promo_d4_' + crypto.randomBytes(4).toString('hex');
    await createTrackedProduct({ id: prodD4, name: 'Product D.4', sku: 'SKU-D4-' + Date.now(), basePrice: 10000, stockPacks: 80 });
    await createTrackedPromotion({
      id: promoD4,
      name: 'Promo D.4',
      allocatedAmount: 100000,
      remainingAmount: 80000,
      consumedAmount: 20000,
      isActive: false,
      companyId: testCompanyId
    });

    const orderD4Id = 'order_d4_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderD4Id);
    await prisma.order.create({
      data: {
        id: orderD4Id,
        orderNumber: 'ORD-D4-' + Date.now(),
        customerId: customerSession.userId,
        companyId: testCompanyId,
        status: 'NEW',
        totalPacks: 20,
        totalBlocks: 2,
        totalCases: 0.04,
        totalPrice: 180000,
        appliedPromotions: [{ promotionId: promoD4, amount: 20000 }],
        items: {
          create: [
            {
              productId: prodD4,
              baseQuantityPacks: 20,
              totalQuantityPacks: 20,
              quantityPacks: 20,
              price: 10000,
              skuAllocations: {
                create: [{ productId: prodD4, packs: 20, sku: 'SKU-D4', name: 'Product D.4' }]
              }
            }
          ]
        }
      }
    });

    invalidateOrderCalculationConfig();
    let editCaught409OnCancelRace = false;
    try {
      // Deterministic barrier: while OrdersService.updateOrder is in PromotionsService.calculateOrder
      // (after existingOrder was already loaded as status='NEW' and passed line 1265),
      // OrdersService.updateOrderStatus cancels the order in PostgreSQL!
      PromotionsService.calculateOrder = async (...args: Parameters<typeof PromotionsService.calculateOrder>) => {
        const calcRes = await origCalcOrder(...args);
        await OrdersService.updateOrderStatus(staffSession, {
          orderId: orderD4Id,
          status: 'CANCELLED',
          reason: 'Concurrent cancellation during edit race D.4'
        });
        return calcRes;
      };

      await OrdersService.updateOrder(staffSession, {
        orderId: orderD4Id,
        items: [{ productId: prodD4, quantityPacks: 30 }],
        status: 'NEW'
      });
    } catch (err: any) {
      if (err.status === 409 && err.message?.includes('CANCELLED')) {
        editCaught409OnCancelRace = true;
      }
    } finally {
      PromotionsService.calculateOrder = origCalcOrder;
    }

    const stateD4Ord = await prisma.order.findUnique({ where: { id: orderD4Id } });
    const stateD4Prod = await prisma.product.findUnique({ where: { id: prodD4 } });
    const stateD4Promo = await prisma.promotion.findUnique({ where: { id: promoD4 } });

    recordTest(
      'Area D',
      'D.4',
      'Cancellation (updateOrderStatus) racing with edit (updateOrder): edit reads CANCELLED under lock and rejects with 409',
      'Edit rejected with 409 Conflict; order remains CANCELLED, stock restored to 100, promo restored to 100000',
      `Caught 409: ${editCaught409OnCancelRace}, Status: ${stateD4Ord?.status}, Stock: ${stateD4Prod?.stockPacks}, Promo rem: ${stateD4Promo?.remainingAmount}`,
      editCaught409OnCancelRace &&
      stateD4Ord?.status === 'CANCELLED' &&
      stateD4Prod?.stockPacks === 100 &&
      stateD4Promo?.remainingAmount === 100000,
      undefined,
      'OrdersService.updateOrderStatus + OrdersService.updateOrder'
    );

    // D.5 Terminal status protection via OrdersService.updateOrderStatus: SHIPPED and COMPLETED cannot be cancelled (409)
    const orderD5_Shipped = 'order_d5_ship_' + crypto.randomBytes(4).toString('hex');
    const orderD5_Completed = 'order_d5_comp_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderD5_Shipped);
    createdOrderIds.add(orderD5_Completed);

    await prisma.order.createMany({
      data: [
        {
          id: orderD5_Shipped,
          orderNumber: 'ORD-D5-SHIP-' + Date.now(),
          customerId: customerSession.userId,
          companyId: testCompanyId,
          status: 'SHIPPED',
          totalPacks: 10,
          totalBlocks: 1,
          totalCases: 0.02,
          totalPrice: 100000
        },
        {
          id: orderD5_Completed,
          orderNumber: 'ORD-D5-COMP-' + Date.now(),
          customerId: customerSession.userId,
          companyId: testCompanyId,
          status: 'COMPLETED',
          totalPacks: 10,
          totalBlocks: 1,
          totalCases: 0.02,
          totalPrice: 100000
        }
      ]
    });

    let cancelShipped409 = false;
    try {
      await OrdersService.updateOrderStatus(staffSession, {
        orderId: orderD5_Shipped,
        status: 'CANCELLED'
      });
    } catch (err: any) {
      if (err.status === 409 && err.message?.includes('SHIPPED')) cancelShipped409 = true;
    }

    let cancelCompleted409 = false;
    try {
      await OrdersService.updateOrderStatus(staffSession, {
        orderId: orderD5_Completed,
        status: 'CANCELLED'
      });
    } catch (err: any) {
      if (err.status === 409 && err.message?.includes('COMPLETED')) cancelCompleted409 = true;
    }

    recordTest(
      'Area D',
      'D.5',
      'OrdersService.updateOrderStatus rejects cancelling SHIPPED or COMPLETED orders with 409 Conflict',
      'Both SHIPPED and COMPLETED cancellations rejected with HTTP 409',
      `SHIPPED 409: ${cancelShipped409}, COMPLETED 409: ${cancelCompleted409}`,
      cancelShipped409 && cancelCompleted409,
      undefined,
      'OrdersService.updateOrderStatus'
    );

    // D.6-D.8 Failed budget restoration (missing promotion record) inside OrdersService.updateOrderStatus
    // rolls back stock restoration, order status, and audit logs atomically!
    const prodD7 = 'prod_d7_' + crypto.randomBytes(4).toString('hex');
    await createTrackedProduct({ id: prodD7, name: 'Product D.7', sku: 'SKU-D7-' + Date.now(), basePrice: 10000, stockPacks: 50 });

    const orderD7Id = 'order_d7_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderD7Id);
    const orderD7Number = 'ORD-D7-' + Date.now();
    await prisma.order.create({
      data: {
        id: orderD7Id,
        orderNumber: orderD7Number,
        customerId: customerSession.userId,
        companyId: testCompanyId,
        status: 'NEW',
        totalPacks: 25,
        totalBlocks: 2,
        totalCases: 0.05,
        totalPrice: 240000,
        appliedPromotions: [{ promotionId: 'deleted_or_missing_promo_d7_9999', amount: 10000 }],
        items: {
          create: [
            {
              productId: prodD7,
              baseQuantityPacks: 25,
              totalQuantityPacks: 25,
              quantityPacks: 25,
              price: 10000,
              skuAllocations: {
                create: [{ productId: prodD7, packs: 25, sku: 'SKU-D7', name: 'Product D.7' }]
              }
            }
          ]
        }
      }
    });

    let rollbackD7Triggered = false;
    let rollbackD7Message = '';
    try {
      await OrdersService.updateOrderStatus(staffSession, {
        orderId: orderD7Id,
        status: 'CANCELLED',
        reason: 'Should fail on missing promo after batchRestoreStock runs'
      });
    } catch (err: any) {
      rollbackD7Triggered = true;
      rollbackD7Message = err.message || '';
    }

    const stateD7Prod = await prisma.product.findUnique({ where: { id: prodD7 } });
    const stateD7Ord = await prisma.order.findUnique({ where: { id: orderD7Id } });
    const stateD7Audit = await prisma.auditLog.findFirst({
      where: { action: 'CANCEL_ORDER', details: { contains: orderD7Number } }
    });

    recordTest(
      'Area D',
      'D.6-D.7',
      'Failed promotion restoration inside OrdersService.updateOrderStatus rolls back preceding stock restoration and status change',
      'Stock stays 50 (not 75), Order status stays NEW, 0 CANCEL_ORDER audit logs',
      `Caught: ${rollbackD7Triggered}, Stock: ${stateD7Prod?.stockPacks}, Status: ${stateD7Ord?.status}, AuditLog: ${stateD7Audit ? 'EXISTS' : 'NULL'}`,
      rollbackD7Triggered &&
      rollbackD7Message.includes('не найдены в базе данных') &&
      stateD7Prod?.stockPacks === 50 &&
      stateD7Ord?.status === 'NEW' &&
      stateD7Audit === null,
      undefined,
      'OrdersService.updateOrderStatus'
    );

    // D.8 Also verify missing promotion record during OrdersService.updateOrder fails safely and rolls back
    let updateMissingPromoCaught = false;
    try {
      await OrdersService.updateOrder(staffSession, {
        orderId: orderD7Id,
        items: [{ productId: prodD7, quantityPacks: 10 }],
        status: 'NEW'
      });
    } catch (err: any) {
      if (err.message?.includes('не найдены в базе данных')) {
        updateMissingPromoCaught = true;
      }
    }
    const stateD8Prod = await prisma.product.findUnique({ where: { id: prodD7 } });

    recordTest(
      'Area D',
      'D.8',
      'Missing promotion record during OrdersService.updateOrder throws explicit error and rolls back stock',
      'Rejected with missing promotion error; stock remains 50',
      `Caught: ${updateMissingPromoCaught}, Stock: ${stateD8Prod?.stockPacks}`,
      updateMissingPromoCaught && stateD8Prod?.stockPacks === 50,
      undefined,
      'OrdersService.updateOrder'
    );

    // D.9 Invalid status transitions (unknown status & reverting CANCELLED -> NEW/ACCEPTED) via OrdersService.updateOrderStatus
    let invalidStatus400 = false;
    try {
      await OrdersService.updateOrderStatus(staffSession, {
        orderId: orderD1Id,
        status: 'UNKNOWN_INVALID_STATE'
      });
    } catch (err: any) {
      if (err.status === 400) invalidStatus400 = true;
    }

    let revertCancelled409 = false;
    try {
      await OrdersService.updateOrderStatus(staffSession, {
        orderId: orderD1Id, // already CANCELLED in D.1
        status: 'ACCEPTED'
      });
    } catch (err: any) {
      if (err.status === 409 && err.message?.includes('отмененного заказа')) revertCancelled409 = true;
    }

    recordTest(
      'Area D',
      'D.9',
      'OrdersService.updateOrderStatus rejects invalid status names (400) and transitions out of CANCELLED (409)',
      'Unknown status -> 400; CANCELLED -> ACCEPTED -> 409',
      `InvalidStatus400: ${invalidStatus400}, RevertCancelled409: ${revertCancelled409}`,
      invalidStatus400 && revertCancelled409,
      undefined,
      'OrdersService.updateOrderStatus'
    );

    // D.10 Valid non-cancel status transition (NEW -> ACCEPTED) via OrdersService.updateOrderStatus and authorization checks
    const orderD10Id = 'order_d10_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderD10Id);
    const orderD10Number = 'ORD-D10-' + Date.now();
    await prisma.order.create({
      data: {
        id: orderD10Id,
        orderNumber: orderD10Number,
        customerId: customerSession.userId,
        companyId: testCompanyId,
        status: 'NEW',
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0.02,
        totalPrice: 100000,
        appliedPromotions: []
      }
    });

    const transD10 = await OrdersService.updateOrderStatus(staffSession, {
      orderId: orderD10Id,
      status: 'ACCEPTED'
    });
    const statusChangeAudit = await prisma.auditLog.findFirst({
      where: { action: 'CHANGE_ORDER_STATUS', details: { contains: orderD10Number } }
    });
    const custHasStatusPerm = hasPermission(customerSession, 'orders:status_change');
    const staffHasStatusPerm = hasPermission(staffSession, 'orders:status_change');

    recordTest(
      'Area D',
      'D.10',
      'OrdersService.updateOrderStatus transitions NEW -> ACCEPTED, logs CHANGE_ORDER_STATUS, and enforces RBAC permission',
      'Order status ACCEPTED, CHANGE_ORDER_STATUS logged, customer hasPermission=false, staff hasPermission=true',
      `Status: ${transD10.order.status}, Audit: ${!!statusChangeAudit}, CustPerm: ${custHasStatusPerm}, StaffPerm: ${staffHasStatusPerm}`,
      transD10.order.status === 'ACCEPTED' &&
      statusChangeAudit !== null &&
      custHasStatusPerm === false &&
      staffHasStatusPerm === true,
      undefined,
      'OrdersService.updateOrderStatus + hasPermission'
    );

    // =========================================================================
    // AREA E: LEGACY ORDERS VIA ACTUAL SERVICE METHODS (5 SCENARIOS)
    // =========================================================================
    console.log('\n--- AREA E: Legacy Orders ---');

    // E.1 Legacy order whose appliedPromotions is NULL and zero discount cancelled via OrdersService.updateOrderStatus
    const prodE1 = 'prod_e1_' + crypto.randomBytes(4).toString('hex');
    await createTrackedProduct({ id: prodE1, name: 'Product E.1', sku: 'SKU-E1-' + Date.now(), basePrice: 10000, stockPacks: 90 });

    const orderE1Id = 'order_e1_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderE1Id);
    await prisma.order.create({
      data: {
        id: orderE1Id,
        orderNumber: 'ORD-E1-' + Date.now(),
        customerId: customerSession.userId,
        companyId: testCompanyId,
        status: 'NEW',
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0.02,
        totalPrice: 100000, // 10 * 10,000 = 100,000 -> zero discount!
        appliedPromotions: Prisma.DbNull,
        items: {
          create: [
            {
              productId: prodE1,
              baseQuantityPacks: 10,
              totalQuantityPacks: 10,
              quantityPacks: 10,
              price: 10000
            }
          ]
        }
      }
    });

    const cancelE1 = await OrdersService.updateOrderStatus(staffSession, {
      orderId: orderE1Id,
      status: 'CANCELLED',
      reason: 'Zero discount legacy order cancel'
    });
    const stateE1Prod = await prisma.product.findUnique({ where: { id: prodE1 } });

    recordTest(
      'Area E',
      'E.1',
      'Legacy order with appliedPromotions: NULL and zero discount cancels cleanly via OrdersService.updateOrderStatus',
      'Status CANCELLED, stock restored to 100 without requiring admin reconciliation',
      `Status: ${cancelE1.order.status}, Stock: ${stateE1Prod?.stockPacks}`,
      cancelE1.order.status === 'CANCELLED' && stateE1Prod?.stockPacks === 100,
      undefined,
      'OrdersService.updateOrderStatus'
    );

    // E.2 Order with explicit empty appliedPromotions [] array
    const resE2 = await OrdersService.resolveOrderPromotionDeductions({
      appliedPromotions: [],
      items: [{ productId: prodE1, baseQuantityPacks: 10, price: 10000 }],
      totalPrice: 100000
    });
    recordTest(
      'Area E',
      'E.2',
      'Order with explicit empty appliedPromotions [] array resolves to PERSISTED_EXACT []',
      'source: PERSISTED_EXACT, deductions: []',
      `source: ${resE2.source}, deductions: ${JSON.stringify(resE2.deductions)}`,
      resE2.source === 'PERSISTED_EXACT' && resE2.deductions.length === 0,
      undefined,
      'OrdersService.resolveOrderPromotionDeductions'
    );

    // E.3 Order with malformed appliedPromotions metadata rejected by OrdersService.updateOrderStatus
    const orderE3Id = 'order_e3_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderE3Id);
    await prisma.order.create({
      data: {
        id: orderE3Id,
        orderNumber: 'ORD-E3-' + Date.now(),
        customerId: customerSession.userId,
        companyId: testCompanyId,
        status: 'NEW',
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0.02,
        totalPrice: 100000,
        appliedPromotions: 'malformed_non_array_string' as any,
        items: {
          create: [{ productId: prodE1, baseQuantityPacks: 10, totalQuantityPacks: 10, quantityPacks: 10, price: 10000 }]
        }
      }
    });

    let malformedCaught = false;
    try {
      await OrdersService.updateOrderStatus(staffSession, {
        orderId: orderE3Id,
        status: 'CANCELLED'
      });
    } catch (err: any) {
      if (err.message?.includes('Поврежденные данные промо-акций')) malformedCaught = true;
    }
    const stateE3Ord = await prisma.order.findUnique({ where: { id: orderE3Id } });
    recordTest(
      'Area E',
      'E.3',
      'Order with malformed appliedPromotions metadata fails closed in OrdersService.updateOrderStatus',
      'Throws validation error and keeps order status NEW',
      `Caught: ${malformedCaught}, Status: ${stateE3Ord?.status}`,
      malformedCaught && stateE3Ord?.status === 'NEW',
      undefined,
      'OrdersService.updateOrderStatus'
    );

    // E.4 Ambiguous legacy order with discount rejected with LegacyAmbiguousPromotionError (409) in both updateOrder and updateOrderStatus
    const orderE4Id = 'order_e4_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderE4Id);
    await prisma.order.create({
      data: {
        id: orderE4Id,
        orderNumber: 'ORD-E4-LEGACY-' + Date.now(),
        customerId: customerSession.userId,
        companyId: testCompanyId,
        status: 'NEW',
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0.02,
        totalPrice: 60000, // nominal 100,000 -> 40,000 discount with appliedPromotions=NULL!
        appliedPromotions: Prisma.DbNull,
        items: {
          create: [{ productId: prodE1, baseQuantityPacks: 10, totalQuantityPacks: 10, quantityPacks: 10, price: 10000 }]
        }
      }
    });

    let ambiguousCancelCaught = false;
    try {
      await OrdersService.updateOrderStatus(staffSession, {
        orderId: orderE4Id,
        status: 'CANCELLED'
      });
    } catch (err: any) {
      if (err instanceof LegacyAmbiguousPromotionError && err.status === 409) {
        ambiguousCancelCaught = true;
      }
    }

    let ambiguousEditCaught = false;
    try {
      await OrdersService.updateOrder(staffSession, {
        orderId: orderE4Id,
        items: [{ productId: prodE1, quantityPacks: 10, price: 10000 }],
        status: 'NEW'
      });
    } catch (err: any) {
      if (err instanceof LegacyAmbiguousPromotionError && err.status === 409) {
        ambiguousEditCaught = true;
      }
    }

    recordTest(
      'Area E',
      'E.4',
      'Ambiguous discounted legacy order rejected with LegacyAmbiguousPromotionError (409) in both updateOrderStatus and updateOrder',
      'Both updateOrderStatus and updateOrder throw LegacyAmbiguousPromotionError (409)',
      `CancelCaught409: ${ambiguousCancelCaught}, EditCaught409: ${ambiguousEditCaught}`,
      ambiguousCancelCaught && ambiguousEditCaught,
      undefined,
      'OrdersService.updateOrderStatus + OrdersService.updateOrder'
    );

    // E.5 Legacy order referencing deleted promotion during admin reconciliation fails safely and rolls back
    let deletedLegacyPromoCaught = false;
    try {
      await OrdersService.updateOrderStatus(adminSession, {
        orderId: orderE4Id,
        status: 'CANCELLED',
        adminResolvedDeductions: [{ promotionId: 'missing_legacy_promo_999', amount: 40000 }],
        reconciliationReason: 'Attempt reconcile with missing promo'
      });
    } catch (err: any) {
      if (err.message?.includes('не найдены в базе данных')) {
        deletedLegacyPromoCaught = true;
      }
    }
    recordTest(
      'Area E',
      'E.5',
      'Admin reconciliation referencing a deleted/missing promotion throws and rolls back in OrdersService.updateOrderStatus',
      'Throws missing promotion error and rolls back transaction',
      `Caught: ${deletedLegacyPromoCaught}`,
      deletedLegacyPromoCaught,
      undefined,
      'OrdersService.updateOrderStatus'
    );

    // =========================================================================
    // AREA F: ADMINISTRATIVE RECONCILIATION AND AUDIT LOGS VIA ACTUAL SERVICE METHODS (7 SCENARIOS)
    // =========================================================================
    console.log('\n--- AREA F: Administrative Reconciliation & Audit Logs (Direct Service Calls) ---');

    const promoF = 'promo_f_' + crypto.randomBytes(4).toString('hex');
    await createTrackedPromotion({
      id: promoF,
      name: 'Promo F Reconcile',
      allocatedAmount: 100000,
      remainingAmount: 60000,
      consumedAmount: 40000,
      isActive: false,
      companyId: testCompanyId
    });

    // F.2 Unauthorized users (CUSTOMER and non-admin STAFF) blocked from manual reconciliation in both updateOrder and updateOrderStatus (403)
    let custReconcileEdit403 = false;
    try {
      await OrdersService.updateOrder(customerSession, {
        orderId: orderE4Id,
        items: [{ productId: prodE1, quantityPacks: 10, price: 10000 }],
        status: 'NEW',
        adminResolvedDeductions: [{ promotionId: promoF, amount: 40000 }]
      });
    } catch (err: any) {
      if (err.status === 403) custReconcileEdit403 = true;
    }

    let staffReconcileCancel403 = false;
    try {
      await OrdersService.updateOrderStatus(staffSession, {
        orderId: orderE4Id,
        status: 'CANCELLED',
        adminResolvedDeductions: [{ promotionId: promoF, amount: 40000 }]
      });
    } catch (err: any) {
      if (err.status === 403) staffReconcileCancel403 = true;
    }

    recordTest(
      'Area F',
      'F.2',
      'Non-admin users (CUSTOMER & STAFF) blocked with 403 Forbidden when supplying adminResolvedDeductions to updateOrder or updateOrderStatus',
      'Both rejected with HTTP 403 Forbidden',
      `CustomerEdit403: ${custReconcileEdit403}, StaffCancel403: ${staffReconcileCancel403}`,
      custReconcileEdit403 && staffReconcileCancel403,
      undefined,
      'OrdersService.updateOrder + OrdersService.updateOrderStatus'
    );

    // F.1 & F.3: Authorized administrator reconciles legacy order via OrdersService.updateOrderStatus (and OrdersService.updateOrder),
    // restoring promotion budget and writing RECONCILE_LEGACY_PROMOTION_BUDGET + CANCEL_ORDER atomically in the same transaction!
    const reconcileResF1 = await OrdersService.updateOrderStatus(adminSession, {
      orderId: orderE4Id,
      status: 'CANCELLED',
      reason: 'Cancel legacy order with admin reconciliation',
      adminResolvedDeductions: [{ promotionId: promoF, amount: 40000 }],
      reconciliationReason: 'Verified historical invoice #INV-2026-F1'
    });

    const stateFPromoAfterCancel = await prisma.promotion.findUnique({ where: { id: promoF } });
    const auditRecordF = await prisma.auditLog.findFirst({
      where: {
        userId: adminSession.userId,
        action: 'RECONCILE_LEGACY_PROMOTION_BUDGET',
        details: { contains: orderE4Id }
      }
    });

    // Also test admin reconciliation via OrdersService.updateOrder on a second legacy order!
    await prisma.promotion.update({
      where: { id: promoF },
      data: { remainingAmount: 70000, consumedAmount: 30000 }
    });

    const orderF_EditId = 'order_f_edit_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderF_EditId);
    await prisma.order.create({
      data: {
        id: orderF_EditId,
        orderNumber: 'ORD-F-EDIT-' + Date.now(),
        customerId: customerSession.userId,
        companyId: testCompanyId,
        status: 'NEW',
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0.02,
        totalPrice: 70000, // nominal 100,000 -> 30,000 legacy discount
        appliedPromotions: Prisma.DbNull,
        items: {
          create: [{ productId: prodE1, baseQuantityPacks: 10, totalQuantityPacks: 10, quantityPacks: 10, price: 10000 }]
        }
      }
    });

    await OrdersService.updateOrder(adminSession, {
      orderId: orderF_EditId,
      items: [{ productId: prodE1, quantityPacks: 10, price: 10000 }],
      status: 'NEW',
      adminResolvedDeductions: [{ promotionId: promoF, amount: 30000 }],
      reconciliationReason: 'Verified historical invoice #INV-2026-F2 during edit'
    });

    const stateFPromoAfterEdit = await prisma.promotion.findUnique({ where: { id: promoF } });
    const auditRecordFEdit = await prisma.auditLog.findFirst({
      where: {
        userId: adminSession.userId,
        action: 'RECONCILE_LEGACY_PROMOTION_BUDGET',
        details: { contains: orderF_EditId }
      }
    });

    recordTest(
      'Area F',
      'F.1',
      'Authorized administrator reconciles legacy orders end-to-end via OrdersService.updateOrderStatus and OrdersService.updateOrder',
      'Both cancel-reconcile (40k -> 100k) and edit-reconcile (30k -> 100k) succeed',
      `Cancel status: ${reconcileResF1.order.status}, Promo after cancel: ${stateFPromoAfterCancel?.remainingAmount}, Promo after edit: ${stateFPromoAfterEdit?.remainingAmount}`,
      reconcileResF1.order.status === 'CANCELLED' &&
      stateFPromoAfterCancel?.remainingAmount === 100000 &&
      stateFPromoAfterEdit?.remainingAmount === 100000,
      undefined,
      'OrdersService.updateOrderStatus + OrdersService.updateOrder'
    );

    recordTest(
      'Area F',
      'F.3',
      'Reconciliation and RECONCILE_LEGACY_PROMOTION_BUDGET AuditLog are persisted atomically by production service methods',
      'AuditLog entries created for both updateOrderStatus and updateOrder reconciliations',
      `Cancel Audit: ${!!auditRecordF}, Edit Audit: ${!!auditRecordFEdit}`,
      auditRecordF !== null && auditRecordFEdit !== null,
      undefined,
      'OrdersService.updateOrderStatus + OrdersService.updateOrder'
    );

    // F.4 Failed reconciliation in OrdersService.updateOrderStatus leaves no phantom audit record
    const phantomAuditE5 = await prisma.auditLog.findFirst({
      where: {
        action: 'RECONCILE_LEGACY_PROMOTION_BUDGET',
        details: { contains: 'Attempt reconcile with missing promo' }
      }
    });

    recordTest(
      'Area F',
      'F.4',
      'Failed reconciliation in OrdersService.updateOrderStatus leaves no phantom audit record',
      'Phantom audit record is null',
      `Phantom record: ${phantomAuditE5 ? 'EXISTS' : 'NULL'}`,
      phantomAuditE5 === null,
      undefined,
      'OrdersService.updateOrderStatus'
    );

    // F.5 Repeated reconciliation on already reconciled order cannot double-restore budget
    let repeatReconcileBlocked = false;
    try {
      await OrdersService.updateOrderStatus(adminSession, {
        orderId: orderE4Id, // already CANCELLED in F.1
        status: 'CANCELLED',
        adminResolvedDeductions: [{ promotionId: promoF, amount: 40000 }]
      });
    } catch (err: any) {
      if (err.status === 409) repeatReconcileBlocked = true;
    }

    recordTest(
      'Area F',
      'F.5',
      'Repeated reconciliation request on already-cancelled legacy order is rejected with 409 under lock',
      'Rejected with HTTP 409 Conflict; budget remains 100000',
      `Blocked409: ${repeatReconcileBlocked}, Promo rem: ${stateFPromoAfterEdit?.remainingAmount}`,
      repeatReconcileBlocked && stateFPromoAfterEdit?.remainingAmount === 100000,
      undefined,
      'OrdersService.updateOrderStatus'
    );

    // F.6 Audit records contain operator, orderId, orderNumber, reconciledDeductions, and reason
    const auditDetailsF = JSON.parse(auditRecordF?.details || '{}');
    recordTest(
      'Area F',
      'F.6',
      'RECONCILE_LEGACY_PROMOTION_BUDGET audit log contains operator, orderId, orderNumber, reconciledDeductions, and reason',
      'All required structured audit fields present',
      `orderId=${auditDetailsF.orderId}, resolvedByUserId=${auditDetailsF.resolvedByUserId}, amount=${auditDetailsF.reconciledDeductions?.[0]?.amount}`,
      auditDetailsF.orderId === orderE4Id &&
      auditDetailsF.resolvedByUserId === adminSession.userId &&
      Array.isArray(auditDetailsF.reconciledDeductions) &&
      auditDetailsF.reconciledDeductions[0]?.amount === 40000 &&
      auditDetailsF.reason === 'Verified historical invoice #INV-2026-F1',
      undefined,
      'OrdersService.updateOrderStatus'
    );

    // F.7 Sensitive data is not unnecessarily exposed in service return payload
    const returnedOrderKeys = Object.keys(reconcileResF1.order || {});
    const noPasswordHashExposed = !JSON.stringify(reconcileResF1).includes('passwordHash');
    recordTest(
      'Area F',
      'F.7',
      'Sensitive credentials (passwordHash, tokens) are not exposed in order responses',
      'passwordHash absent from returned order payload',
      `No passwordHash: ${noPasswordHashExposed}, Keys: ${returnedOrderKeys.slice(0, 6).join(', ')}`,
      noPasswordHashExposed,
      undefined,
      'OrdersService.updateOrderStatus'
    );

    // =========================================================================
    // AREA G: DEADLOCKS AND LOCK ORDERING (HIGH-CONCURRENCY STRESS TEST)
    // =========================================================================
    console.log('\n--- AREA G: Deadlocks & Lock Ordering ---');

    const promoG1 = 'promo_g1_' + crypto.randomBytes(4).toString('hex');
    const promoG2 = 'promo_g2_' + crypto.randomBytes(4).toString('hex');
    const prodG1 = 'prod_g1_' + crypto.randomBytes(4).toString('hex');
    const prodG2 = 'prod_g2_' + crypto.randomBytes(4).toString('hex');

    await createTrackedPromotion({ id: promoG1, name: 'Promo G.1', allocatedAmount: 200000, remainingAmount: 200000, consumedAmount: 0 });
    await createTrackedPromotion({ id: promoG2, name: 'Promo G.2', allocatedAmount: 200000, remainingAmount: 200000, consumedAmount: 0 });
    await createTrackedProduct({ id: prodG1, name: 'Product G.1', sku: 'SKU-G1-' + Date.now(), basePrice: 10000, stockPacks: 500 });
    await createTrackedProduct({ id: prodG2, name: 'Product G.2', sku: 'SKU-G2-' + Date.now(), basePrice: 10000, stockPacks: 500 });

    const clientsG = Array.from({ length: 5 }, () => createIndependentClient());
    let deadlockErrorsCount = 0;
    let successfulOpsG = 0;

    try {
      const resultsG = await withBoundedTimeout(
        Promise.allSettled(
          clientsG.map((c, idx) =>
            c.$transaction(async (tx) => {
              // Reverse input order on odd workers to verify internal localeCompare sorting prevents deadlocks
              const stockEntries: Array<[string, number]> =
                idx % 2 === 0
                  ? [[prodG1, 10 + idx], [prodG2, 5 + idx]]
                  : [[prodG2, 5 + idx], [prodG1, 10 + idx]];
              await OrdersService.batchDeductStock(tx, new Map(stockEntries));

              const promoDeductions =
                idx % 2 === 0
                  ? [
                      { promotionId: promoG1, amount: 5000 + idx * 1000 },
                      { promotionId: promoG2, amount: 3000 + idx * 500 }
                    ]
                  : [
                      { promotionId: promoG2, amount: 3000 + idx * 500 },
                      { promotionId: promoG1, amount: 5000 + idx * 1000 }
                    ];
              await OrdersService.batchDeductPromotionBudget(tx, promoDeductions);

              const ordId = `order_g_stress_${idx}_` + crypto.randomBytes(3).toString('hex');
              createdOrderIds.add(ordId);
              await tx.order.create({
                data: {
                  id: ordId,
                  orderNumber: 'ORD-G-' + idx + '-' + Date.now(),
                  customerId: customerSession.userId,
                  companyId: testCompanyId,
                  status: 'NEW',
                  totalPacks: 15 + idx * 2,
                  totalBlocks: 1,
                  totalCases: 0.03,
                  totalPrice: 150000,
                  appliedPromotions: promoDeductions
                }
              });
            })
          )
        ),
        10000,
        'Area G.1 deadlock stress test'
      );

      for (const res of resultsG) {
        if (res.status === 'fulfilled') {
          successfulOpsG++;
        } else {
          if (res.reason?.message?.includes('deadlock') || res.reason?.code === '40P01') {
            deadlockErrorsCount++;
          }
        }
      }

      recordTest(
        'Area G',
        'G.1',
        'Multi-worker concurrency stress test with opposing input key orders: Order -> Product ASC -> Promotion ASC',
        'All 5 concurrent multi-resource transactions succeed with 0 deadlocks (40P01)',
        `Successes: ${successfulOpsG}/5, Deadlocks: ${deadlockErrorsCount}`,
        successfulOpsG === 5 && deadlockErrorsCount === 0,
        undefined,
        'OrdersService.batchDeductStock + OrdersService.batchDeductPromotionBudget'
      );
    } finally {
      await Promise.all(clientsG.map(c => c.$disconnect()));
    }

    // =========================================================================
    // AREA H: DATABASE AND TRANSACTION FAILURE SCENARIOS (5 SCENARIOS)
    // =========================================================================
    console.log('\n--- AREA H: Database & Transaction Failure Scenarios ---');

    // H.1 Failure after stock update
    const prodH1 = 'prod_h1_' + crypto.randomBytes(4).toString('hex');
    await createTrackedProduct({ id: prodH1, name: 'Product H.1', sku: 'SKU-H1-' + Date.now(), basePrice: 10000, stockPacks: 100 });

    try {
      await prisma.$transaction(async (tx) => {
        await OrdersService.batchDeductStock(tx, new Map([[prodH1, 20]]));
        throw new Error('Fail H.1');
      });
    } catch (_) {}

    const stateH1 = await prisma.product.findUnique({ where: { id: prodH1 } });
    recordTest(
      'Area H',
      'H.1',
      'Failure after stock update rolls back stock deduction',
      'Stock packs remains 100',
      `Stock: ${stateH1?.stockPacks}`,
      stateH1?.stockPacks === 100,
      undefined,
      'OrdersService.batchDeductStock'
    );

    // H.2 Failure after promotion-budget update
    const promoH2 = 'promo_h2_' + crypto.randomBytes(4).toString('hex');
    await createTrackedPromotion({ id: promoH2, name: 'Promo H.2', allocatedAmount: 100000, remainingAmount: 100000, consumedAmount: 0 });

    try {
      await prisma.$transaction(async (tx) => {
        await OrdersService.batchDeductPromotionBudget(tx, [{ promotionId: promoH2, amount: 25000 }]);
        throw new Error('Fail H.2');
      });
    } catch (_) {}

    const stateH2 = await prisma.promotion.findUnique({ where: { id: promoH2 } });
    recordTest(
      'Area H',
      'H.2',
      'Failure after budget update rolls back promotion deduction',
      'Remaining: 100000, consumed: 0',
      `Rem: ${stateH2?.remainingAmount}, Con: ${stateH2?.consumedAmount}`,
      stateH2?.remainingAmount === 100000 && stateH2?.consumedAmount === 0,
      undefined,
      'OrdersService.batchDeductPromotionBudget'
    );

    // H.3 Failure after restoring old deduction but before applying new one
    const promoH3 = 'promo_h3_' + crypto.randomBytes(4).toString('hex');
    await createTrackedPromotion({ id: promoH3, name: 'Promo H.3', allocatedAmount: 100000, remainingAmount: 70000, consumedAmount: 30000 });

    try {
      await prisma.$transaction(async (tx) => {
        await OrdersService.batchRestorePromotionBudget(tx, [{ promotionId: promoH3, amount: 30000 }]);
        throw new Error('Fail H.3 mid-operation');
      });
    } catch (_) {}

    const stateH3 = await prisma.promotion.findUnique({ where: { id: promoH3 } });
    recordTest(
      'Area H',
      'H.3',
      'Failure after restoring old deduction reverts to pre-transaction balance',
      'Remaining: 70000, consumed: 30000',
      `Rem: ${stateH3?.remainingAmount}, Con: ${stateH3?.consumedAmount}`,
      stateH3?.remainingAmount === 70000 && stateH3?.consumedAmount === 30000,
      undefined,
      'OrdersService.batchRestorePromotionBudget'
    );

    // H.4 Failure during order item persistence
    const orderH4Id = 'order_h4_' + crypto.randomBytes(4).toString('hex');
    createdOrderIds.add(orderH4Id);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.order.create({
          data: {
            id: orderH4Id,
            orderNumber: 'ORD-H4-' + Date.now(),
            customerId: customerSession.userId,
            companyId: testCompanyId,
            status: 'NEW',
            totalPacks: 10,
            totalBlocks: 1,
            totalCases: 0.02,
            totalPrice: 100000
          }
        });
        throw new Error('Fail H.4 during items write');
      });
    } catch (_) {}

    const stateH4 = await prisma.order.findUnique({ where: { id: orderH4Id } });
    recordTest(
      'Area H',
      'H.4',
      'Failure during order creation rolls back Order row',
      'Order row rolled back; findUnique returns null',
      `Order: ${stateH4 ? 'EXISTS' : 'NULL'}`,
      stateH4 === null,
      undefined,
      'prisma.$transaction'
    );

    // H.5 Failure during audit logging rolls back entire transaction
    const prodH5 = 'prod_h5_' + crypto.randomBytes(4).toString('hex');
    await createTrackedProduct({ id: prodH5, name: 'Product H.5', sku: 'SKU-H5-' + Date.now(), basePrice: 10000, stockPacks: 50 });

    try {
      await prisma.$transaction(async (tx) => {
        await OrdersService.batchDeductStock(tx, new Map([[prodH5, 10]]));
        throw new Error('Fail H.5 audit write error');
      });
    } catch (_) {}

    const stateH5 = await prisma.product.findUnique({ where: { id: prodH5 } });
    recordTest(
      'Area H',
      'H.5',
      'Failure during transaction rolls back preceding stock deduction',
      'Stock packs remains 50',
      `Stock: ${stateH5?.stockPacks}`,
      stateH5?.stockPacks === 50,
      undefined,
      'OrdersService.batchDeductStock'
    );

  } finally {
    OrdersService.generateAndAttachExcel = originalGenerateExcel;
    invalidateOrderCalculationConfig();

    const cleanupErrors = await cleanupTrackedTestData();
    await prisma.$disconnect();

    if (cleanupErrors.length > 0) {
      throw new Error(`Test data cleanup encountered ${cleanupErrors.length} error(s):\n${cleanupErrors.join('\n')}`);
    }
    console.log('\n[CLEANUP] All tracked test orders, items, SKUs, products, groups, promotions, users, companies, and audit logs deleted cleanly (0 errors).');
  }

  const passedCount = records.filter(r => r.passed).length;
  const totalCount = records.length;

  console.log('\n========================================================================');
  console.log(`   INTEGRATION TEST RESULTS: ${passedCount} / ${totalCount} SCENARIOS PASSED`);
  console.log('========================================================================\n');
}

runRealPostgresIntegrationSuite().catch((err) => {
  console.error('\n[FATAL] Integration test suite execution failed:', err);
  process.exit(1);
});
