import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getSession, hasPermission } from '@/lib/auth';
import { AuditService } from '@/lib/audit/audit.service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const session = getSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Необходима авторизация.' }, { status: 401 });
    }

    const body = await req.json();
    const { orderId, text } = body;

    if (!orderId || !text || text.trim() === '') {
      return NextResponse.json({ error: 'Идентификатор заказа и текст комментария обязательны.' }, { status: 400 });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        customerId: true,
        companyId: true,
        orderNumber: true
      }
    });

    if (!order) {
      return NextResponse.json({ error: 'Заказ не найден.' }, { status: 404 });
    }

    const hasCommentsPerm = hasPermission(session, 'orders:comments');
    const isOwner = order.customerId === session.userId;
    const isSameCompany = Boolean(session.companyId && order.companyId && order.companyId === session.companyId);

    if (!hasCommentsPerm && !isOwner && !isSameCompany) {
      return NextResponse.json({ error: 'Доступ ограничен. Недостаточно прав.' }, { status: 403 });
    }

    const comment = await prisma.comment.create({
      data: {
        orderId,
        userId: session.userId,
        userName: session.name,
        text: text.trim()
      }
    });

    // Log the comment action
    await AuditService.log({
      userId: session.userId,
      action: 'ADD_ORDER_COMMENT',
      details: `Пользователь ${session.name} оставил комментарий к заказу ${order.orderNumber}`,
      req
    });

    return NextResponse.json({ success: true, comment });
  } catch (error: any) {
    console.error('[Add Comment Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
