import prisma from '../src/lib/db';
import { OrdersService } from '../src/lib/orders/orders.service';

async function main() {
  console.log('--- RUNNING TEST: ORDER DELETION SUITE ---');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`[PASS] ${msg}`);
      passed++;
    } else {
      console.error(`[FAIL] ${msg}`);
      failed++;
    }
  }

  // Find or create a test admin user in DB
  let dbAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!dbAdmin) {
    dbAdmin = await prisma.user.create({
      data: {
        email: `del_admin_${Date.now()}@test.com`,
        name: 'Delete Test Admin',
        passwordHash: 'dummy',
        role: 'ADMIN'
      }
    });
  }

  // Set up mock sessions
  const adminSession: any = {
    userId: dbAdmin.id,
    name: dbAdmin.name,
    email: dbAdmin.email,
    role: 'ADMIN',
    permissions: ['*']
  };

  const sellerSession: any = {
    userId: 'seller-test-user-id',
    name: 'Seller User',
    email: 'seller@test.com',
    role: 'SELLER',
    permissions: ['orders:view_all', 'orders:create', 'orders:edit']
  };

  const customerSession: any = {
    userId: 'customer-test-user-id',
    name: 'Customer User',
    email: 'customer@test.com',
    role: 'CUSTOMER',
    permissions: ['orders:view_own', 'orders:create']
  };

  // Find or create a test customer in DB
  let dbCustomer = await prisma.user.findFirst({ where: { role: 'CUSTOMER' } });
  if (!dbCustomer) {
    dbCustomer = await prisma.user.create({
      data: {
        email: `del_cust_${Date.now()}@test.com`,
        name: 'Delete Test Customer',
        passwordHash: 'dummy',
        role: 'CUSTOMER'
      }
    });
  }

  // Find or create test products
  let testProd = await prisma.product.findFirst({ where: { isActive: true } });
  if (!testProd) {
    testProd = await prisma.product.create({
      data: {
        sku: `DEL-TEST-${Date.now()}`,
        name: 'Delete Test Product',
        basePrice: 15000,
        stockPacks: 1000,
        isActive: true
      }
    });
  }

  const initialStock = testProd.stockPacks;

  // Find or create test fixed-amount promotion
  const promo = await prisma.promotion.create({
    data: {
      name: `Promo Test ${Date.now()}`,
      type: 'ORDER_FIXED_AMOUNT',
      allocatedAmount: 200000,
      consumedAmount: 50000,
      remainingAmount: 150000,
      isActive: true,
      startDate: new Date(),
      endDate: new Date(Date.now() + 86400000)
    }
  });

  const initialRemainingBudget = promo.remainingAmount;
  const initialConsumedBudget = promo.consumedAmount;

  try {
    // ------------------------------------------------------------------
    // TEST 1: ADMIN can delete DRAFT without stock reversal
    // ------------------------------------------------------------------
    const draftOrder = await prisma.order.create({
      data: {
        orderNumber: `DEL-DRAFT-${Date.now()}`,
        customerId: dbCustomer.id,
        status: 'DRAFT',
        totalPacks: 50,
        totalBlocks: 5,
        totalCases: 0.1,
        totalPrice: 75000,
        items: {
          create: [
            {
              productId: testProd.id,
              quantityPacks: 50,
              totalQuantityPacks: 50,
              price: 15000
            }
          ]
        }
      }
    });

    const draftRes = await OrdersService.deleteOrder(adminSession, draftOrder.id);
    assert(draftRes.success, 'Test 1: ADMIN successfully deletes DRAFT order');

    const draftCheck = await prisma.order.findUnique({ where: { id: draftOrder.id } });
    assert(draftCheck === null, 'Test 1: DRAFT order record removed from DB');

    // ------------------------------------------------------------------
    // TEST 2, 3, 4, 5, 6: ADMIN deletes NEW order with stock & budget restoration
    // ------------------------------------------------------------------
    // Simulate stock decrement and budget consumption as createOrder does
    const orderPacks = 100;
    await prisma.product.update({
      where: { id: testProd.id },
      data: { stockPacks: { decrement: orderPacks } }
    });

    const promoDiscountAmount = 25000;
    await prisma.promotion.update({
      where: { id: promo.id },
      data: {
        remainingAmount: { decrement: promoDiscountAmount },
        consumedAmount: { increment: promoDiscountAmount }
      }
    });

    const newOrder = await prisma.order.create({
      data: {
        orderNumber: `DEL-NEW-${Date.now()}`,
        customerId: dbCustomer.id,
        status: 'NEW',
        totalPacks: orderPacks,
        totalBlocks: 10,
        totalCases: 0.2,
        totalPrice: 150000,
        items: {
          create: [
            {
              productId: testProd.id,
              quantityPacks: orderPacks,
              totalQuantityPacks: orderPacks,
              price: 15000,
              promotionId: promo.id,
              promotionDiscount: promoDiscountAmount,
              skuAllocations: {
                create: [
                  {
                    productId: testProd.id,
                    packs: orderPacks,
                    sku: testProd.sku,
                    name: testProd.name
                  }
                ]
              }
            }
          ]
        },
        documents: {
          create: [
            {
              type: 'WAREHOUSE_ASSEMBLY_REQUEST',
              fileName: 'test_request.xlsx',
              fileUrl: '/mock/test_request.xlsx',
              fileId: 'mock-doc-id-123'
            }
          ]
        }
      },
      include: { items: { include: { skuAllocations: true } }, documents: true }
    });

    const orderItemId = newOrder.items[0].id;
    const orderDocId = newOrder.documents[0].id;

    // Verify stock is currently decremented
    const prodBeforeDelete = await prisma.product.findUnique({ where: { id: testProd.id } });
    assert(prodBeforeDelete?.stockPacks === initialStock - orderPacks, 'Pre-check: Stock decremented before delete');

    // Perform deletion by ADMIN
    const deleteNewRes = await OrdersService.deleteOrder(adminSession, newOrder.id, { reason: 'Test clean-up' });
    assert(deleteNewRes.success, 'Test 2: ADMIN successfully deletes NEW order');

    // Test 3: Stock after deletion is restored to initial
    const prodAfterDelete = await prisma.product.findUnique({ where: { id: testProd.id } });
    assert(prodAfterDelete?.stockPacks === initialStock, `Test 3: Stock is restored to initial (${prodAfterDelete?.stockPacks} === ${initialStock})`);

    // Test 4: OrderItemSku deleted
    const itemSkusCheck = await prisma.orderItemSku.findMany({ where: { orderItemId } });
    assert(itemSkusCheck.length === 0, 'Test 4: OrderItemSku records cascade-deleted');

    // Test 5: Documents deleted
    const docsCheck = await prisma.orderDocument.findUnique({ where: { id: orderDocId } });
    assert(docsCheck === null, 'Test 5: OrderDocument cascade-deleted');

    // Test 6: AuditLog saved
    const auditLogs = await prisma.auditLog.findMany({
      where: { action: 'DELETE_ORDER' },
      orderBy: { timestamp: 'desc' },
      take: 1
    });
    assert(auditLogs.length > 0 && auditLogs[0].details.includes(newOrder.orderNumber), 'Test 6: AuditLog record saved with DELETE_ORDER and order details');

    // Test 11: Promotion budget restored
    const promoAfterDelete = await prisma.promotion.findUnique({ where: { id: promo.id } });
    assert(promoAfterDelete?.remainingAmount === initialRemainingBudget, 'Test 11: Promotion remainingAmount restored');
    assert(promoAfterDelete?.consumedAmount === initialConsumedBudget, 'Test 11: Promotion consumedAmount restored');

    // ------------------------------------------------------------------
    // TEST 7: Regular seller gets 403
    // ------------------------------------------------------------------
    const sellerOrder = await prisma.order.create({
      data: {
        orderNumber: `DEL-SELLER-${Date.now()}`,
        customerId: dbCustomer.id,
        status: 'NEW',
        totalPacks: 20,
        totalBlocks: 2,
        totalCases: 0.04,
        totalPrice: 30000,
        items: { create: [{ productId: testProd.id, quantityPacks: 20, price: 15000 }] }
      }
    });

    let sellerForbidden = false;
    try {
      await OrdersService.deleteOrder(sellerSession, sellerOrder.id);
    } catch (err: any) {
      if (err.status === 403 || err.message.includes('прав')) {
        sellerForbidden = true;
      }
    }
    assert(sellerForbidden, 'Test 7: Regular seller receives 403 Forbidden');

    // ------------------------------------------------------------------
    // TEST 8: Customer gets 403
    // ------------------------------------------------------------------
    let customerForbidden = false;
    try {
      await OrdersService.deleteOrder(customerSession, sellerOrder.id);
    } catch (err: any) {
      if (err.status === 403 || err.message.includes('прав')) {
        customerForbidden = true;
      }
    }
    assert(customerForbidden, 'Test 8: Customer receives 403 Forbidden');

    // ------------------------------------------------------------------
    // TEST 9: COMPLETED order cannot be deleted
    // ------------------------------------------------------------------
    const completedOrder = await prisma.order.create({
      data: {
        orderNumber: `DEL-COMPLETED-${Date.now()}`,
        customerId: dbCustomer.id,
        status: 'COMPLETED',
        totalPacks: 10,
        totalBlocks: 1,
        totalCases: 0.02,
        totalPrice: 15000,
        items: { create: [{ productId: testProd.id, quantityPacks: 10, price: 15000 }] }
      }
    });

    let completedBlocked = false;
    try {
      await OrdersService.deleteOrder(adminSession, completedOrder.id);
    } catch (err: any) {
      if (err.status === 409 || err.message.includes('запрещено')) {
        completedBlocked = true;
      }
    }
    assert(completedBlocked, 'Test 9: COMPLETED order deletion blocked (409 Conflict)');

    // ------------------------------------------------------------------
    // TEST 10: CANCELLED order does not revert stock a second time
    // ------------------------------------------------------------------
    const cancelledOrder = await prisma.order.create({
      data: {
        orderNumber: `DEL-CANCELLED-${Date.now()}`,
        customerId: dbCustomer.id,
        status: 'CANCELLED',
        totalPacks: 50,
        totalBlocks: 5,
        totalCases: 0.1,
        totalPrice: 75000,
        items: {
          create: [
            {
              productId: testProd.id,
              quantityPacks: 50,
              totalQuantityPacks: 50,
              price: 15000,
              skuAllocations: {
                create: [{ productId: testProd.id, packs: 50, sku: testProd.sku, name: testProd.name }]
              }
            }
          ]
        }
      }
    });

    const stockBeforeCancelDelete = (await prisma.product.findUnique({ where: { id: testProd.id } }))?.stockPacks;
    const deleteCancelRes = await OrdersService.deleteOrder(adminSession, cancelledOrder.id);
    assert(deleteCancelRes.success, 'Test 10: CANCELLED order successfully deleted');
    const stockAfterCancelDelete = (await prisma.product.findUnique({ where: { id: testProd.id } }))?.stockPacks;
    assert(stockAfterCancelDelete === stockBeforeCancelDelete, 'Test 10: Stock was NOT incremented again for CANCELLED order');

    // Clean up temporary completed / seller test orders
    await prisma.order.deleteMany({ where: { id: { in: [sellerOrder.id, completedOrder.id] } } });

  } finally {
    // Clean up test promo
    await prisma.promotion.delete({ where: { id: promo.id } }).catch(() => {});
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
