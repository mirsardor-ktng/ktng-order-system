import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';
import { signToken, getCookieOptions } from '@/lib/auth';
import { ALL_PERMISSIONS } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * POST: Handles B2B login authentication.
 */
export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Пожалуйста, введите логин и пароль.' }, { status: 400 });
    }

    // 1. Locate user in database with roleTemplate
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        roleTemplate: true,
        company: { select: { id: true, name: true, code: true } }
      }
    });

    if (!user) {
      return NextResponse.json({ error: 'Неверный логин или пароль.' }, { status: 401 });
    }

    if (!user.isActive) {
      return NextResponse.json({ error: 'Ваша учетная запись деактивирована администратором.' }, { status: 403 });
    }

    // 2. Safely verify bcrypt hash
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return NextResponse.json({ error: 'Неверный логин или пароль.' }, { status: 401 });
    }

    // 3. Extract permissions and dashboard
    let permissions: string[] = user.roleTemplate?.permissions || [];
    let roleName = user.roleTemplate?.name || user.role || 'Пользователь';
    let defaultDashboard = user.roleTemplate?.defaultDashboard || '/customer';

    // Superadmin fallback
    if (user.role === 'ADMIN' || roleName === 'Суперадминистратор') {
      permissions = ALL_PERMISSIONS;
      defaultDashboard = defaultDashboard || '/admin';
    }

    // 4. Bake JWT session
    const token = signToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role || undefined,
      roleTemplateId: user.roleTemplateId || undefined,
      roleName,
      permissions,
      defaultDashboard,
      companyId: user.companyId || undefined
    });

    // 5. Log successful login to Audit Logs
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'USER_LOGIN',
        details: `Пользователь ${user.email} вошел в систему (Роль: "${roleName}")`
      }
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        roleTemplateId: user.roleTemplateId,
        roleName,
        permissions,
        defaultDashboard,
        companyId: user.companyId,
        company: user.company
      }
    });

    const cookieOptions = getCookieOptions(1); // Standard session expires in 8 hours
    response.cookies.set(cookieOptions.name, token, cookieOptions);

    return response;
  } catch (error: any) {
    console.error('[Login Error]', error);
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }
}
