import prisma from '../src/lib/db';
import { Prisma } from '@prisma/client';

async function main() {
  console.log('--- Testing batch atomic stock update ---');

  // Find 2 active products
  const prods = await prisma.product.findMany({
    where: { isActive: true },
    take: 2,
    select: { id: true, name: true, stockPacks: true }
  });

  if (prods.length < 2) {
    console.log('Not enough products to test');
    process.exit(0);
  }

  const p1 = prods[0];
  const p2 = prods[1];
  console.log('Product 1 before:', p1.id, p1.stockPacks);
  console.log('Product 2 before:', p2.id, p2.stockPacks);

  const stockDecrements = new Map<string, number>();
  stockDecrements.set(p1.id, 10);
  stockDecrements.set(p2.id, 20);

  // Test inside transaction
  await prisma.$transaction(async (tx) => {
    // Construct single batch UPDATE with VALUES
    const entries = Array.from(stockDecrements.entries());
    const valueClauses = entries.map(([id, needed]) => Prisma.sql`(${id}::text, ${needed}::integer)`);

    const updatedRows = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "Product" AS p
      SET "stockPacks" = p."stockPacks" - v.needed
      FROM (VALUES ${Prisma.join(valueClauses)}) AS v(id, needed)
      WHERE p.id = v.id AND p."stockPacks" >= v.needed
      RETURNING p.id
    `;

    console.log('Updated rows returned:', updatedRows);
    if (updatedRows.length !== entries.length) {
      throw new Error('Not all items had sufficient stock');
    }

    // Restore stock back immediately within the same transaction so no state change is persisted
    const restoreClauses = entries.map(([id, needed]) => Prisma.sql`(${id}::text, ${needed}::integer)`);
    await tx.$executeRaw`
      UPDATE "Product" AS p
      SET "stockPacks" = p."stockPacks" + v.needed
      FROM (VALUES ${Prisma.join(restoreClauses)}) AS v(id, needed)
      WHERE p.id = v.id
    `;
  });

  console.log('SUCCESS! Batch atomic stock deduction works in 1 roundtrip!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
