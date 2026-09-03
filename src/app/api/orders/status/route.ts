import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { OrdersService } from '@/lib/orders/orders.service';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest) {
  try {
    const session = requirePermission(req, 'orders:status_change');
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
