import { NextRequest, NextResponse } from 'next/server';
import { getCookieOptions, getSession } from '@/lib/auth';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

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
  
  // Instruct browser to delete cookie immediately across all paths
  response.cookies.set(cookieOptions.name, '', {
    ...cookieOptions,
    maxAge: 0,
    expires: new Date(0)
  });

  return response;
}
