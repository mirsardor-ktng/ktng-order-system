import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req);
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
  }

  const body = await req.json();
  const { displayName, isActive } = body;

  const updateData: any = {};
  if (displayName !== undefined) updateData.displayName = displayName.trim();
  if (isActive !== undefined) updateData.isActive = isActive;

  const group = await prisma.productGroup.update({
    where: { id: params.id },
    data: updateData,
    include: {
      skus: { orderBy: { priority: 'asc' }, include: { tags: true } }
    }
  });

  return NextResponse.json(group);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession(req);
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
  }

  // Unlink SKUs from the group before deleting (set groupId = null)
  await prisma.product.updateMany({
    where: { groupId: params.id },
    data: { groupId: null }
  });

  await prisma.productGroup.delete({ where: { id: params.id } });

  return NextResponse.json({ success: true });
}
