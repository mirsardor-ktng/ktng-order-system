import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { AnalyticsService } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const start = performance.now();
  try {
    const session = getSession(req);

    if (!session) {
      return NextResponse.json(
        { error: 'Необходима авторизация' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const month = searchParams.get('month'); // e.g. "2026-06"
    
    let companyIds: string[] | null = null;
    const allCompanyParams = searchParams.getAll('companyIds');
    if (allCompanyParams.length > 0) {
      companyIds = allCompanyParams.flatMap(c => c.split(',')).map(s => s.trim()).filter(Boolean);
      if (companyIds.length === 0) companyIds = null;
    }

    const data = await AnalyticsService.getAnalyticsData(session as any, {
      startDate,
      endDate,
      companyIds,
      monthKey: month
    });

    const durationMs = Math.round(performance.now() - start);
    console.log(`[PERF] GET /api/analytics durationMs: ${durationMs}`);

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[Analytics API]', error);

    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}