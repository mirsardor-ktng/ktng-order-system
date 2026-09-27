import { NextRequest, NextResponse } from 'next/server';
import { requireAuthAsync, SessionExpiredError } from '@/lib/auth';
import { OrderDocumentService } from '@/lib/orders/order-document.service';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { documentId: string } }
) {
  try {
    const session = await requireAuthAsync(req);
    const documentId = params.documentId;
    if (!documentId) {
      return NextResponse.json({ error: 'ID документа не указан.' }, { status: 400 });
    }

    const { document, fileBuffer } = await OrderDocumentService.getDocumentForDownload(
      session,
      documentId,
      req
    );

    const contentType = document.mimeType || 'application/octet-stream';

    return new NextResponse(fileBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error: any) {
    if (error instanceof SessionExpiredError || error.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: error.message, code: 'SESSION_EXPIRED_ANOTHER_DEVICE' }, { status: 401 });
    }
    console.error('[Document Download Error]', error);
    const message = error.message || 'Ошибка скачивания документа.';
    const status = message.includes('Недостаточно прав') || message.includes('Доступ запрещен')
      ? 403
      : message.includes('не найден')
      ? 404
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
