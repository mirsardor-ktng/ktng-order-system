import prisma from '../src/lib/db';
import { OrdersService } from '../src/lib/orders/orders.service';
import { JWTPayload } from '../src/lib/auth';

async function main() {
  console.log('=== STARTING ORDER CANCELLATION TEST SUITE ===\n');

  const ts = Date.now();
  const testEmail = `cancel_test_${ts}@example.com`;

  // 1. Setup test user & company
  const company = await prisma.company.create({
    data: {
      name: `Cancel Test Company ${ts}`,
      code: `CTC_${ts}`
    }
  });

  const user = await prisma.user.create({
    data: {
      email: testEmail,
      name: `Cancel Test User ${ts}`,
      passwordHash: 'dummy_hash',
      role: 'ADMIN',
      companyId: company.id
    }
  });

  const session: JWTPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: 'ADMIN',
    roleName: 'Суперадминистратор',
    permissions: ['*'],
    companyId: company.id
  };

  // 2. Setup product with known stock
  const initialStock = 500;
  const product = await prisma.product.create({
    data: {
      sku: `SKU-CANCEL-${ts}`,
      name: `Cancel Test Product ${ts}`,
      basePrice: 15000,
      stockPacks: initialStock,
      imageUrl: 'default-pack',
      isActive: true
    }
  });

  // 3. Setup fixed-amount promotion
  const promo = await prisma.promotion.create({
    data: {
      name: `Fixed Promo ${ts}`,
      type: 'ORDER_FIXED_AMOUNT',
      isActive: true,
      allocatedAmount: 100000,
      remainingAmount: 50000,
      consumedAmount: 50000,
      startDate: new Date(),
      endDate: new Date(Date.now() + 86400000)
    }
  });

  const orderPacks = 20;
  const promoDiscount = 10000;

  try {
    // -------------------------------------------------------------
    // Test 1: Order Cancellation with Stock & Promo Reversal
    // -------------------------------------------------------------
    console.log('[Test 1] Creating active order and verifying cancellation...');

    // Simulate order creation (stock deducted)
    await prisma.product.update({
      where: { id: product.id },
      data: { stockPacks: { decrement: orderPacks } }
    });

    const newOrder = await prisma.order.create({
      data: {
        orderNumber: `ORD-CANCEL-${ts}`,
        customerId: user.id,
        createdByUserId: user.id,
        companyId: company.id,
        status: 'NEW',
        totalPrice: 290000,
        totalPacks: orderPacks,
        totalBlocks: 2,
        totalCases: 0,
        items: {
          create: [
            {
              productId: product.id,
              productNameSnapshot: product.name,
              quantityPacks: orderPacks,
              quantityBlocks: 2,
              quantityCases: 0,
              price: 15000,
              itemTotalPrice: 290000,
              promotionId: promo.id,
              promotionDiscount: promoDiscount,
              skuAllocations: {
                create: [
                  {
                    productId: product.id,
                    packs: orderPacks,
                    sku: product.sku,
                    name: product.name
                  }
                ]
              }
            }
          ]
        }
      },
      include: { items: { include: { skuAllocations: true } } }
    });

    // Check stock after order creation
    const productAfterOrder = await prisma.product.findUnique({ where: { id: product.id } });
    if (productAfterOrder?.stockPacks !== initialStock - orderPacks) {
      throw new Error(`Expected product stock ${initialStock - orderPacks}, got ${productAfterOrder?.stockPacks}`);
    }
    console.log(`✓ Product stock properly reduced from ${initialStock} to ${productAfterOrder?.stockPacks}`);

    // Cancel order
    const cancelReason = 'Customer changed mind';
    const cancelRes = await OrdersService.updateOrderStatus(session, {
      orderId: newOrder.id,
      status: 'CANCELLED',
      reason: cancelReason
    });

    if (cancelRes.order.status !== 'CANCELLED') {
      throw new Error(`Expected order status CANCELLED, got ${cancelRes.order.status}`);
    }
    console.log('✓ Order status successfully transitioned to CANCELLED');

    // Verify order remains in database
    const orderInDb = await prisma.order.findUnique({ where: { id: newOrder.id } });
    if (!orderInDb) {
      throw new Error('Cancelled order must NOT be removed from database');
    }
    if (orderInDb.status !== 'CANCELLED') {
      throw new Error(`DB order status must be CANCELLED, got ${orderInDb.status}`);
    }
    console.log('✓ Order remains in database with status CANCELLED');

    // Verify stock is restored
    const productAfterCancel = await prisma.product.findUnique({ where: { id: product.id } });
    if (productAfterCancel?.stockPacks !== initialStock) {
      throw new Error(`Expected restored stock ${initialStock}, got ${productAfterCancel?.stockPacks}`);
    }
    console.log(`✓ Stock successfully restored via OrderItemSku allocations to ${productAfterCancel?.stockPacks}`);

    // Verify fixed promo budget refunded
    const promoAfterCancel = await prisma.promotion.findUnique({ where: { id: promo.id } });
    if (promoAfterCancel?.remainingAmount !== 50000 + promoDiscount) {
      throw new Error(`Expected refunded promo budget ${50000 + promoDiscount}, got ${promoAfterCancel?.remainingAmount}`);
    }
    console.log(`✓ Promotion budget successfully refunded by ${promoDiscount} so'm`);

    // Verify AuditLog
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        action: 'CANCEL_ORDER',
        details: { contains: newOrder.orderNumber }
      },
      orderBy: { timestamp: 'desc' }
    });
    if (!auditLog) {
      throw new Error('Expected CANCEL_ORDER audit log entry');
    }
    const auditDetails = JSON.parse(auditLog.details);
    if (auditDetails.reason !== cancelReason || !auditDetails.stockReverted) {
      throw new Error(`Invalid audit log details: ${auditLog.details}`);
    }
    console.log('✓ AuditLog accurately recorded action=CANCEL_ORDER with structured details');

    // -------------------------------------------------------------
    // Test 2: Double-Cancellation Prevention (409 Conflict)
    // -------------------------------------------------------------
    console.log('\n[Test 2] Testing double-cancellation prevention...');
    let doubleCancelBlocked = false;
    try {
      await OrdersService.updateOrderStatus(session, {
        orderId: newOrder.id,
        status: 'CANCELLED',
        reason: 'Attempting second cancel'
      });
    } catch (err: any) {
      doubleCancelBlocked = true;
      if (!err.message.includes('уже отменен') && !err.message.includes('Нельзя изменить статус отмененного')) {
        throw new Error(`Unexpected error message: ${err.message}`);
      }
      console.log(`✓ Double cancellation rejected: "${err.message}"`);
    }
    if (!doubleCancelBlocked) {
      throw new Error('Double cancellation should have thrown an error!');
    }

    // -------------------------------------------------------------
    // Test 3: Terminal State Protection (SHIPPED / COMPLETED cannot be cancelled)
    // -------------------------------------------------------------
    console.log('\n[Test 3] Testing terminal state protection (SHIPPED / COMPLETED)...');
    const shippedOrder = await prisma.order.create({
      data: {
        orderNumber: `ORD-SHIPPED-${ts}`,
        customerId: user.id,
        createdByUserId: user.id,
        companyId: company.id,
        status: 'SHIPPED',
        totalPrice: 150000,
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0
      }
    });

    let shippedCancelBlocked = false;
    try {
      await OrdersService.updateOrderStatus(session, {
        orderId: shippedOrder.id,
        status: 'CANCELLED',
        reason: 'Attempt cancel shipped order'
      });
    } catch (err: any) {
      shippedCancelBlocked = true;
      if (!err.message.includes('Нельзя отменить исполненный заказ')) {
        throw new Error(`Unexpected terminal cancel error message: ${err.message}`);
      }
      console.log(`✓ Cancellation of SHIPPED order correctly rejected: "${err.message}"`);
    }
    if (!shippedCancelBlocked) {
      throw new Error('Cancellation of SHIPPED order should have thrown an error!');
    }

    const completedOrder = await prisma.order.create({
      data: {
        orderNumber: `ORD-COMPL-${ts}`,
        customerId: user.id,
        createdByUserId: user.id,
        companyId: company.id,
        status: 'COMPLETED',
        totalPrice: 150000,
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0
      }
    });

    let completedCancelBlocked = false;
    try {
      await OrdersService.updateOrderStatus(session, {
        orderId: completedOrder.id,
        status: 'CANCELLED',
        reason: 'Attempt cancel completed order'
      });
    } catch (err: any) {
      completedCancelBlocked = true;
      if (!err.message.includes('Нельзя отменить исполненный заказ')) {
        throw new Error(`Unexpected terminal cancel error message: ${err.message}`);
      }
      console.log(`✓ Cancellation of COMPLETED order correctly rejected: "${err.message}"`);
    }
    if (!completedCancelBlocked) {
      throw new Error('Cancellation of COMPLETED order should have thrown an error!');
    }

    // -------------------------------------------------------------
    // Test 4: Visibility in Order History
    // -------------------------------------------------------------
    console.log('\n[Test 4] Verifying cancelled orders are visible in history...');
    const allUserOrders = await OrdersService.getOrders(session);
    const foundCancelled = allUserOrders.find((o: any) => o.id === newOrder.id);
    if (!foundCancelled) {
      throw new Error('Cancelled order must be visible in general order history');
    }
    if (foundCancelled.status !== 'CANCELLED') {
      throw new Error(`Expected status CANCELLED in history, got ${foundCancelled.status}`);
    }
    console.log('✓ Cancelled order is present in history with status CANCELLED');

    // -------------------------------------------------------------
    // Test 5: Parallel Race-Condition Atomic Cancellation (5 concurrent requests)
    // -------------------------------------------------------------
    console.log('\n[Test 5] Testing parallel race-condition atomic cancellation (5 concurrent requests)...');
    const concProduct = await prisma.product.create({
      data: {
        sku: `SKU-CONC-${ts}`,
        name: `Conc Product ${ts}`,
        basePrice: 20000,
        stockPacks: 100,
        imageUrl: 'default-pack',
        isActive: true
      }
    });

    const concPromo = await prisma.promotion.create({
      data: {
        name: `Conc Promo ${ts}`,
        type: 'ORDER_FIXED_AMOUNT',
        isActive: true,
        allocatedAmount: 100000,
        remainingAmount: 50000,
        consumedAmount: 50000,
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000)
      }
    });

    const concOrderPacks = 15;
    const concPromoDiscount = 5000;

    await prisma.product.update({
      where: { id: concProduct.id },
      data: { stockPacks: { decrement: concOrderPacks } }
    });

    const concOrder = await prisma.order.create({
      data: {
        orderNumber: `ORD-CONC-${ts}`,
        customerId: user.id,
        createdByUserId: user.id,
        companyId: company.id,
        status: 'NEW',
        totalPrice: 295000,
        totalPacks: concOrderPacks,
        totalBlocks: 1,
        totalCases: 0,
        items: {
          create: [
            {
              productId: concProduct.id,
              productNameSnapshot: concProduct.name,
              quantityPacks: concOrderPacks,
              quantityBlocks: 1,
              quantityCases: 0,
              price: 20000,
              itemTotalPrice: 295000,
              promotionId: concPromo.id,
              promotionDiscount: concPromoDiscount,
              skuAllocations: {
                create: [
                  {
                    productId: concProduct.id,
                    packs: concOrderPacks,
                    sku: concProduct.sku,
                    name: concProduct.name
                  }
                ]
              }
            }
          ]
        }
      },
      include: { items: { include: { skuAllocations: true } } }
    });

    const stockBeforeCancel = (await prisma.product.findUnique({ where: { id: concProduct.id } }))?.stockPacks ?? 0;
    const promoRemainingBefore = (await prisma.promotion.findUnique({ where: { id: concPromo.id } }))?.remainingAmount ?? 0;

    // Send 5 concurrent cancellation requests
    const cancelPromises = Array.from({ length: 5 }, (_, idx) =>
      OrdersService.updateOrderStatus(session, {
        orderId: concOrder.id,
        status: 'CANCELLED',
        reason: `Concurrent cancel attempt #${idx + 1}`
      })
    );

    const results = await Promise.allSettled(cancelPromises);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    console.log(`Concurrent cancellation results: ${fulfilled.length} fulfilled, ${rejected.length} rejected`);

    if (fulfilled.length !== 1) {
      throw new Error(`Expected exactly 1 request to succeed, but ${fulfilled.length} succeeded!`);
    }

    if (rejected.length !== 4) {
      throw new Error(`Expected exactly 4 requests to be rejected, but ${rejected.length} were rejected!`);
    }

    const concOrderInDb = await prisma.order.findUnique({ where: { id: concOrder.id } });
    if (concOrderInDb?.status !== 'CANCELLED') {
      throw new Error(`Expected order status CANCELLED, got ${concOrderInDb?.status}`);
    }

    const concProductAfter = await prisma.product.findUnique({ where: { id: concProduct.id } });
    if (concProductAfter?.stockPacks !== 100) {
      throw new Error(`Stock restored incorrectly: expected 100, got ${concProductAfter?.stockPacks}`);
    }

    const concPromoAfter = await prisma.promotion.findUnique({ where: { id: concPromo.id } });
    if (concPromoAfter?.remainingAmount !== promoRemainingBefore + concPromoDiscount) {
      throw new Error(`Promo budget restored incorrectly: expected ${promoRemainingBefore + concPromoDiscount}, got ${concPromoAfter?.remainingAmount}`);
    }

    const concAuditLogs = await prisma.auditLog.findMany({
      where: {
        action: 'CANCEL_ORDER',
        details: { contains: concOrder.orderNumber }
      }
    });
    if (concAuditLogs.length !== 1) {
      throw new Error(`Expected exactly 1 CANCEL_ORDER audit log, found ${concAuditLogs.length}`);
    }

    console.log('✓ Concurrency test passed: Exactly 1 request succeeded, 4 rejected');
    console.log('✓ Order status is CANCELLED');
    console.log(`✓ Product stock restored exactly once (${stockBeforeCancel} -> ${concProductAfter?.stockPacks})`);
    console.log(`✓ Promotion budget restored exactly once (${promoRemainingBefore} -> ${concPromoAfter?.remainingAmount})`);
    console.log(`✓ Exactly 1 CANCEL_ORDER audit log entry created`);

    // Clean up dedicated concurrency test entities
    await prisma.auditLog.deleteMany({ where: { details: { contains: concOrder.orderNumber } } }).catch(() => {});
    await prisma.orderItemSku.deleteMany({ where: { orderItem: { orderId: concOrder.id } } }).catch(() => {});
    await prisma.orderItem.deleteMany({ where: { orderId: concOrder.id } }).catch(() => {});
    await prisma.order.delete({ where: { id: concOrder.id } }).catch(() => {});
    await prisma.promotion.delete({ where: { id: concPromo.id } }).catch(() => {});
    await prisma.product.delete({ where: { id: concProduct.id } }).catch(() => {});

    console.log('\n=== ALL ORDER CANCELLATION TESTS PASSED! ===');
  } finally {
    // Cleanup test data
    await prisma.orderItemSku.deleteMany({ where: { orderItem: { order: { companyId: company.id } } } }).catch(() => {});
    await prisma.orderItem.deleteMany({ where: { order: { companyId: company.id } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { companyId: company.id } }).catch(() => {});
    await prisma.promotion.delete({ where: { id: promo.id } }).catch(() => {});
    await prisma.product.delete({ where: { id: product.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.company.delete({ where: { id: company.id } }).catch(() => {});
  }
}

main().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
