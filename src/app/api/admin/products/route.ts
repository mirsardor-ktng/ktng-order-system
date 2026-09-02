import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function requireAdmin(req: NextRequest) {
  const session = getSession(req);
  if (!session || session.role !== 'ADMIN') {
    throw new Error('Access denied');
  }
  return session;
}

async function requireAdminOrSeller(req: NextRequest) {
  const session = getSession(req);
  if (!session || (session.role !== 'ADMIN' && session.role !== 'SELLER')) {
    throw new Error('Access denied');
  }
  return session;
}

/**
 * GET: Returns all products with tags (Admin SKU Manager list or Seller Monitor)
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdminOrSeller(req);
    const products = await prisma.product.findMany({
      include: { tags: true },
      orderBy: { name: 'asc' }
    });
    return NextResponse.json(products);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}

/**
 * PUT: Updates product base parameters (pricing, favorite, active status, tags)
 * Supports both single product updates (by body.id) and bulk updates (by body.ids).
 */
export async function PUT(req: NextRequest) {
  try {
    const session = getSession(req);
    if (!session || (session.role !== 'ADMIN' && session.role !== 'SELLER')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await req.json();
    const { id, ids, basePrice, isFavorite, isActive, name, sku, stockPacks, tagIds } = body;

    // If SELLER, ensure only stockPacks is modified
    if (session.role === 'SELLER') {
      if (basePrice !== undefined || isFavorite !== undefined || isActive !== undefined || name !== undefined || sku !== undefined || (tagIds !== undefined && tagIds.length > 0)) {
        return NextResponse.json({ error: 'Роль SELLER не имеет права изменять наименование, SKU, цены или теги.' }, { status: 403 });
      }
    }

    if (!id && (!ids || !Array.isArray(ids))) {
      return NextResponse.json({ error: 'Не указаны идентификаторы товаров (id или ids)' }, { status: 400 });
    }

    // --- BULK UPDATE ---
    if (ids && Array.isArray(ids)) {
      if (ids.length === 0) {
        return NextResponse.json({ error: 'Список ids пуст.' }, { status: 400 });
      }

      await prisma.$transaction(async (tx) => {
        // Update common simple fields
        const updateData: any = {};
        if (basePrice !== undefined) updateData.basePrice = parseFloat(basePrice);
        if (isFavorite !== undefined) updateData.isFavorite = !!isFavorite;
        if (isActive !== undefined) updateData.isActive = !!isActive;
        if (stockPacks !== undefined) updateData.stockPacks = parseInt(stockPacks);

        if (Object.keys(updateData).length > 0) {
          await tx.product.updateMany({
            where: { id: { in: ids } },
            data: updateData
          });
        }

        // Relational tag updates need to be done individually per product
        if (tagIds !== undefined && Array.isArray(tagIds)) {
          for (const pid of ids) {
            await tx.product.update({
              where: { id: pid },
              data: {
                tags: { set: tagIds.map((tid: string) => ({ id: tid })) }
              }
            });
          }
        }
      });

      await prisma.auditLog.create({
        data: {
          userId: session.userId,
          action: 'BULK_UPDATE_PRODUCTS',
          details: `Администратор массово обновил ${ids.length} товаров: цены=${basePrice !== undefined}, теги=${tagIds !== undefined}, активен=${isActive !== undefined}`
        }
      });

      return NextResponse.json({ success: true, count: ids.length });
    }

    // --- SINGLE UPDATE ---
    const updateData: any = {};
    if (basePrice !== undefined) updateData.basePrice = parseFloat(basePrice);
    if (isFavorite !== undefined) updateData.isFavorite = !!isFavorite;
    if (isActive !== undefined) updateData.isActive = !!isActive;
    if (name) updateData.name = name;
    if (sku) updateData.sku = sku;
    if (stockPacks !== undefined) updateData.stockPacks = parseInt(stockPacks);

    // Handle tag re-assignment
    if (tagIds !== undefined && Array.isArray(tagIds)) {
      updateData.tags = { set: tagIds.map((tid: string) => ({ id: tid })) };
    }

    const product = await prisma.product.update({
      where: { id },
      data: updateData,
      include: { tags: true }
    });

    await prisma.auditLog.create({
      data: {
        userId: session.userId,
        action: 'UPDATE_PRODUCT',
        details: `Администратор обновил SKU ${product.sku}: цена=${product.basePrice}, запас=${product.stockPacks}, активен=${product.isActive}, изб=${product.isFavorite}`
      }
    });

    return NextResponse.json({ success: true, product });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}

/**
 * DELETE: Permanently removes a product and its order items (irreversible!)
 * Supports both single deletion (by id query param) and bulk deletion (by ids comma-separated query param).
 */
export async function DELETE(req: NextRequest) {
  try {
    const adminSession = await requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id') ?? undefined;
    const idsParam = searchParams.get('ids') ?? undefined;

    if (!id && !idsParam) {
      return NextResponse.json({ error: 'ID товара не указан.' }, { status: 400 });
    }

    // --- BULK DELETE ---
    if (idsParam) {
      const ids = idsParam.split(',').filter(Boolean);
      if (ids.length === 0) {
        return NextResponse.json({ error: 'Список ids пуст.' }, { status: 400 });
      }

      await prisma.$transaction(async (tx) => {
        await tx.orderItem.deleteMany({ where: { productId: { in: ids } } });
        await tx.product.deleteMany({ where: { id: { in: ids } } });
      });

      await prisma.auditLog.create({
        data: {
          userId: adminSession.userId,
          action: 'BULK_DELETE_PRODUCTS',
          details: `Администратор массово удалил ${ids.length} товаров`
        }
      });

      return NextResponse.json({ success: true, message: `Успешно удалено ${ids.length} товаров из каталога.` });
    }

    // --- SINGLE DELETE ---
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      return NextResponse.json({ error: 'Товар не найден.' }, { status: 404 });
    }

    // Transaction: delete order items referencing this product, then delete product
    await prisma.$transaction(async (tx) => {
      await tx.orderItem.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
    });

    await prisma.auditLog.create({
      data: {
        userId: adminSession.userId,
        action: 'DELETE_PRODUCT',
        details: `Администратор безвозвратно удалил SKU: ${product.sku} - ${product.name}`
      }
    });

    return NextResponse.json({ success: true, message: `Товар "${product.name}" удалён из каталога.` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const adminSession = await requireAdmin(req);

    const body = await req.json();

    const {
      sku,
      name,
      basePrice,
      stockPacks,
      imageUrl,
      tagIds
    } = body;

    const product = await prisma.product.create({
      data: {
        sku,
        name,
        imageUrl: imageUrl || '',
        basePrice: parseFloat(basePrice),
        stockPacks: parseInt(stockPacks || 0),
        tags: tagIds?.length
          ? {
              connect: tagIds.map((id: string) => ({ id }))
            }
          : undefined
      },
      include: {
        tags: true
      }
    });

    await prisma.auditLog.create({
      data: {
        userId: adminSession.userId,
        action: 'CREATE_PRODUCT',
        details: `Создан товар ${product.sku}`
      }
    });

    return NextResponse.json({
      success: true,
      product
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}