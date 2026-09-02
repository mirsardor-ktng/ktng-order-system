import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
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

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * POST: Upload a cover image for a product.
 * Accepts multipart/form-data with fields: productId, file
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const formData = await req.formData();
    const productId = formData.get('productId') as string;
    const file = formData.get('file') as File | null;

    if (!productId || !file) {
      return NextResponse.json({ error: 'productId и файл обязательны.' }, { status: 400 });
    }

    const ext = ALLOWED_TYPES[file.type];
    if (!ext) {
      return NextResponse.json({ error: 'Допустимые форматы: JPG, PNG, WebP.' }, { status: 400 });
    }

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: 'Файл слишком большой. Максимум 5 МБ.' }, { status: 400 });
    }

    // Verify product exists
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return NextResponse.json({ error: 'Товар не найден.' }, { status: 404 });
    }

    // Ensure target directory exists
    const uploadDir = path.join(process.cwd(), 'public', 'product-images');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Remove old image files for this product (any extension)
    for (const oldExt of Object.values(ALLOWED_TYPES)) {
      const oldPath = path.join(uploadDir, `${productId}.${oldExt}`);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    // Save new file
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileName = `${productId}.${ext}`;
    const filePath = path.join(uploadDir, fileName);
    fs.writeFileSync(filePath, buffer);

    const imageUrl = `/product-images/${fileName}`;

    // Update product imageUrl in DB
    await prisma.product.update({
      where: { id: productId },
      data: { imageUrl }
    });

    return NextResponse.json({ success: true, imageUrl });
  } catch (err: any) {
    console.error('[Image Upload Error]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
