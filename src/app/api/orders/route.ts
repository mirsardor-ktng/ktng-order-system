import { NextRequest, NextResponse } from 'next/server';
import { requirePermissionAsync, SessionExpiredError } from '@/lib/auth';
import { OrdersService } from '@/lib/orders/orders.service';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    const session = await requirePermissionAsync(req, ['orders:view_all', 'orders:view_own', 'orders:create']);
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get('customerId') || undefined;
    const status = searchParams.get('status') || undefined;
    const startDate = searchParams.get('startDate') || searchParams.get('from') || undefined;
    const endDate = searchParams.get('endDate') || searchParams.get('to') || undefined;
    const orders = await OrdersService.getOrders(session as any, { customerId, status, startDate, endDate });
    return NextResponse.json(orders);
  } catch (error: any) {
    if (error instanceof SessionExpiredError || error.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: error.message, code: 'SESSION_EXPIRED_ANOTHER_DEVICE' }, { status: 401 });
    }
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}
export async function POST(req: NextRequest) {
  try {
    const session = await requirePermissionAsync(req, 'orders:create');
    const body = await req.json();
    const { items, status } = body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Заказ пуст.' }, { status: 400 });
    }
    const result = await OrdersService.createOrder(session as any, { items, status }, req);
    return NextResponse.json({
      success: true,
      order: result.order,
      message: result.message
    });
  } catch (error: any) {
    if (error instanceof SessionExpiredError || error.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: error.message, code: 'SESSION_EXPIRED_ANOTHER_DEVICE' }, { status: 401 });
    }
    console.error('[Create Order Error]', error);
    const userMsg = formatOrderErrorMessage(error);
    return NextResponse.json({ error: userMsg }, { status: 500 });
  }
}
export async function PUT(req: NextRequest) {
  try {
    const session = await requirePermissionAsync(req, ['orders:edit', 'orders:create']);
    const body = await req.json();
    const { orderId, items, status } = body;
    if (!orderId) {
      return NextResponse.json({ error: 'ID заказа не указан.' }, { status: 400 });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Заказ не может быть пустым.' }, { status: 400 });
    }
    const result = await OrdersService.updateOrder(session as any, { orderId, items, status }, req);
    return NextResponse.json({
      success: true,
      order: result.order,
      message: result.message
    });
  } catch (error: any) {
    if (error instanceof SessionExpiredError || error.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: error.message, code: 'SESSION_EXPIRED_ANOTHER_DEVICE' }, { status: 401 });
    }
    console.error('[Update Order Error]', error);
    const userMsg = formatOrderErrorMessage(error);
    return NextResponse.json({ error: userMsg }, { status: 500 });
  }
}
function formatOrderErrorMessage(error: any): string {
  const msg = error?.message || '';
  if (msg.includes('Transaction not found') || msg.includes('Transaction already closed') || msg.includes('expired transaction')) {
    return 'Не удалось завершить транзакцию из-за задержки сети. Пожалуйста, повторите попытку.';
  }
  if (msg.includes('Превышен') || msg.includes('лимит запасов') || msg.includes('Недостаточно запаса') || msg.includes('Нет позиций')) {
    return msg;
  }
  if (msg.includes('prisma') || msg.includes('PrismaClient')) {
    return 'Произошла ошибка при сохранении данных заказа. Попробуйте еще раз.';
  }
  return msg || 'Не удалось сохранить заказ. Попробуйте еще раз.';
}
