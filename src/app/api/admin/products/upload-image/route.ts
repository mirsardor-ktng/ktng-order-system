import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermissionAsync } from '@/lib/auth';
import { uploadProductImage, deleteProductImage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * POST: Upload or replace a cover image for a product.
 * Runs completely in memory, converts to WebP via Sharp, and stores in Supabase Storage.
 * Accepts multipart/form-data with fields: productId, file
 */
export async function POST(req: NextRequest) {
  let adminSession;
  try {
    adminSession = await requirePermissionAsync(req, 'products:manage');
  } catch (error: any) {
    const status = error.message === 'Необходима авторизация.' ? 401 : 403;
    return NextResponse.json({ error: error.message }, { status });
  }

  try {
    const formData = await req.formData();
    const productId = formData.get('productId') as string;
    const file = formData.get('file') as File | null;

    if (!productId || !file) {
      return NextResponse.json({ error: 'productId и файл обязательны.' }, { status: 400 });
    }

    // Verify product exists
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return NextResponse.json({ error: 'Товар не найден.' }, { status: 404 });
    }

    // Read file to in-memory Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload & optimize using Supabase Storage
    const { imageUrl } = await uploadProductImage(productId, buffer);

    // Update product in DB
    const oldImageUrl = product.imageUrl;
    await prisma.product.update({
      where: { id: productId },
      data: { imageUrl }
    });

    // Remove old image from Supabase Storage if different
    if (oldImageUrl && oldImageUrl !== imageUrl) {
      await deleteProductImage(oldImageUrl);
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: adminSession.userId,
        action: 'UPDATE_PRODUCT_IMAGE',
        details: `Обновлено изображение товара SKU: ${product.sku}`
      }
    });

    return NextResponse.json({ success: true, imageUrl });
  } catch (err: any) {
    console.error('[Image Upload Error]', err);
    const msg = err?.message || 'Ошибка сервера при загрузке изображения.';
    const status = msg.includes('Поддерживаются только') || msg.includes('не должен превышать') || msg.includes('обязательны')
      ? 400
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/**
 * DELETE: Remove image for a product.
 * query param: ?productId=...
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
    const productId = searchParams.get('productId');

    if (!productId) {
      return NextResponse.json({ error: 'productId обязателен.' }, { status: 400 });
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return NextResponse.json({ error: 'Товар не найден.' }, { status: 404 });
    }

    if (product.imageUrl) {
      await deleteProductImage(product.imageUrl);
      await prisma.product.update({
        where: { id: productId },
        data: { imageUrl: '' }
      });

      await prisma.auditLog.create({
        data: {
          userId: adminSession.userId,
          action: 'DELETE_PRODUCT_IMAGE',
          details: `Удалено изображение товара SKU: ${product.sku}`
        }
      });
    }

    return NextResponse.json({ success: true, message: 'Изображение товара удалено.' });
  } catch (err: any) {
    console.error('[Image Delete Error]', err);
    return NextResponse.json({ error: err?.message || 'Ошибка при удалении изображения.' }, { status: 500 });
  }
}
