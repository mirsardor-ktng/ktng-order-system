import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermission } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET: Returns all role templates with user count
 */
export async function GET(req: NextRequest) {
  try {
    requirePermission(req, ['roles:manage', 'users:read', 'users:manage']);

    const roles = await prisma.roleTemplate.findMany({
      include: {
        _count: {
          select: { users: true }
        }
      },
      orderBy: [
        { isSystem: 'desc' },
        { createdAt: 'asc' }
      ]
    });

    return NextResponse.json(roles);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}

/**
 * POST: Creates a new custom role template
 */
export async function POST(req: NextRequest) {
  try {
    const session = requirePermission(req, 'roles:manage');
    const body = await req.json();
    const { name, description, defaultDashboard, permissions } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Название шаблона роли обязательно.' }, { status: 400 });
    }

    if (!Array.isArray(permissions)) {
      return NextResponse.json({ error: 'Список прав (permissions) должен быть массивом.' }, { status: 400 });
    }

    const existing = await prisma.roleTemplate.findUnique({
      where: { name: name.trim() }
    });

    if (existing) {
      return NextResponse.json({ error: 'Шаблон роли с таким названием уже существует.' }, { status: 400 });
    }

    const newRole = await prisma.roleTemplate.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        defaultDashboard: defaultDashboard || '/admin',
        permissions: permissions,
        isSystem: false
      },
      include: {
        _count: { select: { users: true } }
      }
    });

    await prisma.auditLog.create({
      data: {
        userId: session.userId,
        action: 'CREATE_ROLE_TEMPLATE',
        details: `Создан шаблон роли "${newRole.name}" с ${permissions.length} правами`
      }
    });

    return NextResponse.json({ success: true, role: newRole });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}
