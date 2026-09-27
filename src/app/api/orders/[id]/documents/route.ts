import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { OrderDocumentService } from '@/lib/orders/order-document.service';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = requireAuth(req);
    const orderId = params.id;

    if (!orderId) {
      return NextResponse.json({ error: 'ID заказа не указан.' }, { status: 400 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const type = formData.get('type') as string | null;

    if (!type) {
      return NextResponse.json({ error: 'Тип документа обязателен.' }, { status: 400 });
    }

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Файл не прикреплен.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    const document = await OrderDocumentService.uploadDocument(
      session,
      orderId,
      type,
      file.name,
      fileBuffer,
      file.type,
      req
    );

    return NextResponse.json({ success: true, document }, { status: 201 });
  } catch (error: any) {
    console.error('[Upload Document Error]', error);
    const message = error.message || 'Ошибка загрузки документа.';
    const status = message.includes('Недостаточно прав') || message.includes('Доступ запрещен')
      ? 403
      : message.includes('не найден')
      ? 404
      : message.includes('превышает') || message.includes('Недопустимый') || message.includes('обязателен')
      ? 400
      : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
