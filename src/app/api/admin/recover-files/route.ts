import { NextRequest, NextResponse } from 'next/server';
import { requirePermissionAsync } from '@/lib/auth';
import { recoverLegacyFileLinks } from '@/lib/migration';
import { AuditService } from '@/lib/audit/audit.service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const session = await requirePermissionAsync(req, 'settings:manage');

    const report = await recoverLegacyFileLinks();

    // Log recovery action
    await AuditService.log({
      userId: session.userId,
      action: 'ADMIN_TRIGGER_LINK_RECOVERY',
      details: `Администратор запустил восстановление ссылок файлов. Обработано заказов: ${report.processed}, восстановлено: ${report.recovered}`,
      req
    });

    return NextResponse.json({ success: true, report });
  } catch (error: any) {
    console.error('[File Recovery Route Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
