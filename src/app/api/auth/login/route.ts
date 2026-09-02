import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';
import { signToken, getCookieOptions } from '@/lib/auth';

/**
 * POST: Handles B2B login authentication.
 */
export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Пожалуйста, введите логин и пароль.' }, { status: 400 });
    }

    // 1. Locate user in database
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!user) {
      return NextResponse.json({ error: 'Неверный логин или пароль.' }, { status: 401 });
    }

    // 2. Safely verify bcrypt hash
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return NextResponse.json({ error: 'Неверный логин или пароль.' }, { status: 401 });
    }

    // 3. Bake JWT session
    const token = signToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role as any,
      companyId: user.companyId || undefined
    });

    // 4. Log successful login to Audit Logs
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'USER_LOGIN',
        details: `Пользователь ${user.email} вошел в систему под ролью ${user.role}`
      }
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
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
