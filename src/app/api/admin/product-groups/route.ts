import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermissionAsync, SessionExpiredError } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    await requirePermissionAsync(req, ['product_groups:manage', 'products:read', 'products:manage']);
  } catch (err: any) {
    if (err instanceof SessionExpiredError || err.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: err.message, code: 'SESSION_EXPIRED_ANOTHER_DEVICE' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
  }

  const groups = await prisma.productGroup.findMany({
    include: {
      skus: {
        orderBy: { priority: 'asc' },
        include: { tags: true }
      }
    },
    orderBy: { displayName: 'asc' }
  });

  // Aggregate totalStock
  const result = groups.map(g => ({
    ...g,
    totalStock: g.skus.filter(s => s.isActive).reduce((sum, s) => sum + s.stockPacks, 0)
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  try {
    await requirePermissionAsync(req, 'product_groups:manage');
  } catch (err: any) {
    if (err instanceof SessionExpiredError || err.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: err.message, code: 'SESSION_EXPIRED_ANOTHER_DEVICE' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
  }

  const body = await req.json();
  const { displayName, isActive = true } = body;

  if (!displayName || typeof displayName !== 'string') {
    return NextResponse.json({ error: 'displayName обязателен' }, { status: 400 });
  }

  const group = await prisma.productGroup.create({
    data: { displayName: displayName.trim(), isActive },
    include: { skus: true }
  });

  return NextResponse.json(group, { status: 201 });
}
