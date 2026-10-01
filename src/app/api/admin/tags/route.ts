import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermissionAsync, SessionExpiredError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** GET: List all tags with product count */
export async function GET(req: NextRequest) {
  try {
    await requirePermissionAsync(req, ['tags:manage', 'products:read', 'products:manage']);
    const tags = await prisma.tag.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' }
    });
    return NextResponse.json(tags);
  } catch (err: any) {
    if (err instanceof SessionExpiredError || err.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: err.message, code: 'SESSION_EXPIRED_ANOTHER_DEVICE' }, { status: 401 });
    }
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
}

/** POST: Create a new tag */
export async function POST(req: NextRequest) {
  try {
    await requirePermissionAsync(req, 'tags:manage');
    const { name, color } = await req.json();
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Название тега обязательно.' }, { status: 400 });
    }
    const existing = await prisma.tag.findUnique({ where: { name: name.trim() } });
    if (existing) {
      return NextResponse.json({ error: 'Тег с таким именем уже существует.' }, { status: 400 });
    }
    const tag = await prisma.tag.create({
      data: { name: name.trim(), color: color || '#6366f1' }
    });
    return NextResponse.json({ success: true, tag });
  } catch (err: any) {
    if (err instanceof SessionExpiredError || err.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: err.message, code: 'SESSION_EXPIRED_ANOTHER_DEVICE' }, { status: 401 });
    }
    return NextResponse.json({ error: err.message }, { status: err.message?.includes('недостаточно прав') ? 403 : 500 });
  }
}

/** DELETE: Remove a tag (unlinks from all products) */
export async function DELETE(req: NextRequest) {
  try {
    await requirePermissionAsync(req, 'tags:manage');
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'ID тега не указан.' }, { status: 400 });
    }
    await prisma.tag.delete({ where: { id } });
    return NextResponse.json({ success: true, message: 'Тег удалён.' });
  } catch (err: any) {
    if (err instanceof SessionExpiredError || err.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: err.message, code: 'SESSION_EXPIRED_ANOTHER_DEVICE' }, { status: 401 });
    }
    return NextResponse.json({ error: err.message }, { status: err.message?.includes('недостаточно прав') ? 403 : 500 });
  }
}
