import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getSession } from '@/lib/auth';

/**
 * GET: Serves the system audit logs (Admin only)
 */
export async function GET(req: NextRequest) {
  try {
    const session = getSession(req);
    if (!session || session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Доступ запрещен.' }, { status: 403 });
    }

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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
