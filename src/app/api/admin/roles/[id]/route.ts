import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermission } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET: Returns a specific role template
 */
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    requirePermission(req, ['roles:manage', 'users:read', 'users:manage']);
    const { id } = await context.params;

    const role = await prisma.roleTemplate.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true } }
      }
    });

    if (!role) {
      return NextResponse.json({ error: 'Шаблон роли не найден.' }, { status: 404 });
    }

    return NextResponse.json(role);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}

/**
 * PUT: Updates an existing role template
 */
export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const session = requirePermission(req, 'roles:manage');
    const { id } = await context.params;
    const body = await req.json();
    const { name, description, defaultDashboard, permissions } = body;

    const existingRole = await prisma.roleTemplate.findUnique({
      where: { id }
    });

    if (!existingRole) {
      return NextResponse.json({ error: 'Шаблон роли не найден.' }, { status: 404 });
    }

    const updateData: any = {};

    if (name && name.trim()) {
      if (name.trim() !== existingRole.name) {
        const nameConflict = await prisma.roleTemplate.findUnique({
          where: { name: name.trim() }
        });
        if (nameConflict) {
          return NextResponse.json({ error: 'Шаблон роли с таким названием уже существует.' }, { status: 400 });
        }
      }
      updateData.name = name.trim();
    }

    if (description !== undefined) {
      updateData.description = description?.trim() || null;
    }

    if (defaultDashboard) {
      updateData.defaultDashboard = defaultDashboard;
    }

    if (Array.isArray(permissions)) {
      updateData.permissions = permissions;
    }

    const updatedRole = await prisma.roleTemplate.update({
      where: { id },
      data: updateData,
      include: {
        _count: { select: { users: true } }
      }
    });

    await prisma.auditLog.create({
      data: {
        userId: session.userId,
        action: 'UPDATE_ROLE_TEMPLATE',
        details: `Обновлен шаблон роли "${updatedRole.name}"`
      }
    });

    return NextResponse.json({ success: true, role: updatedRole });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}

/**
 * DELETE: Deletes a custom role template
 */
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const session = requirePermission(req, 'roles:manage');
    const { id } = await context.params;

    const existingRole = await prisma.roleTemplate.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true } }
      }
    });

    if (!existingRole) {
      return NextResponse.json({ error: 'Шаблон роли не найден.' }, { status: 404 });
    }

    if (existingRole.isSystem) {
      return NextResponse.json({ error: 'Системные шаблоны ролей защищены от удаления.' }, { status: 400 });
    }

    if (existingRole._count.users > 0) {
      return NextResponse.json({
        error: `Невозможно удалить роль: к ней привязано ${existingRole._count.users} пользователей. Сначала переназначьте их на другой шаблон.`
      }, { status: 400 });
    }

    await prisma.roleTemplate.delete({
      where: { id }
    });

    await prisma.auditLog.create({
      data: {
        userId: session.userId,
        action: 'DELETE_ROLE_TEMPLATE',
        details: `Удален шаблон роли "${existingRole.name}"`
      }
    });

    return NextResponse.json({ success: true, message: 'Шаблон роли успешно удален.' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}
