import { NextRequest, NextResponse } from 'next/server';
import { requirePermissionAsync, SessionExpiredError } from '@/lib/auth';
import { OrdersService } from '@/lib/orders/orders.service';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requirePermissionAsync(req, 'orders:delete');
    const orderId = params.id;

    if (!orderId) {
      return NextResponse.json({ error: 'ID заказа не указан.' }, { status: 400 });
    }

    let reason: string | undefined;
    try {
      const body = await req.json();
      if (body && typeof body.reason === 'string') {
        reason = body.reason;
      }
    } catch {
      // Body is optional on DELETE requests
    }

    const result = await OrdersService.deleteOrder(session, orderId, { reason }, req);
    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof SessionExpiredError || error.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: error.message, code: 'SESSION_EXPIRED_ANOTHER_DEVICE' }, { status: 401 });
    }

    const status = error.status || (
      error.message?.includes('нет прав') || error.message?.includes('Доступ запрещен')
        ? 403
        : error.message?.includes('не найден')
        ? 404
        : error.message?.includes('Нельзя удалить') || error.message?.includes('запрещено')
        ? 409
        : 500
    );

    return NextResponse.json({ error: error.message || 'Ошибка удаления заказа.' }, { status });
  }
}
