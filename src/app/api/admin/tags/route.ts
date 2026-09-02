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

/** GET: List all tags with product count */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const tags = await prisma.tag.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' }
    });
    return NextResponse.json(tags);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
}

/** POST: Create a new tag */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** DELETE: Remove a tag (unlinks from all products) */
export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'ID тега не указан.' }, { status: 400 });
    }
    await prisma.tag.delete({ where: { id } });
    return NextResponse.json({ success: true, message: 'Тег удалён.' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
