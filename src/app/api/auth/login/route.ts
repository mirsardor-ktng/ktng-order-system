import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';
import { signToken, getCookieOptions, updateCachedSessionVersion } from '@/lib/auth';
import { ALL_PERMISSIONS } from '@/lib/permissions';
import { clearLoginFailures, isLoginRateLimited, recordFailedLogin } from '@/lib/login-rate-limit';

export const dynamic = 'force-dynamic';

/**
 * POST: Handles B2B login authentication.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password || email.length > 254 || password.length > 128) {
      return NextResponse.json({ error: 'Пожалуйста, введите логин и пароль.' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const forwardedFor = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const ip = req.headers.get('x-real-ip')?.trim() || forwardedFor || 'unknown';
    const rateLimit = await isLoginRateLimited(normalizedEmail, ip);
    if (rateLimit.limited) {
      return NextResponse.json({ error: 'Слишком много попыток входа. Повторите позже.' }, {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) }
      });
    }

    // 1. Locate user in database with roleTemplate
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        roleTemplate: true,
        company: { select: { id: true, name: true, code: true } }
      }
    });

    if (!user) {
      await recordFailedLogin(normalizedEmail, ip);
      return NextResponse.json({ error: 'Неверный логин или пароль.' }, { status: 401 });
    }

    if (!user.isActive) {
      await recordFailedLogin(normalizedEmail, ip);
      return NextResponse.json({ error: 'Неверный логин или пароль.' }, { status: 401 });
    }

    // 2. Safely verify bcrypt hash
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      await recordFailedLogin(normalizedEmail, ip);
      return NextResponse.json({ error: 'Неверный логин или пароль.' }, { status: 401 });
    }
    await clearLoginFailures(normalizedEmail, ip);

    // 3. Extract permissions and dashboard
    let permissions: string[] = user.roleTemplate?.permissions || [];
    let roleName = user.roleTemplate?.name || user.role || 'Пользователь';
    let defaultDashboard = user.roleTemplate?.defaultDashboard || '/customer';

    // Superadmin fallback
    const isSuperAdmin = user.roleTemplate
      ? user.roleTemplate.isSystem && user.roleTemplate.name === 'Суперадминистратор'
      : user.role === 'ADMIN';
    if (isSuperAdmin) {
      permissions = ALL_PERMISSIONS;
      defaultDashboard = defaultDashboard || '/admin';
    }

    // 3.5 Increment sessionVersion for single active session per account
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { sessionVersion: { increment: 1 } },
      select: { sessionVersion: true }
    });
    updateCachedSessionVersion(user.id, updatedUser.sessionVersion);

    // 4. Bake JWT session
    const token = signToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role || undefined,
      roleTemplateId: user.roleTemplateId || undefined,
      roleTemplateIsSystem: user.roleTemplate?.isSystem || false,
      roleName,
      permissions,
      defaultDashboard,
      companyId: user.companyId || undefined,
      sessionVersion: updatedUser.sessionVersion
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
