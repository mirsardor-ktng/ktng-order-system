import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getOrderCalculationConfig } from '@/lib/calculation/config-cache';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = getSession(req);
    const companyId = session?.companyId || null;

    const { config } = await getOrderCalculationConfig(companyId);
    return NextResponse.json(config);
  } catch (err: any) {
    console.error('Failed to get order calculation config:', err);
    return NextResponse.json({ error: err.message || 'Ошибка загрузки конфигурации' }, { status: 500 });
  }
}
