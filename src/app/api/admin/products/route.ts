import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermission, requirePermissionAsync, hasPermission, getSession, getEffectivePermissions } from '@/lib/auth';
import { uploadProductImage, deleteProductImage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * GET: Returns all products with tags (Admin SKU Manager list or Seller Monitor)
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermissionAsync(req, ['products:read', 'products:manage', 'products:stock_update']);
  } catch (error: any) {
    const status = error.message === 'Необходима авторизация.' ? 401 : 403;
    return NextResponse.json({ error: error.message }, { status });
  }

  try {
    const products = await prisma.product.findMany({
      include: { tags: true, group: { select: { id: true, displayName: true } } },
      orderBy: { name: 'asc' }
    });
    return NextResponse.json(products);
  } catch (error: any) {
    console.error('Error fetching products:', error);
    const msg = error?.message || '';
    const safeError = msg.includes('prisma') || msg.includes('PrismaClient')
      ? 'Ошибка базы данных при получении товаров.'
      : (msg || 'Внутренняя ошибка сервера при получении товаров.');
    return NextResponse.json({ error: safeError }, { status: 500 });
  }
}

/**
 * PUT: Updates product base parameters (pricing, favorite, active status, tags)
 * Supports both single product updates (by body.id) and bulk updates (by body.ids).
 */
