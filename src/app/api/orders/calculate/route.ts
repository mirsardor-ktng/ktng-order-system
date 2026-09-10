import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { PromotionsService } from '@/lib/promotions/promotions.service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const start = performance.now();
  try {
    const session = getSession(req);
    const body = await req.json();

    const { items, companyId } = body;

    if (!Array.isArray(items)) {
      return NextResponse.json({ error: 'Поле items должно быть массивом' }, { status: 400 });
    }

    const effectiveCompanyId = companyId || session?.companyId;

    const formattedInput = items.map(item => ({
      productId: item.productId,
      groupId: item.groupId,
      groupDisplayName: item.groupDisplayName,
      sku: item.sku,
      name: item.name,
      baseQuantityPacks: Math.max(0, parseInt(item.baseQuantityPacks || item.quantityPacks || item.packs || 0) || 0),
      price: item.price !== undefined ? parseFloat(item.price) : undefined
    }));

    const calculatedOrder = await PromotionsService.calculateOrder(formattedInput, effectiveCompanyId);

    const durationMs = Math.round(performance.now() - start);
    console.log(`[PERF] POST /api/orders/calculate durationMs: ${durationMs}`);

    return NextResponse.json(calculatedOrder);
  } catch (error: any) {
    console.error('[Calculate Order API Error]', error);
    return NextResponse.json({ error: error.message || 'Ошибка расчета промоакций' }, { status: 500 });
  }
}
