import prisma from '../../src/lib/db';
import { OrdersService } from '../../src/lib/orders/orders.service';
import { JWTPayload, validateSessionVersion, getEffectivePermissions, hasPermission } from '../../src/lib/auth';
import { getTashkentStartOfDay, getTashkentStartOfNextDay } from '../../src/lib/date-utils';

async function main() {
  console.log('===============================================================');
  console.log('=== PHASE 13B: GET /api/orders WATERFALL & INSTRUMENTATION  ===');
  console.log('===============================================================\n');

  // Pick a real customer session
  const customerUser = await prisma.user.findFirst({
    where: { email: 'loadtest-user-001@ktng-test.local' },
    include: { roleTemplate: true, company: true }
  });

  if (!customerUser) {
    throw new Error('Test customer not found');
  }

  const session: JWTPayload = {
    userId: customerUser.id,
    email: customerUser.email,
    name: customerUser.name,
    role: 'CUSTOMER',
    roleTemplateId: customerUser.roleTemplateId || undefined,
    roleName: customerUser.roleTemplate?.name || 'Клиент',
    permissions: customerUser.roleTemplate?.permissions || ['orders:view_own', 'orders:create'],
    companyId: customerUser.companyId || undefined,
    sessionVersion: customerUser.sessionVersion
  };

  const prismaOperations: Array<{
    opName: string;
    model: string;
    type: string;
    startMs: number;
    endMs: number;
    durationMs: number;
    isSequential: boolean;
    recordsCount: number;
  }> = [];

  const tTotalStart = performance.now();

  // -------------------------------------------------------------
  // Stage 1: Auth & Session Version Validation
  // -------------------------------------------------------------
  const tAuthStart = performance.now();
  const tVersion0 = performance.now();
  const userRecord = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { sessionVersion: true }
  });
  const tVersion1 = performance.now();

  prismaOperations.push({
    opName: 'validateSessionVersion (User.findUnique)',
    model: 'User',
    type: 'SELECT',
    startMs: Math.round(tVersion0 - tTotalStart),
    endMs: Math.round(tVersion1 - tTotalStart),
    durationMs: Math.round(tVersion1 - tVersion0),
    isSequential: true,
    recordsCount: userRecord ? 1 : 0
  });

  const isValidSession = userRecord?.sessionVersion === session.sessionVersion;

  // Check live permissions if required
  let permLookupDuration = 0;
  if (!hasPermission(session, ['orders:view_all', 'orders:view_own', 'orders:create'])) {
    const tPerm0 = performance.now();
    await getEffectivePermissions(session.userId);
    permLookupDuration = Math.round(performance.now() - tPerm0);
  }
  const authDurationMs = Math.round(performance.now() - tAuthStart);

  // -------------------------------------------------------------
  // Stage 2: WhereClause / Visibility Resolution
  // -------------------------------------------------------------
  const tFilterStart = performance.now();
  const whereClause: any = {};
  if (!hasPermission(session, 'orders:view_all')) {
    if (session.companyId) {
      whereClause.companyId = session.companyId;
      whereClause.OR = [
        { status: { not: 'DRAFT' } },
        { createdByUserId: session.userId },
        { customerId: session.userId }
      ];
    } else {
      whereClause.customerId = session.userId;
    }
  }

  // Date filtering
  const startDate = '2026-09-01';
  const endDate = '2026-10-31';
  const createdAtFilter: any = {};
  const start = getTashkentStartOfDay(startDate);
  if (start) createdAtFilter.gte = start;
  const end = getTashkentStartOfNextDay(endDate);
  if (end) createdAtFilter.lt = end;
  whereClause.createdAt = createdAtFilter;

  const filterDurationMs = performance.now() - tFilterStart;

  // -------------------------------------------------------------
  // Stage 3: Order Include Specification
  // -------------------------------------------------------------
  const orderInclude = {
    customer: { select: { id: true, name: true, email: true } },
    createdBy: { select: { id: true, name: true, email: true } },
    company: { select: { id: true, name: true, code: true } },
    items: {
      include: {
        product: true,
        skuAllocations: {
          include: { product: { select: { priority: true } } },
          orderBy: { id: 'asc' as const }
        }
      }
    },
    comments: { orderBy: { createdAt: 'asc' as const } },
    documents: { orderBy: { createdAt: 'desc' as const } }
  };

  // -------------------------------------------------------------
  // Stage 4: Database Execution: Count + findMany (Parallel in Promise.all)
  // -------------------------------------------------------------
  const tDbQueriesStart = performance.now();
  let countResult = 0;
  let ordersResult: any[] = [];

  const countPromise = (async () => {
    const t0 = performance.now();
    const count = await prisma.order.count({ where: whereClause });
    const t1 = performance.now();
    prismaOperations.push({
      opName: 'prisma.order.count',
      model: 'Order',
      type: 'COUNT',
      startMs: Math.round(t0 - tTotalStart),
      endMs: Math.round(t1 - tTotalStart),
      durationMs: Math.round(t1 - t0),
      isSequential: false,
      recordsCount: 1
    });
    return count;
  })();

  const findManyPromise = (async () => {
    const t0 = performance.now();
    const orders = await prisma.order.findMany({
      where: whereClause,
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 25
    });
    const t1 = performance.now();
    prismaOperations.push({
      opName: 'prisma.order.findMany (with nested items/skus/docs)',
      model: 'Order + OrderItem + OrderItemSku + OrderDocument',
      type: 'SELECT',
      startMs: Math.round(t0 - tTotalStart),
      endMs: Math.round(t1 - tTotalStart),
      durationMs: Math.round(t1 - t0),
      isSequential: false,
      recordsCount: orders.length
    });
    return orders;
  })();

  [countResult, ordersResult] = await Promise.all([countPromise, findManyPromise]);
  const dbQueriesTotalMs = Math.round(performance.now() - tDbQueriesStart);

  // -------------------------------------------------------------
  // Stage 5: JSON Serialization & Payload Measurement
  // -------------------------------------------------------------
  const tSerializeStart = performance.now();
  const responseData = {
    orders: ordersResult,
    pagination: {
      page: 1,
      pageSize: 25,
      total: countResult,
      totalPages: Math.ceil(countResult / 25)
    }
  };
  const jsonString = JSON.stringify(responseData);
  const payloadBytes = Buffer.byteLength(jsonString, 'utf-8');
  const serializeDurationMs = Math.round(performance.now() - tSerializeStart);

  const totalDurationMs = Math.round(performance.now() - tTotalStart);

  console.log('--- GET /api/orders WATERFALL BREAKDOWN ---');
  console.log(`1. Auth & Session Version Validation: ${authDurationMs} ms (${((authDurationMs / totalDurationMs) * 100).toFixed(1)}%)`);
  console.log(`2. Filter & Timezone Resolution:       ${filterDurationMs.toFixed(3)} ms (<0.1%)`);
  console.log(`3. DB Queries (Count + findMany):      ${dbQueriesTotalMs} ms (${((dbQueriesTotalMs / totalDurationMs) * 100).toFixed(1)}%)`);
  console.log(`4. JSON Serialization & Formatting:    ${serializeDurationMs} ms (${((serializeDurationMs / totalDurationMs) * 100).toFixed(1)}%)`);
  console.log(`---------------------------------------------------------------`);
  console.log(`TOTAL SERVER EXECUTION TIME:           ${totalDurationMs} ms`);
  console.log(`Response Payload Size:                 ${payloadBytes} bytes (${(payloadBytes / 1024).toFixed(2)} KB)`);
  console.log(`Orders Retrieved:                      ${ordersResult.length} (Total matching: ${countResult})\n`);

  console.log('--- PRISMA OPERATIONS LOG ---');
  console.table(prismaOperations);
  // -------------------------------------------------------------
  // Stage 6: Seller Journal Measurement (25 orders with full relations)
  // -------------------------------------------------------------
  console.log('\n--- 2. Seller Orders Journal (page 1, 25 orders with full relations) ---');
  const sellerUser = await prisma.user.findFirst({
    where: { role: 'SELLER' },
    include: { roleTemplate: true }
  });

  if (sellerUser) {
    const sellerSession: JWTPayload = {
      userId: sellerUser.id,
      email: sellerUser.email,
      name: sellerUser.name,
      role: 'SELLER',
      roleTemplateId: sellerUser.roleTemplateId || undefined,
      roleName: sellerUser.roleTemplate?.name || 'Менеджер продаж',
      permissions: ['orders:view_all', 'orders:validation:view'],
      sessionVersion: sellerUser.sessionVersion
    };

    const tSeller0 = performance.now();
    const sellerOrdersRes = await OrdersService.getOrders(sellerSession, { page: 1, pageSize: 25 });
    const tSeller1 = performance.now();

    const tJson0 = performance.now();
    const sellerJsonStr = JSON.stringify(sellerOrdersRes);
    const tJson1 = performance.now();

    const sellerPayloadBytes = Buffer.byteLength(sellerJsonStr, 'utf-8');
    console.log(`Seller Orders Page 1 retrieved: ${sellerOrdersRes.orders.length} orders (Total in DB: ${sellerOrdersRes.pagination.total})`);
    console.log(`DB Query Execution Time:       ${Math.round(tSeller1 - tSeller0)} ms`);
    console.log(`JSON Serialization Time:        ${Math.round(tJson1 - tJson0)} ms`);
    console.log(`Total Response Payload Size:    ${sellerPayloadBytes} bytes (${(sellerPayloadBytes / 1024).toFixed(2)} KB)`);
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
