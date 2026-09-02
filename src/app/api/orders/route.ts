import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { OrdersService } from '@/lib/orders/orders.service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = getSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Необходима авторизация.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get('customerId') || undefined;
    const status = searchParams.get('status') || undefined;

    const orders = await OrdersService.getOrders(session as any, { customerId, status });
    return NextResponse.json(orders);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = getSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Необходима авторизация.' }, { status: 401 });
    }

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
    console.error('[Create Order Error]', error);
    return NextResponse.json({ error: error.message }, { status: 550 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = getSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Необходима авторизация.' }, { status: 401 });
    }

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
    console.error('[Update Order Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
