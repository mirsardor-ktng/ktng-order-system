import { NextRequest, NextResponse } from 'next/server';
import { getSession, signToken, getCookieOptions } from '@/lib/auth';
import prisma from '@/lib/db';
import { ALL_PERMISSIONS } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * GET: Retrieves active user session with fresh permissions from DB
 * and continuously refreshes the JWT session cookie with live DB permissions.
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

    // Check single active session per account
    if (session.sessionVersion !== undefined && dbUser.sessionVersion !== session.sessionVersion) {
      const cookieOptions = getCookieOptions(0);
      const response = NextResponse.json({
        authenticated: false,
        code: 'SESSION_EXPIRED_ANOTHER_DEVICE',
        error: 'Ваша сессия завершена, так как в этот аккаунт был выполнен вход с другого устройства.'
      }, { status: 401 });
      response.cookies.set(cookieOptions.name, '', {
        ...cookieOptions,
        maxAge: 0,
        expires: new Date(0)
      });
      return response;
    }

    let permissions = dbUser.roleTemplate?.permissions || session.permissions || [];
    let roleName = dbUser.roleTemplate?.name || session.roleName || dbUser.role || 'Пользователь';
    let defaultDashboard = dbUser.roleTemplate?.defaultDashboard || session.defaultDashboard || '/customer';

    const isSuperAdmin = dbUser.roleTemplate ? dbUser.roleTemplate.name === 'Суперадминистратор' : dbUser.role === 'ADMIN';
    if (isSuperAdmin) {
      permissions = ALL_PERMISSIONS;
      defaultDashboard = defaultDashboard || '/admin';
    }

    // Refresh JWT session with updated DB permissions and sessionVersion
    const refreshedToken = signToken({
      userId: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role || undefined,
      roleTemplateId: dbUser.roleTemplateId || undefined,
      roleName,
      permissions,
      defaultDashboard,
      companyId: dbUser.companyId || undefined,
      sessionVersion: dbUser.sessionVersion
    });

    const response = NextResponse.json({
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

    const cookieOptions = getCookieOptions(1);
    response.cookies.set(cookieOptions.name, refreshedToken, cookieOptions);
    return response;
  } catch (error) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
}
