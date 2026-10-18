import { NextRequest, NextResponse } from 'next/server';
import { requirePermissionAsync, hasPermission, SessionExpiredError } from '@/lib/auth';
import { AnalyticsService } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const start = performance.now();
  try {
    const session = await requirePermissionAsync(req, 'analytics:view');
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const month = searchParams.get('month');

    if (month && (startDate || endDate)) {
      return NextResponse.json({ error: 'Укажите месяц или диапазон дат.' }, { status: 400 });
    }
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json({ error: 'Некорректный формат месяца.' }, { status: 400 });
    }
    if ((startDate && !endDate) || (!startDate && endDate)) {
      return NextResponse.json({ error: 'Необходимо указать обе даты периода.' }, { status: 400 });
    }
    if (startDate && endDate) {
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      const from = new Date(`${startDate}T00:00:00.000Z`);
      const to = new Date(`${endDate}T00:00:00.000Z`);
      const days = (to.getTime() - from.getTime()) / 86_400_000;
      if (!datePattern.test(startDate) || !datePattern.test(endDate) ||
          Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || days < 0 || days > 365) {
        return NextResponse.json({ error: 'Некорректный или слишком длинный период.' }, { status: 400 });
      }
    }

    // Only users authorized to view all companies may choose the analytics scope.
    let companyIds: string[] | null = null;
    if (hasPermission(session, 'orders:view_all')) {
      const requested = searchParams.getAll('companyIds').flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);
      if (requested.length > 100) {
        return NextResponse.json({ error: 'Слишком много компаний в запросе.' }, { status: 400 });
      }
      companyIds = requested.length ? [...new Set(requested)] : null;
    }

    const data = await AnalyticsService.getAnalyticsData(session, {
      startDate,
      endDate,
      companyIds,
      monthKey: month
    });

    const durationMs = Math.round(performance.now() - start);
    console.log(`[PERF] GET /api/analytics durationMs: ${durationMs}`);
    return NextResponse.json(data);
  } catch (error: any) {
    if (error instanceof SessionExpiredError || error.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    const message = error?.message || 'Не удалось получить аналитику.';
    const status = message.includes('авторизация') ? 401 : message.includes('недостаточно прав') ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
