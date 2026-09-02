import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { OrdersService } from '@/lib/orders/orders.service';

export const dynamic = 'force-dynamic';

async function requireAuthorizedStaff(req: NextRequest) {
  const session = getSession(req);
  if (!session || (session.role !== 'ADMIN' && session.role !== 'SELLER' && session.role !== 'MANAGER')) {
    throw new Error('Access denied');
  }
  return session;
}

export async function PUT(req: NextRequest) {
  try {
    const session = await requireAuthorizedStaff(req);
    const body = await req.json();
    const { orderId, status } = body;

    if (!orderId || !status) {
      return NextResponse.json({ error: 'Не указан ID заказа или статус.' }, { status: 400 });
    }

    const result = await OrdersService.updateOrderStatus(session as any, { orderId, status }, req);

    return NextResponse.json({
      success: true,
      order: result.order,
      message: result.message
    });
  } catch (error: any) {
    console.error('[Change Order Status Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
