import { NextRequest, NextResponse } from 'next/server';
import { getCookieOptions, getSession } from '@/lib/auth';
import prisma from '@/lib/db';

/**
 * POST: Logs out user by wiping cookie and logging to AuditLog.
 */
export async function POST(req: NextRequest) {
  try {
    const session = getSession(req);
    if (session) {
      await prisma.auditLog.create({
        data: {
          userId: session.userId,
          action: 'USER_LOGOUT',
          details: `Пользователь ${session.email} вышел из системы`
        }
      });
    }
  } catch (err) {
    console.error('[Logout Log Error]', err);
  }

  const response = NextResponse.json({ success: true, message: 'Сессия закрыта' });
  const cookieOptions = getCookieOptions(0);
  
  // Set maxAge to 0 to instruct browser to purge cookie immediately
  response.cookies.set(cookieOptions.name, '', {
    ...cookieOptions,
    maxAge: 0
  });

  return response;
}
