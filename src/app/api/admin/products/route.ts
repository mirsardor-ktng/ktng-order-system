import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermission, hasPermission, getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET: Returns all products with tags (Admin SKU Manager list or Seller Monitor)
 */
export async function GET(req: NextRequest) {
  try {
    requirePermission(req, ['products:read', 'products:manage', 'products:stock_update']);
    const products = await prisma.product.findMany({
      include: { tags: true, group: { select: { id: true, displayName: true } } },
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
    if (!session || (!hasPermission(session, 'products:manage') && !hasPermission(session, 'products:stock_update'))) {
      return NextResponse.json({ error: 'У вас недостаточно прав для изменения товаров.' }, { status: 403 });
    }

    const isFullManager = hasPermission(session, 'products:manage');
    const isStockOnly = !isFullManager && hasPermission(session, 'products:stock_update');

    const body = await req.json();
    const { id, ids, basePrice, isFavorite, isActive, name, sku, stockPacks, tagIds } = body;

    // If stock only, ensure only stockPacks is modified
    if (isStockOnly) {
      if (basePrice !== undefined || isFavorite !== undefined || isActive !== undefined || name !== undefined || sku !== undefined || (tagIds !== undefined && tagIds.length > 0)) {
        return NextResponse.json({ error: 'У вашей роли есть права только на изменение складских остатков.' }, { status: 403 });
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
        if (basePrice !== undefined && isFullManager) updateData.basePrice = parseFloat(basePrice);
        if (isFavorite !== undefined && isFullManager) updateData.isFavorite = !!isFavorite;
        if (isActive !== undefined && isFullManager) updateData.isActive = !!isActive;
        if (stockPacks !== undefined) updateData.stockPacks = parseInt(stockPacks);

        if (Object.keys(updateData).length > 0) {
          await tx.product.updateMany({
            where: { id: { in: ids } },
            data: updateData
          });
        }

        // Relational tag updates need to be done individually per product
        if (tagIds !== undefined && Array.isArray(tagIds) && isFullManager) {
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
          details: `Пользователь ${session.email} массово обновил ${ids.length} товаров`
        }
      });

      return NextResponse.json({ success: true, count: ids.length });
    }

    // --- SINGLE UPDATE ---
    const updateData: any = {};
    if (basePrice !== undefined && isFullManager) updateData.basePrice = parseFloat(basePrice);
    if (isFavorite !== undefined && isFullManager) updateData.isFavorite = !!isFavorite;
    if (isActive !== undefined && isFullManager) updateData.isActive = !!isActive;
    if (name && isFullManager) updateData.name = name;
    if (sku && isFullManager) updateData.sku = sku;
    if (stockPacks !== undefined) updateData.stockPacks = parseInt(stockPacks);

    // Handle tag re-assignment
    if (tagIds !== undefined && Array.isArray(tagIds) && isFullManager) {
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
        details: `Пользователь ${session.email} обновил SKU ${product.sku}`
      }
    });

    return NextResponse.json({ success: true, product });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}

/**
 * DELETE: Permanently removes a product
 */
export async function DELETE(req: NextRequest) {
  try {
    const adminSession = requirePermission(req, 'products:manage');
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
          details: `Удалено ${ids.length} товаров из каталога`
        }
      });

      return NextResponse.json({ success: true, message: `Успешно удалено ${ids.length} товаров из каталога.` });
    }

    // --- SINGLE DELETE ---
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      return NextResponse.json({ error: 'Товар не найден.' }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.orderItem.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
    });

    await prisma.auditLog.create({
      data: {
        userId: adminSession.userId,
        action: 'DELETE_PRODUCT',
        details: `Удален товар SKU: ${product.sku} - ${product.name}`
      }
    });

    return NextResponse.json({ success: true, message: `Товар "${product.name}" удалён из каталога.` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const adminSession = requirePermission(req, 'products:manage');
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