import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';
import { signToken, getCookieOptions, updateCachedSessionVersion } from '@/lib/auth';
import { ALL_PERMISSIONS } from '@/lib/permissions';
import { clearLoginFailures, isLoginRateLimited, recordFailedLogin } from '@/lib/login-rate-limit';

export const dynamic = 'force-dynamic';

async function recordFailureWithBackoff(email: string, ip: string): Promise<void> {
  const delayMs = await recordFailedLogin(email, ip);
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function verifyTurnstile(token: unknown, remoteIp: string, hostname: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!secret && !siteKey) return true; // Keep local/development installs usable until configured.
  if (!secret || !siteKey || typeof token !== 'string' || !token || token.length > 2048) return false;

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp !== 'unknown') body.set('remoteip', remoteIp);
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result.success === true && result.hostname === hostname && result.action === 'login';
  } catch {
    return false;
  }
}

/**
 * POST: Handles B2B login authentication.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, turnstileToken } = body;

    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password || email.length > 254 || password.length > 128) {
      return NextResponse.json({ error: 'Пожалуйста, введите логин и пароль.' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const forwardedFor = req.headers.get('x-forwarded-for')?.split(',').map((value) => value.trim()).filter(Boolean).at(-1);
    // Do not trust X-Real-IP: clients can supply it. On Vercel the platform
    // provides x-forwarded-for; use a bounded sanitized value for the bucket.
    const ip = (forwardedFor || 'unknown').slice(0, 128);
    const rateLimit = await isLoginRateLimited(normalizedEmail, ip);
    if (rateLimit.limited) {
      return NextResponse.json({ error: 'Слишком много попыток входа. Повторите позже.' }, {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) }
      });
    }

    const turnstileEnabled = Boolean(process.env.TURNSTILE_SECRET_KEY || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
    if (turnstileEnabled && !(await verifyTurnstile(turnstileToken, ip, req.nextUrl.hostname))) {
      await recordFailureWithBackoff(normalizedEmail, ip);
      return NextResponse.json({ error: 'Проверка безопасности не пройдена. Обновите проверку и попробуйте снова.' }, { status: 403 });
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
      await recordFailureWithBackoff(normalizedEmail, ip);
      return NextResponse.json({ error: 'Неверный логин или пароль.' }, { status: 401 });
    }

    if (!user.isActive) {
      await recordFailureWithBackoff(normalizedEmail, ip);
      return NextResponse.json({ error: 'Неверный логин или пароль.' }, { status: 401 });
    }

    // 2. Safely verify bcrypt hash
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      await recordFailureWithBackoff(normalizedEmail, ip);
      return NextResponse.json({ error: 'Неверный логин или пароль.' }, { status: 401 });
    }
    await clearLoginFailures(normalizedEmail, ip);

    // 3. Extract permissions and dashboard
    let permissions: string[] = user.roleTemplate?.permissions || [];
    let roleName = user.roleTemplate?.name || user.role || 'Пользователь';
    let defaultDashboard = user.roleTemplate?.defaultDashboard || '/customer';

    // Superadmin fallback
    const isSuperAdmin = Boolean(user.roleTemplate?.isSystem && user.roleTemplate.name === 'Суперадминистратор');
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
