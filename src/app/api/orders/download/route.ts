import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requireAuthAsync, hasPermission, SessionExpiredError } from '@/lib/auth';
import { downloadFile } from '@/lib/gdrive';
import { OrdersService } from '@/lib/orders/orders.service';

export const dynamic = 'force-dynamic';

/**
 * GET: Streams Excel order sheets directly from Google Drive after verifying session and permissions.
 * Supports download via orderId parameter with legacy fallback support.
 */
export async function GET(req: NextRequest) {
  try {
    // 1. Authenticate user with sessionVersion validation
    const session = await requireAuthAsync(req);

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

    // 3. Verify permissions (RBAC & Visibility)
    const isOwner = order.customerId === session.userId || order.createdByUserId === session.userId;
    const isSuper = session.role === 'ADMIN' || session.roleName === 'Суперадминистратор' || session.permissions?.includes('*');

    if (!isSuper && !isOwner) {
      // CUSTOMER can only download orders belonging to their company
      if (!hasPermission(session, 'orders:view_all')) {
        if (!session.companyId || order.companyId !== session.companyId) {
          return NextResponse.json({ error: 'Доступ запрещен (Вы можете скачивать только заказы вашей компании).' }, { status: 403 });
        }
      } else {
        // Seller / Manager: if order is NEW, only validator can access
        if (order.status === 'NEW' && !hasPermission(session, 'orders:validation:view')) {
          return NextResponse.json({ error: 'Доступ запрещен (заказ ожидает валидации).' }, { status: 403 });
        }
        if (order.status === 'DRAFT') {
          return NextResponse.json({ error: 'Доступ запрещен (черновик доступен только автору).' }, { status: 403 });
        }
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

    // On-demand generation fallback if background compilation is still running or fileId is missing
    if (!fileId && order.status !== 'DRAFT') {
      try {
        const generated = await OrdersService.ensureExcelGenerated(order.id);
        if (generated) {
          fileId = generated.fileId;
          finalFileName = generated.fileName;
        }
      } catch (genErr) {
        console.error('[On-Demand Excel Generation Error]', genErr);
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
    if (error instanceof SessionExpiredError || error.code === 'SESSION_EXPIRED_ANOTHER_DEVICE') {
      return NextResponse.json({ error: error.message, code: 'SESSION_EXPIRED_ANOTHER_DEVICE' }, { status: 401 });
    }
    console.error('[Download API Error]', error);
    return NextResponse.json({ error: `Ошибка при скачивании: ${error.message}` }, { status: 500 });
  }
}
