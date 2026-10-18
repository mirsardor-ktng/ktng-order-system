import { NextRequest, NextResponse } from 'next/server';
import { requirePermissionAsync, hasPermission, SessionExpiredError } from '@/lib/auth';
import { PromotionsService } from '@/lib/promotions/promotions.service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const start = performance.now();
  try {
    const session = await requirePermissionAsync(req, 'orders:create');
    const body = await req.json();
    const { items } = body || {};
    if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
      return NextResponse.json({ error: 'Укажите от 1 до 100 позиций.' }, { status: 400 });
    }

    const formattedInput = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') {
        return NextResponse.json({ error: 'Некорректная позиция заказа.' }, { status: 400 });
      }
      const rawQuantity = item.baseQuantityPacks ?? item.quantityPacks ?? item.packs ?? 0;
      const quantity = Number(rawQuantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 100_000) {
        return NextResponse.json({ error: 'Количество должно быть целым числом от 1 до 100000.' }, { status: 400 });
      }
      formattedInput.push({
        productId: typeof item.productId === 'string' ? item.productId : undefined,
        groupId: typeof item.groupId === 'string' ? item.groupId : undefined,
        groupDisplayName: typeof item.groupDisplayName === 'string' ? item.groupDisplayName : undefined,
        sku: typeof item.sku === 'string' ? item.sku : undefined,
        name: typeof item.name === 'string' ? item.name : undefined,
        baseQuantityPacks: quantity
      });
    }

    const requestedCompanyId = typeof body.companyId === 'string' ? body.companyId : null;
    const effectiveCompanyId = hasPermission(session, 'orders:view_all')
      ? (requestedCompanyId || session.companyId)
      : session.companyId;
    const calculatedOrder = await PromotionsService.calculateOrder(formattedInput, effectiveCompanyId);

    const durationMs = Math.round(performance.now() - start);
    console.log(`[PERF] POST /api/orders/calculate durationMs: ${durationMs}`);
    return NextResponse.json(calculatedOrder);
  } catch (error: any) {
    if (error instanceof SessionExpiredError || error.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    const message = error?.message || 'Ошибка расчета промоакций';
    const status = message.includes('авторизация') ? 401 : message.includes('недостаточно прав') ? 403 : 500;
    console.error('[Calculate Order API Error]', error);
    return NextResponse.json({ error: message }, { status });
  }
}
