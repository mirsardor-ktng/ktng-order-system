import prisma from '../src/lib/db';
import { OrdersService } from '../src/lib/orders/orders.service';
import { JWTPayload } from '../src/lib/auth';

async function main() {
  console.log('=== REGRESSION TEST: Draft Lifecycle & ReferenceError: orderFileUrl Fix ===\n');

  // 1. Pick an active test customer
  const user = await prisma.user.findFirst({
    where: { isActive: true, role: 'CUSTOMER' },
    include: { company: true }
  }) || await prisma.user.findFirst({
    where: { isActive: true },
    include: { company: true }
  });

  if (!user) {
    throw new Error('No active user found in database');
  }

  const session: JWTPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role as any,
    permissions: ['orders:create', 'orders:edit', 'orders:view_all', 'orders:validation:view'],
    companyId: user.companyId || undefined
  };

  // 2. Pick 2 active products with stock >= 50
  const products = await prisma.product.findMany({
    where: { isActive: true, stockPacks: { gte: 50 } },
    take: 2
  });

  if (products.length < 2) {
    throw new Error('Need at least 2 active products with stock >= 50 for regression test');
  }

  const [p1, p2] = products;
  const initialStockP1 = p1.stockPacks;
  const initialStockP2 = p2.stockPacks;
  console.log(`Test customer: ${user.name} (${user.id})`);
  console.log(`Product 1: ${p1.name} (SKU: ${p1.sku}, Stock: ${initialStockP1})`);
  console.log(`Product 2: ${p2.name} (SKU: ${p2.sku}, Stock: ${initialStockP2})`);

  // ==========================================
  // TEST A: Standard NEW ORDER Flow
  // ==========================================
  console.log('\n--- TEST A: Standard NEW ORDER Flow ---');
  const newOrderResult = await OrdersService.createOrder(session, {
    items: [{ productId: p1.id, quantityPacks: 10 }],
    status: 'NEW'
  });
  console.log(`Created NEW order: ${newOrderResult.order.orderNumber} (ID: ${newOrderResult.order.id})`);
  if (newOrderResult.order.status !== 'NEW') {
    throw new Error(`Expected status NEW, got: ${newOrderResult.order.status}`);
  }

  // Verify stock deduction for TEST A
  const p1AfterNew = await prisma.product.findUnique({ where: { id: p1.id } });
  if (p1AfterNew!.stockPacks !== initialStockP1 - 10) {
    throw new Error(`Stock deduction failed for NEW order: expected ${initialStockP1 - 10}, got ${p1AfterNew!.stockPacks}`);
  }
  console.log(`Stock correctly deducted: ${initialStockP1} -> ${p1AfterNew!.stockPacks}`);

  // Cancel order to clean up
  await OrdersService.updateOrderStatus(session, {
    orderId: newOrderResult.order.id,
    status: 'CANCELLED',
    reason: 'Regression test cleanup TEST A'
  });
  console.log('Order A cancelled and stock restored cleanly.');

  // ==========================================
  // TEST B: DRAFT ORDER Flow (Draft -> Edit Draft -> Submit)
  // ==========================================
  console.log('\n--- TEST B: DRAFT ORDER Flow (Draft -> Edit Draft -> Submit) ---');

  // Step 1: Create Draft
  console.log('Step 1: Creating draft order...');
  const draftResult = await OrdersService.createOrder(session, {
    items: [{ productId: p1.id, quantityPacks: 10 }],
    status: 'DRAFT'
  });
  const draftId = draftResult.order.id;
  const draftNumber = draftResult.order.orderNumber;
  console.log(`Draft created: ${draftNumber} (ID: ${draftId}, Status: ${draftResult.order.status})`);

  if (draftResult.order.status !== 'DRAFT') {
    throw new Error(`Expected status DRAFT, got: ${draftResult.order.status}`);
  }

  // Stock must NOT be deducted for draft
  const p1AfterDraft = await prisma.product.findUnique({ where: { id: p1.id } });
  if (p1AfterDraft!.stockPacks !== initialStockP1) {
    throw new Error(`Stock must not be deducted for DRAFT: expected ${initialStockP1}, got ${p1AfterDraft!.stockPacks}`);
  }
  console.log(`Stock unchanged for draft (remains ${initialStockP1}).`);

  // Step 2: Edit Draft (change quantity and add second product)
  console.log('\nStep 2: Editing draft with updated items...');
  const updateDraftResult = await OrdersService.updateOrder(session, {
    orderId: draftId,
    items: [
      { productId: p1.id, quantityPacks: 20 },
      { productId: p2.id, quantityPacks: 10 }
    ],
    status: 'DRAFT'
  });
  console.log(`Draft updated successfully: ${updateDraftResult.message}`);
  if (updateDraftResult.order.status !== 'DRAFT') {
    throw new Error(`Expected status DRAFT after edit, got: ${updateDraftResult.order.status}`);
  }

  // Step 3: SUBMIT DRAFT ORDER (Draft -> NEW)
  // This was where "ReferenceError: orderFileUrl is not defined" occurred!
  console.log('\nStep 3: Submitting draft order (converting DRAFT -> NEW)...');
  const tSubmit0 = performance.now();
  const submitResult = await OrdersService.updateOrder(session, {
    orderId: draftId,
    items: [
      { productId: p1.id, quantityPacks: 20 },
      { productId: p2.id, quantityPacks: 10 }
    ],
    status: 'NEW'
  });
  const submitDuration = Math.round(performance.now() - tSubmit0);
  console.log(`Draft order submitted successfully in ${submitDuration} ms!`);
  console.log(`Result message: "${submitResult.message}"`);
  console.log(`New Order status: ${submitResult.order.status}`);

  if (submitResult.order.status !== 'NEW') {
    throw new Error(`Expected status NEW after submit, got: ${submitResult.order.status}`);
  }

  // Verify stock deduction for both items
  const p1AfterSubmit = await prisma.product.findUnique({ where: { id: p1.id } });
  const p2AfterSubmit = await prisma.product.findUnique({ where: { id: p2.id } });
  console.log(`Product 1 stock: ${initialStockP1} -> ${p1AfterSubmit!.stockPacks} (deducted 20)`);
  console.log(`Product 2 stock: ${initialStockP2} -> ${p2AfterSubmit!.stockPacks} (deducted 10)`);

  if (p1AfterSubmit!.stockPacks !== initialStockP1 - 20) {
    throw new Error(`P1 stock mismatch: expected ${initialStockP1 - 20}, got ${p1AfterSubmit!.stockPacks}`);
  }
  if (p2AfterSubmit!.stockPacks !== initialStockP2 - 10) {
    throw new Error(`P2 stock mismatch: expected ${initialStockP2 - 10}, got ${p2AfterSubmit!.stockPacks}`);
  }

  // Step 4: Verify Excel On-Demand Generation Fallback
  console.log('\nStep 4: Testing Excel generation on-demand fallback (ensureExcelGenerated)...');
  const excelDoc = await OrdersService.ensureExcelGenerated(draftId);
  console.log('ensureExcelGenerated result:', excelDoc);
  if (!excelDoc || !excelDoc.fileId) {
    throw new Error('ensureExcelGenerated failed to produce a valid file descriptor');
  }
  console.log(`Excel file confirmed: ${excelDoc.fileName} (fileId: ${excelDoc.fileId})`);

  // Step 5: Clean up by cancelling the order
  console.log('\nStep 5: Cleaning up (cancelling submitted order)...');
  await OrdersService.updateOrderStatus(session, {
    orderId: draftId,
    status: 'CANCELLED',
    reason: 'Regression test cleanup TEST B'
  });

  const p1Final = await prisma.product.findUnique({ where: { id: p1.id } });
  const p2Final = await prisma.product.findUnique({ where: { id: p2.id } });
  if (p1Final!.stockPacks !== initialStockP1 || p2Final!.stockPacks !== initialStockP2) {
    throw new Error(`Stock not fully restored after cancellation: P1=${p1Final!.stockPacks}, P2=${p2Final!.stockPacks}`);
  }
  console.log(`Stock fully restored to initial values: P1=${p1Final!.stockPacks}, P2=${p2Final!.stockPacks}`);

  console.log('\n=============================================================');
  console.log('✓ ALL REGRESSION TESTS PASSED!');
  console.log('  - ReferenceError: orderFileUrl is resolved');
  console.log('  - NEW order flow works');
  console.log('  - DRAFT -> Edit -> Submit flow works');
  console.log('  - Stock atomic deduction & restore work');
  console.log('  - Excel fallback ensureExcelGenerated works');
  console.log('=============================================================');
}

main().catch(err => {
  console.error('\n❌ REGRESSION TEST FAILED:', err);
  process.exit(1);
});
