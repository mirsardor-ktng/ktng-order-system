import prisma from '../../src/lib/db';

async function main() {
  console.log('=== PHASE 13A: Cleaning Up Load Test Orders & Restoring Stock ===\n');

  const company = await prisma.company.findUnique({
    where: { code: 'LOADTEST' }
  });

  if (company) {
    // 1. Delete order documents, items, orderItemSkus, comments, orders for this company
    const orders = await prisma.order.findMany({
      where: { companyId: company.id },
      select: { id: true, orderNumber: true }
    });

    console.log(`Found ${orders.length} load test orders.`);

    if (orders.length > 0) {
      const orderIds = orders.map(o => o.id);

      await prisma.orderDocument.deleteMany({
        where: { orderId: { in: orderIds } }
      });
      await prisma.comment.deleteMany({
        where: { orderId: { in: orderIds } }
      });
      await prisma.orderItemSku.deleteMany({
        where: { orderItem: { orderId: { in: orderIds } } }
      });
      await prisma.orderItem.deleteMany({
        where: { orderId: { in: orderIds } }
      });
      const delResult = await prisma.order.deleteMany({
        where: { id: { in: orderIds } }
      });
      console.log(`✓ Deleted ${delResult.count} load test orders and related items.`);
    }
  }

  // 2. Reset load test products stock back to 1,000,000
  const resetProducts = await prisma.product.updateMany({
    where: { sku: { in: ['LOADTEST-SKU-1', 'LOADTEST-SKU-2'] } },
    data: { stockPacks: 1000000 }
  });
  console.log(`✓ Reset stock for ${resetProducts.count} load test products to 1,000,000.`);

  console.log('\n=== Cleanup completed successfully! ===');
}

main()
  .catch((err) => {
    console.error('Cleanup failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
