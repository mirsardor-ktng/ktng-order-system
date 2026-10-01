import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requirePermissionAsync, SessionExpiredError } from '@/lib/auth';

/**
 * GET: Serves the system audit logs (Users with logs:view permission)
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermissionAsync(req, 'logs:view');

    const logs = await prisma.auditLog.findMany({
      include: {
        user: {
          select: { name: true, email: true, role: true }
        }
      },
      orderBy: { timestamp: 'desc' },
      take: 200 // Limit to latest 200 operations to optimize database performance
    });

    return NextResponse.json(logs);
  } catch (error: any) {
    if (error instanceof SessionExpiredError || error.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: error.message, code: 'SESSION_EXPIRED_ANOTHER_DEVICE' }, { status: 401 });
    }
    return NextResponse.json({ error: error.message }, { status: error.message?.includes('недостаточно прав') || error.message?.includes('авторизация') ? 403 : 500 });
  }
}
