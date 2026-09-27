import { NextRequest, NextResponse } from 'next/server';
import { requirePermissionAsync, SessionExpiredError } from '@/lib/auth';
import { WarehouseAssemblyRequestService } from '@/lib/warehouse/warehouse-assembly-request.service';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requirePermissionAsync(req, 'orders:warehouse_request:create');
    const orderId = params.id;
    if (!orderId) {
      return NextResponse.json({ error: 'ID заказа не указан.' }, { status: 400 });
    }

    const document = await WarehouseAssemblyRequestService.generateWarehouseRequest(
      session,
      orderId,
      req
    );

    return NextResponse.json({
      success: true,
      document
    });
  } catch (error: any) {
    if (error instanceof SessionExpiredError || error.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: error.message, code: 'SESSION_EXPIRED_ANOTHER_DEVICE' }, { status: 401 });
    }
    console.error('[Warehouse Request Generate Error]', error);
    const status = error.message?.includes('Недостаточно прав') || error.message?.includes('Доступ запрещен')
      ? 403
      : error.message?.includes('не найден')
      ? 404
      : 400;
    return NextResponse.json({ error: error.message || 'Ошибка генерации складского запроса.' }, { status });
  }
}
