import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getSession } from '@/lib/auth';

/**
 * POST /api/admin/product-groups/[id]/skus
 * Body: { productId: string; priority?: number }
 * Assigns a product (SKU) to this group.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req);
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
  }

  const body = await req.json();
  const { productId, priority = 0 } = body;

  if (!productId) {
    return NextResponse.json({ error: 'productId обязателен' }, { status: 400 });
  }

  // Ensure group exists
  const group = await prisma.productGroup.findUnique({ where: { id: params.id } });
  if (!group) return NextResponse.json({ error: 'Группа не найдена' }, { status: 404 });

  const updated = await prisma.product.update({
    where: { id: productId },
    data: { groupId: params.id, priority: parseInt(String(priority)) || 0 },
    include: { tags: true, group: { select: { id: true, displayName: true } } }
  });

  return NextResponse.json(updated);
}

/**
 * PUT /api/admin/product-groups/[id]/skus
 * Body: { productId: string; priority: number }
 * Updates priority of a SKU within this group.
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req);
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
  }

  const body = await req.json();
  const { productId, priority } = body;

  if (!productId || priority === undefined) {
    return NextResponse.json({ error: 'productId и priority обязательны' }, { status: 400 });
  }

  const updated = await prisma.product.update({
    where: { id: productId },
    data: { priority: parseInt(String(priority)) },
    include: { tags: true }
  });

  return NextResponse.json(updated);
}

/**
 * DELETE /api/admin/product-groups/[id]/skus
 * Body: { productId: string }
 * Removes a SKU from this group (sets groupId = null).
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req);
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
  }

  const body = await req.json();
  const { productId } = body;

  if (!productId) {
    return NextResponse.json({ error: 'productId обязателен' }, { status: 400 });
  }

  const updated = await prisma.product.update({
    where: { id: productId },
    data: { groupId: null, priority: 0 }
  });

  return NextResponse.json({ success: true, product: updated });
}
