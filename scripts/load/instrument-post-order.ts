import prisma from '../../src/lib/db';
import { Prisma } from '@prisma/client';
import { JWTPayload, validateSessionVersion, getEffectivePermissions, hasPermission } from '../../src/lib/auth';
import { OrdersService } from '../../src/lib/orders/orders.service';
import { PromotionsService } from '../../src/lib/promotions/promotions.service';
import { ProductGroupService, SkuAllocation } from '../../src/lib/product-groups/product-groups.service';
import { AuditService } from '../../src/lib/audit/audit.service';
import { normalizePacks } from '../../src/lib/conversion';

interface DBOperationRecord {
  step: number;
  name: string;
  model: string;
  type: string;
  isTransaction: boolean;
  isSequential: boolean;
  startMs: number;
  endMs: number;
  durationMs: number;
  recordsReturned: number;
}

async function main() {
  console.log('===============================================================');
  console.log('=== PHASE 13B: POST /api/orders DETAILED 18-STAGE WATERFALL ===');
  console.log('===============================================================\n');

  const customerUser = await prisma.user.findFirst({
    where: { email: 'loadtest-user-001@ktng-test.local' },
    include: { roleTemplate: true, company: true }
  });

  if (!customerUser) throw new Error('Test customer not found');

  const session: JWTPayload = {
    userId: customerUser.id,
    email: customerUser.email,
    name: customerUser.name,
    role: 'CUSTOMER',
    roleTemplateId: customerUser.roleTemplateId || undefined,
    roleName: customerUser.roleTemplate?.name || 'Клиент',
    permissions: customerUser.roleTemplate?.permissions || ['orders:create', 'orders:view_own'],
    companyId: customerUser.companyId || undefined,
    sessionVersion: customerUser.sessionVersion
  };

  const testProduct = await prisma.product.findUnique({
    where: { sku: 'LOADTEST-SKU-1' }
  });

  if (!testProduct) throw new Error('Test product LOADTEST-SKU-1 not found');

  const rawInputItems = [
    { productId: testProduct.id, quantityPacks: 10 }
  ];

  const dbOperations: DBOperationRecord[] = [];
  const stageTimings: Record<string, number> = {};

  const tTotalStart = performance.now();

  // -------------------------------------------------------------
  // Stage 1: Authentication & Session Validation
  // -------------------------------------------------------------
  const tAuth0 = performance.now();
  const tAuthDb0 = performance.now();
  const userRecord = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { sessionVersion: true }
  });
  const tAuthDb1 = performance.now();

  dbOperations.push({
    step: 1,
    name: 'validateSessionVersion',
    model: 'User',
    type: 'SELECT',
    isTransaction: false,
    isSequential: true,
    startMs: Math.round(tAuthDb0 - tTotalStart),
    endMs: Math.round(tAuthDb1 - tTotalStart),
    durationMs: Math.round(tAuthDb1 - tAuthDb0),
    recordsReturned: userRecord ? 1 : 0
  });

  const hasPerm = hasPermission(session, 'orders:create');
  stageTimings['1_Authentication'] = Math.round(performance.now() - tAuth0);

  // -------------------------------------------------------------
  // Stage 2 & 4: User/Customer Lookup & Product Group Prefetch (Parallel)
  // -------------------------------------------------------------
  const tPrefetch0 = performance.now();
  const requestedProductIds = rawInputItems.map(i => i.productId);
  const requestedGroupIds: string[] = [];

  const [customer, allGroups] = await Promise.all([
    (async () => {
      const t0 = performance.now();
      const c = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, name: true }
      });
      const t1 = performance.now();
      dbOperations.push({
        step: 2,
        name: 'customerLookup (User.findUnique)',
        model: 'User',
        type: 'SELECT',
        isTransaction: false,
        isSequential: false,
        startMs: Math.round(t0 - tTotalStart),
        endMs: Math.round(t1 - tTotalStart),
        durationMs: Math.round(t1 - t0),
        recordsReturned: c ? 1 : 0
      });
      return c;
    })(),
    (async () => {
      const t0 = performance.now();
      const g = await prisma.productGroup.findMany({
        where: {
          isActive: true,
          OR: [
            { id: { in: requestedGroupIds } },
            { skus: { some: { id: { in: requestedProductIds } } } }
          ]
        },
        include: { skus: { where: { isActive: true }, orderBy: { priority: 'asc' } } }
      });
      const t1 = performance.now();
      dbOperations.push({
        step: 3,
        name: 'productGroupLookup (ProductGroup.findMany)',
        model: 'ProductGroup',
        type: 'SELECT',
        isTransaction: false,
        isSequential: false,
        startMs: Math.round(t0 - tTotalStart),
        endMs: Math.round(t1 - tTotalStart),
        durationMs: Math.round(t1 - t0),
        recordsReturned: g.length
      });
      return g;
    })()
  ]);

  stageTimings['2_CustomerLookup'] = Math.round(performance.now() - tPrefetch0);
  stageTimings['4_ProductGroupLookup'] = stageTimings['2_CustomerLookup'];

  // -------------------------------------------------------------
  // Stage 3: Product Lookup
  // -------------------------------------------------------------
  const tProd0 = performance.now();
  const groupMap = new Map(allGroups.map(g => [g.id, g]));
  const groupSkuIds = allGroups.flatMap(g => g.skus.map(s => s.id));
  const relevantProductIds = Array.from(new Set([...requestedProductIds, ...groupSkuIds]));

  const dbProducts = await prisma.product.findMany({
    where: {
      id: { in: relevantProductIds },
      isActive: true
    }
  });
  const tProd1 = performance.now();

  dbOperations.push({
    step: 4,
    name: 'productLookup (Product.findMany)',
    model: 'Product',
    type: 'SELECT',
    isTransaction: false,
    isSequential: true,
    startMs: Math.round(tProd0 - tTotalStart),
    endMs: Math.round(tProd1 - tTotalStart),
    durationMs: Math.round(tProd1 - tProd0),
    recordsReturned: dbProducts.length
  });

  stageTimings['3_ProductLookup'] = Math.round(tProd1 - tProd0);

  const productMap = new Map(dbProducts.map(p => [p.id, p]));
  const rawItems = rawInputItems.map(item => {
    const prod = productMap.get(item.productId)!;
    return {
      productId: prod.id,
      sku: prod.sku,
      name: prod.name,
      baseQuantityPacks: item.quantityPacks,
      price: prod.basePrice,
      groupId: prod.groupId || undefined,
      groupDisplayName: undefined,
      groupSkus: [prod]
    };
  });

  // -------------------------------------------------------------
  // Stage 5 & 6: Promotion Configuration & Calculation
  // -------------------------------------------------------------
  const tPromo0 = performance.now();
  const promoResult = await PromotionsService.calculateOrder(rawItems, session.companyId);
  const tPromo1 = performance.now();
  stageTimings['5_PromotionConfigAndCalc'] = Math.round(tPromo1 - tPromo0);

  // -------------------------------------------------------------
  // Stage 7: Validation
  // -------------------------------------------------------------
  const tVal0 = performance.now();
  // Validations in code: pack normalization, non-empty check
  stageTimings['7_Validation'] = Math.round(performance.now() - tVal0);

  // -------------------------------------------------------------
  // Stage 8: Stock Validation & SKU Allocations Planning
  // -------------------------------------------------------------
  const tStockVal0 = performance.now();
  const itemAllocationsByIndex = new Map<number, SkuAllocation[]>();
  for (let idx = 0; idx < promoResult.items.length; idx++) {
    const vi = promoResult.items[idx];
    itemAllocationsByIndex.set(idx, [
      { productId: vi.productId, sku: vi.sku, name: vi.name, packs: vi.totalQuantityPacks }
    ]);
  }
  stageTimings['8_StockValidation'] = Math.round(performance.now() - tStockVal0);

  // -------------------------------------------------------------
  // Stage 9–15: Transaction Execution (Stock Deduction, Order, Items, Skus)
  // -------------------------------------------------------------
  const now = new Date();
  const orderNumber = `ORD-DIAG-${Date.now()}`;
  let stockDeductDuration = 0;
  let orderCreateDuration = 0;
  let skuCreateDuration = 0;

  const tTx0 = performance.now();
  stageTimings['14_TransactionStart'] = Math.round(tTx0 - tTotalStart);

  const savedOrder = await prisma.$transaction(async (tx) => {
    // 9. Stock Deduction (batchDeductStock)
    const tStockDed0 = performance.now();
    const stockDecrements = new Map<string, number>();
    stockDecrements.set(testProduct.id, 10);
    await OrdersService.batchDeductStock(tx, stockDecrements, productMap);
    const tStockDed1 = performance.now();
    stockDeductDuration = Math.round(tStockDed1 - tStockDed0);

    dbOperations.push({
      step: 5,
      name: 'batchDeductStock (SQL UPDATE Product)',
      model: 'Product',
      type: 'UPDATE',
      isTransaction: true,
      isSequential: true,
      startMs: Math.round(tStockDed0 - tTotalStart),
      endMs: Math.round(tStockDed1 - tTotalStart),
      durationMs: stockDeductDuration,
      recordsReturned: 1
    });

    // 10 & 11. Order & Order Items Creation
    const tOrder0 = performance.now();
    const order = await tx.order.create({
      data: {
        orderNumber,
        customerId: customer!.id,
        companyId: session.companyId || null,
        createdByUserId: session.userId,
        status: 'NEW',
        totalPacks: promoResult.totalPacks,
        totalBlocks: promoResult.totalBlocks,
        totalCases: promoResult.totalCases,
        totalPrice: promoResult.totalPrice,
        fileUrl: null,
        fileId: null,
        fileName: null,
        createdAt: now,
        updatedAt: now,
        items: {
          create: promoResult.items.map(vi => ({
            productId: vi.productId,
            productNameSnapshot: vi.name,
            skuSnapshot: vi.sku,
            baseQuantityPacks: vi.baseQuantityPacks,
            totalQuantityPacks: vi.totalQuantityPacks,
            quantityPacks: vi.totalQuantityPacks,
            price: vi.originalPrice,
            effectivePrice: vi.effectivePrice,
            itemTotalPrice: vi.itemTotalPrice
          }))
        }
      },
      select: { id: true, orderNumber: true, items: { select: { id: true, productId: true } } }
    });
    const tOrder1 = performance.now();
    orderCreateDuration = Math.round(tOrder1 - tOrder0);

    dbOperations.push({
      step: 6,
      name: 'order.create + orderItem.create',
      model: 'Order + OrderItem',
      type: 'INSERT',
      isTransaction: true,
      isSequential: true,
      startMs: Math.round(tOrder0 - tTotalStart),
      endMs: Math.round(tOrder1 - tTotalStart),
      durationMs: orderCreateDuration,
      recordsReturned: 1 + order.items.length
    });

    // 12. OrderItemSku Creation
    const tSku0 = performance.now();
    const skuRows = [{
      orderItemId: order.items[0].id,
      productId: testProduct.id,
      packs: 10,
      sku: testProduct.sku,
      name: testProduct.name
    }];
    await tx.orderItemSku.createMany({ data: skuRows });
    const tSku1 = performance.now();
    skuCreateDuration = Math.round(tSku1 - tSku0);

    dbOperations.push({
      step: 7,
      name: 'orderItemSku.createMany',
      model: 'OrderItemSku',
      type: 'INSERT',
      isTransaction: true,
      isSequential: true,
      startMs: Math.round(tSku0 - tTotalStart),
      endMs: Math.round(tSku1 - tTotalStart),
      durationMs: skuCreateDuration,
      recordsReturned: 1
    });

    return order;
  });

  const tTx1 = performance.now();
  const txTotalDuration = Math.round(tTx1 - tTx0);

  stageTimings['9_StockDeduction'] = stockDeductDuration;
  stageTimings['10_OrderCreation'] = orderCreateDuration;
  stageTimings['11_OrderItemCreation'] = orderCreateDuration;
  stageTimings['12_SKUAllocations'] = skuCreateDuration;
  stageTimings['15_TransactionDuration'] = txTotalDuration;

  // -------------------------------------------------------------
  // Stage 16: External Services
  // -------------------------------------------------------------
  stageTimings['16_ExternalServices'] = 0; // None inside or blocking order path

  // -------------------------------------------------------------
  // Stage 17: Excel Generation Trigger
  // -------------------------------------------------------------
  const tExcel0 = performance.now();
  // Fire and forget Promise trigger (non-blocking)
  void OrdersService.generateAndAttachExcel(
    savedOrder.id,
    orderNumber,
    customer!.name,
    promoResult.items.map((vi, idx) => ({
      ...vi,
      skuAllocations: itemAllocationsByIndex.get(idx)
    })),
    {
      totalBlocks: promoResult.totalBlocks,
      totalCases: promoResult.totalCases,
      totalPrice: promoResult.totalPrice
    }
  );
  stageTimings['17_ExcelGenerationTrigger'] = Math.round(performance.now() - tExcel0);

  // -------------------------------------------------------------
  // Stage 13: Audit Log (Sequential, blocking DB call)
  // -------------------------------------------------------------
  const tAudit0 = performance.now();
  await AuditService.log({
    userId: customer!.id,
    action: 'SUBMIT_ORDER',
    details: `[DIAGNOSTIC] ${orderNumber}`,
    newValue: 'diagnostic'
  });
  const tAudit1 = performance.now();
  const auditDuration = Math.round(tAudit1 - tAudit0);

  dbOperations.push({
    step: 8,
    name: 'AuditService.log (AuditLog.create)',
    model: 'AuditLog',
    type: 'INSERT',
    isTransaction: false,
    isSequential: true,
    startMs: Math.round(tAudit0 - tTotalStart),
    endMs: Math.round(tAudit1 - tTotalStart),
    durationMs: auditDuration,
    recordsReturned: 1
  });

  stageTimings['13_AuditLog'] = auditDuration;

  // -------------------------------------------------------------
  // Stage 18: Final Response
  // -------------------------------------------------------------
  const tResp0 = performance.now();
  const response = {
    success: true,
    order: savedOrder,
    message: `Заказ ${orderNumber} успешно оформлен!`
  };
  const jsonResponse = JSON.stringify(response);
  const responseBytes = Buffer.byteLength(jsonResponse, 'utf-8');
  stageTimings['18_FinalResponse'] = Math.round(performance.now() - tResp0);

  const totalOrderTime = Math.round(performance.now() - tTotalStart);

  console.log('--- 18 STAGES DETAILED MEASUREMENTS ---');
  for (const [stage, ms] of Object.entries(stageTimings)) {
    const pct = ((ms / totalOrderTime) * 100).toFixed(1);
    console.log(`  ${stage.padEnd(30)}: ${String(ms).padStart(6)} ms (${pct}%)`);
  }
  console.log(`---------------------------------------------------------------`);
  console.log(`TOTAL POST /api/orders DURATION:      ${totalOrderTime} ms`);
  console.log(`Response Payload Size:                 ${responseBytes} bytes\n`);

  console.log('--- DATABASE OPERATIONS MATRIX (Exact Round Trips: ' + dbOperations.length + ') ---');
  console.table(dbOperations);

  // Clean up diagnostic order and restore stock immediately
  console.log('\n--- Cleaning up diagnostic order & restoring stock ---');
  if (!savedOrder?.id || typeof savedOrder.id !== 'string' || savedOrder.id.trim() === '') {
    throw new Error('Refusing cleanup: missing orderId');
  }
  await prisma.orderItemSku.deleteMany({ where: { orderItem: { orderId: savedOrder.id } } });
  await prisma.orderItem.deleteMany({ where: { orderId: savedOrder.id } });
  await prisma.order.delete({ where: { id: savedOrder.id } });
  await prisma.product.update({
    where: { id: testProduct.id },
    data: { stockPacks: { increment: 10 } }
  });
  console.log('✓ Cleaned up diagnostic order and restored stock.');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
