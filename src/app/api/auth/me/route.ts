import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import prisma from '@/lib/db';
import { ALL_PERMISSIONS } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * GET: Retrieves active user session with fresh permissions from DB
 */
export async function GET(req: NextRequest) {
  try {
    const session = getSession(req);
    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    // Attempt to load fresh user and roleTemplate data from DB
    const dbUser = await prisma.user.findUnique({
      where: { id: session.userId },
      include: {
        roleTemplate: true,
        company: { select: { id: true, name: true, code: true, purchasePlanCases: true, monthlyTargetCases: true } }
      }
    });

    if (!dbUser || !dbUser.isActive) {
      return NextResponse.json({ authenticated: false, error: 'Пользователь не найден или деактивирован' }, { status: 401 });
    }

    let permissions = dbUser.roleTemplate?.permissions || session.permissions || [];
    let roleName = dbUser.roleTemplate?.name || session.roleName || dbUser.role || 'Пользователь';
    let defaultDashboard = dbUser.roleTemplate?.defaultDashboard || session.defaultDashboard || '/customer';

    if (dbUser.role === 'ADMIN' || roleName === 'Суперадминистратор') {
      permissions = ALL_PERMISSIONS;
      defaultDashboard = defaultDashboard || '/admin';
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        userId: dbUser.id,
        id: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        role: dbUser.role,
        roleTemplateId: dbUser.roleTemplateId,
        roleName,
        permissions,
        defaultDashboard,
        companyId: dbUser.companyId,
        company: dbUser.company
      }
    });
  } catch (error) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
}
