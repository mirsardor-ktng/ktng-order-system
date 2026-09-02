import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getSession } from '@/lib/auth';
import { downloadFile } from '@/lib/gdrive';

export const dynamic = 'force-dynamic';

/**
 * GET: Streams Excel order sheets directly from Google Drive after verifying session and permissions.
 * Supports download via orderId parameter with legacy fallback support.
 */
export async function GET(req: NextRequest) {
  try {
    // 1. Authenticate user
    const session = getSession(req);
    if (!session) {
      return NextResponse.json({ error: 'Необходима авторизация.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get('id');

    if (!orderId) {
      return NextResponse.json({ error: 'ID заказа не указан' }, { status: 400 });
    }

    // 2. Fetch order details
    const order = await prisma.order.findUnique({
      where: { id: orderId }
    });

    if (!order) {
      return NextResponse.json({ error: 'Заказ не найден.' }, { status: 404 });
    }

    // 3. Verify permissions (RBAC)
    // CUSTOMER can only download orders belonging to their company. SELLER, ADMIN, and MANAGER can download all.
    if (session.role === 'CUSTOMER') {
      if (!session.companyId || order.companyId !== session.companyId) {
        return NextResponse.json({ error: 'Доступ запрещен (Вы можете скачивать только заказы вашей компании).' }, { status: 403 });
      }
    }

    // 4. Resolve file parameters (New architecture first, fallback to legacy parse next)
    let fileId = order.fileId;
    let finalFileName = order.fileName;

    if (!fileId && order.fileUrl) {
      try {
        const urlObj = new URL(order.fileUrl, 'http://localhost');
        fileId = urlObj.searchParams.get('fileId');
        finalFileName = urlObj.searchParams.get('fileName') || `order_${order.orderNumber}.xlsx`;
      } catch (parseErr) {
        console.error('[Legacy URL Parse Error]', parseErr);
      }
    }

    if (!fileId) {
      return NextResponse.json({ error: 'Файл накладной для этого заказа еще не сгенерирован или отсутствует ID.' }, { status: 404 });
    }

    if (!finalFileName) {
      finalFileName = `order_${order.orderNumber}.xlsx`;
    }

    let fileBuffer: Buffer;

    // 5. Download the file from Google Drive (or local mock)
    try {
      fileBuffer = await downloadFile(fileId, finalFileName, 'Orders');
    } catch (gdriveErr: any) {
      console.error('[GDrive Download Error]', gdriveErr);
      return NextResponse.json({ error: 'Не удалось скачать файл накладной из облачного хранилища.' }, { status: 502 });
    }

    // 6. Log the action to Audit Logs
    await prisma.auditLog.create({
      data: {
        userId: session.userId,
        action: 'DOWNLOAD_ORDER',
        details: `${session.name || session.email} скачал заказ №${order.orderNumber}`
      }
    });

    // 7. Stream the Excel file response
    return new NextResponse(fileBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(finalFileName)}`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (error: any) {
    console.error('[Download API Error]', error);
    return NextResponse.json({ error: `Ошибка при скачивании: ${error.message}` }, { status: 500 });
  }
}
