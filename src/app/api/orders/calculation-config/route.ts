import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAsync, SessionExpiredError } from '@/lib/auth';
import { getOrderCalculationConfig } from '@/lib/calculation/config-cache';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuthAsync(req);
    const companyId = session.companyId || null;

    const { config } = await getOrderCalculationConfig(companyId);
    return NextResponse.json(config);
  } catch (err: any) {
    if (err instanceof SessionExpiredError || err.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error('Failed to get order calculation config:', err);
    return NextResponse.json({ error: err.message || 'Ошибка загрузки конфигурации' }, { status: 500 });
  }
}
