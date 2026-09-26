import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth';
import { WarehouseAssemblyRequestService } from '@/lib/warehouse/warehouse-assembly-request.service';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { documentId: string } }
) {
  try {
    const session = requirePermission(req, 'orders:warehouse_request:download');
    const documentId = params.documentId;
    if (!documentId) {
      return NextResponse.json({ error: 'ID документа не указан.' }, { status: 400 });
    }

    const { document, fileBuffer } = await WarehouseAssemblyRequestService.getWarehouseRequestDocument(
      session,
      documentId,
      req
    );

    return new NextResponse(fileBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (error: any) {
    console.error('[Warehouse Document Download Error]', error);
    const status = error.message?.includes('Недостаточно прав') || error.message?.includes('Доступ запрещен')
      ? 403
      : error.message?.includes('не найден')
      ? 404
      : 500;
    return NextResponse.json({ error: error.message || 'Ошибка скачивания складского документа.' }, { status });
  }
}
