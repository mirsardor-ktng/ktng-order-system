import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { runDatabaseMigration } from '@/lib/migration';
import { AuditService } from '@/lib/audit/audit.service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const session = getSession(req);
    if (!session || session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Доступ разрешен только администраторам.' }, { status: 403 });
    }

    const report = await runDatabaseMigration();

    // Log the migration action
    await AuditService.log({
      userId: session.userId,
      action: 'ADMIN_TRIGGER_MIGRATION',
      details: `Администратор запустил миграцию базы данных. Создано компаний: ${report.companiesCreated}, пользователей мигрировано: ${report.usersMigrated}, заказов привязано: ${report.ordersLinked}, файлов восстановлено: ${report.filesRecovered}`,
      req
    });

    return NextResponse.json({ success: true, report });
  } catch (error: any) {
    console.error('[Migration Route Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
