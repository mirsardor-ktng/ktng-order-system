import { NextRequest, NextResponse } from 'next/server';
import { requirePermissionAsync, SessionExpiredError } from '@/lib/auth';
import { OrdersService } from '@/lib/orders/orders.service';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requirePermissionAsync(req, 'orders:validation:accept');
    const orderId = params.id;

    if (!orderId) {
      return NextResponse.json({ error: 'ID заказа не указан.' }, { status: 400 });
    }

    const result = await OrdersService.acceptOrder(session, orderId, req);

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof SessionExpiredError || error.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: error.message, code: 'SESSION_EXPIRED_ANOTHER_DEVICE' }, { status: 401 });
    }
    const message = error.message || 'Ошибка принятия заказа.';
    const status = message.includes('недостаточно прав') || message.includes('Доступ запрещен')
      ? 403
      : message.includes('не найден')
      ? 404
      : message.includes('уже принят') || message.includes('Невозможно принять')
      ? 409
      : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
