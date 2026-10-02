import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermissionAsync, SessionExpiredError } from '@/lib/auth';
import { ProductGroupService } from '@/lib/product-groups/product-groups.service';
import { invalidateOrderCalculationConfig } from '@/lib/calculation/config-cache';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requirePermissionAsync(req, 'product_groups:manage');
  } catch (err: any) {
    if (err instanceof SessionExpiredError || err.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: err.message, code: 'SESSION_EXPIRED_ANOTHER_DEVICE' }, { status: 401 });
    }
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

  invalidateOrderCalculationConfig();
  ProductGroupService.invalidateCatalogCache();

  return NextResponse.json(group);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requirePermissionAsync(req, 'product_groups:manage');
  } catch (err: any) {
    if (err instanceof SessionExpiredError || err.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: err.message, code: 'SESSION_EXPIRED_ANOTHER_DEVICE' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
  }

  // Unlink SKUs from the group before deleting (set groupId = null)
  await prisma.product.updateMany({
    where: { groupId: params.id },
    data: { groupId: null }
  });

  await prisma.productGroup.delete({ where: { id: params.id } });

  invalidateOrderCalculationConfig();
  ProductGroupService.invalidateCatalogCache();

  return NextResponse.json({ success: true });
}
