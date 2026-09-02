import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';
import { getSession } from '@/lib/auth';
import { AuditService } from '@/lib/audit/audit.service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const session = getSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Необходима авторизация.' }, { status: 401 });
    }

    const body = await req.json();
    const { oldPassword, newPassword } = body;

    if (!oldPassword || !newPassword) {
      return NextResponse.json({ error: 'Заполните старый и новый пароли.' }, { status: 400 });
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: 'Новый пароль должен содержать не менее 6 символов.' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId }
    });

    if (!user) {
      return NextResponse.json({ error: 'Пользователь не найден.' }, { status: 404 });
    }

    // Verify old password
    const isMatch = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isMatch) {
      return NextResponse.json({ error: 'Неверный текущий пароль.' }, { status: 400 });
    }

    // Hash new password
    const newHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash }
    });

    // Log action in AuditLog
    await AuditService.log({
      userId: user.id,
      action: 'CHANGE_PASSWORD',
      details: `Пользователь ${user.email} изменил свой пароль`,
      req
    });

    return NextResponse.json({ success: true, message: 'Пароль успешно изменён.' });
  } catch (error: any) {
    console.error('[Change Password Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
