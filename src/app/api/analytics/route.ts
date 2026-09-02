import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { AnalyticsService } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = getSession(req);

    if (!session) {
      return NextResponse.json(
        { error: 'Необходима авторизация' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const month = searchParams.get('month'); // e.g. "2026-06"

    const data = await AnalyticsService.getAnalyticsData(session as any, month);

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[Analytics API]', error);

    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}