export async function PUT(req: NextRequest) {
  try {
    let session = getSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Необходима авторизация.' }, { status: 401 });
    }

    let isFullManager = hasPermission(session, 'products:manage');
    let isStockOnly = !isFullManager && hasPermission(session, 'products:stock_update');

    // Live DB permissions fallback in case JWT cookie has not yet been refreshed
    if (!isFullManager && !isStockOnly) {
      const effective = await getEffectivePermissions(session.userId);
      session = { ...session, permissions: effective.permissions, roleName: effective.roleName, role: effective.role || session.role };
      isFullManager = hasPermission(session, 'products:manage');
      isStockOnly = !isFullManager && hasPermission(session, 'products:stock_update');
    }

    if (!isFullManager && !isStockOnly) {
      return NextResponse.json({ error: 'У вас недостаточно прав для изменения товаров.' }, { status: 403 });
    }

    const body = await req.json();
    const { id, ids, basePrice, isFavorite, isActive, name, sku, stockPacks, tagIds, imageUrl } = body;

    // If stock only, ensure only stockPacks is modified
    if (isStockOnly) {
      if (basePrice !== undefined || isFavorite !== undefined || isActive !== undefined || name !== undefined || sku !== undefined || imageUrl !== undefined || (tagIds !== undefined && tagIds.length > 0)) {
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

    if (imageUrl !== undefined && isFullManager) {
      const existing = await prisma.product.findUnique({ where: { id }, select: { imageUrl: true } });
      if (existing?.imageUrl && existing.imageUrl !== imageUrl) {
        await deleteProductImage(existing.imageUrl);
      }
      updateData.imageUrl = imageUrl;
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
    console.error('Error updating product(s):', error);
    const msg = error?.message || '';
    const safeError = msg.includes('prisma') || msg.includes('PrismaClient')
      ? 'Ошибка базы данных при обновлении товаров.'
      : (msg || 'Внутренняя ошибка сервера при обновлении товаров.');
    return NextResponse.json({ error: safeError }, { status: 500 });
  }
}

/**
 * DELETE: Permanently removes a product
 */
export async function DELETE(req: NextRequest) {
  let adminSession;
  try {
    adminSession = await requirePermissionAsync(req, 'products:manage');
  } catch (error: any) {
    const status = error.message === 'Необходима авторизация.' ? 401 : 403;
    return NextResponse.json({ error: error.message }, { status });
  }

  try {
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

      // Fetch images before deletion
      const productsToDelete = await prisma.product.findMany({
        where: { id: { in: ids } },
        select: { id: true, imageUrl: true }
      });

      await prisma.$transaction(async (tx) => {
        await tx.orderItem.deleteMany({ where: { productId: { in: ids } } });
        await tx.product.deleteMany({ where: { id: { in: ids } } });
      });

      // Cleanup associated images from Supabase Storage
      for (const p of productsToDelete) {
        if (p.imageUrl) {
          await deleteProductImage(p.imageUrl);
        }
      }

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

    // Cleanup associated image from Supabase Storage
    if (product.imageUrl) {
      await deleteProductImage(product.imageUrl);
    }

    await prisma.auditLog.create({
      data: {
        userId: adminSession.userId,
        action: 'DELETE_PRODUCT',
        details: `Удален товар SKU: ${product.sku} - ${product.name}`
      }
    });

    return NextResponse.json({ success: true, message: `Товар "${product.name}" удалён из каталога.` });
  } catch (error: any) {
    console.error('Error deleting product(s):', error);
    const msg = error?.message || '';
    const safeError = msg.includes('prisma') || msg.includes('PrismaClient')
      ? 'Ошибка базы данных при удалении товаров.'
      : (msg || 'Внутренняя ошибка сервера при удалении товаров.');
    return NextResponse.json({ error: safeError }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let adminSession;
  try {
    adminSession = await requirePermissionAsync(req, 'products:manage');
  } catch (error: any) {
    const status = error.message === 'Необходима авторизация.' ? 401 : 403;
    return NextResponse.json({ error: error.message }, { status });
  }

  const contentType = req.headers.get('content-type') || '';

  try {
    let sku = '';
    let name = '';
    let basePrice: any = 0;
    let stockPacks: any = 0;
    let isFavorite = false;
    let isActive = true;
    let tagIds: string[] = [];
    let initialImageUrl = '';
    let imageFile: File | null = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      sku = (formData.get('sku') as string) || '';
      name = (formData.get('name') as string) || '';
      basePrice = formData.get('basePrice');
      stockPacks = formData.get('stockPacks');
      isFavorite = formData.get('isFavorite') === 'true';
      isActive = formData.get('isActive') !== 'false';
      const rawTags = formData.get('tagIds');
      if (typeof rawTags === 'string') {
        try {
          tagIds = JSON.parse(rawTags);
        } catch {
          tagIds = rawTags.split(',').filter(Boolean);
        }
      }
      imageFile = (formData.get('file') as File) || (formData.get('image') as File) || null;
      initialImageUrl = (formData.get('imageUrl') as string) || '';
    } else {
      const body = await req.json();
      sku = body.sku || '';
      name = body.name || '';
      basePrice = body.basePrice;
      stockPacks = body.stockPacks;
      isFavorite = !!body.isFavorite;
      isActive = body.isActive !== undefined ? !!body.isActive : true;
      tagIds = body.tagIds || [];
      initialImageUrl = body.imageUrl || '';
    }

    if (!sku.trim() || !name.trim()) {
      return NextResponse.json({ error: 'Артикул (SKU) и наименование обязательны.' }, { status: 400 });
    }

    // Step 1: Create product in DB
    const product = await prisma.product.create({
      data: {
        sku: sku.trim(),
        name: name.trim(),
        imageUrl: initialImageUrl,
        basePrice: parseFloat(basePrice || 0),
        stockPacks: parseInt(stockPacks || 0),
        isFavorite,
        isActive,
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

    // Step 2: Handle optional image file upload
    if (imageFile && imageFile.size > 0) {
      try {
        const arrayBuffer = await imageFile.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const { imageUrl } = await uploadProductImage(product.id, buffer);

        const updatedProduct = await prisma.product.update({
          where: { id: product.id },
          data: { imageUrl },
          include: { tags: true }
        });

        await prisma.auditLog.create({
          data: {
            userId: adminSession.userId,
            action: 'CREATE_PRODUCT',
            details: `Создан товар ${product.sku} с изображением`
          }
        });

        return NextResponse.json({
          success: true,
          product: updatedProduct
        });
      } catch (uploadErr: any) {
        console.error('[Product Create Image Upload Error]', uploadErr);
        // Roll back created product if image upload fails
        await prisma.product.delete({ where: { id: product.id } });
        const errorMsg = uploadErr?.message || 'Ошибка загрузки изображения товара.';
        return NextResponse.json({ error: errorMsg }, { status: 400 });
      }
    }

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
    console.error('Error creating product:', error);
    const msg = error?.message || '';
    const safeError = msg.includes('prisma') || msg.includes('PrismaClient')
      ? 'Ошибка базы данных при создании товара.'
      : (msg || 'Внутренняя ошибка сервера при создании товара.');
    return NextResponse.json(
      { error: safeError },
      { status: 500 }
    );
  }
}