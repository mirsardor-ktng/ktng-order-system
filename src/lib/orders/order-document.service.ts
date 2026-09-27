import { NextRequest } from 'next/server';
import path from 'path';
import prisma from '@/lib/db';
import { JWTPayload, hasPermission } from '@/lib/auth';
import { uploadFile, downloadFile } from '@/lib/gdrive';
import { AuditService } from '@/lib/audit/audit.service';
import { OrderDocument, OrderDocumentType } from '@prisma/client';

export const LOGISTICS_CODES_MAX_SIZE = 20 * 1024 * 1024; // 20 MB
export const TRANSPORT_PHOTO_MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_LOGISTICS_CODES_EXTENSIONS = ['.xlsx', '.xls', '.csv', '.pdf'];
export const ALLOWED_LOGISTICS_CODES_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/x-excel',
  'application/excel',
  'text/csv',
  'application/csv',
  'text/plain',
  'application/pdf'
];

export const ALLOWED_PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
export const ALLOWED_PHOTO_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp'
];

export const FORBIDDEN_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.sh', '.bin', '.js', '.mjs', '.ts', '.html', '.htm', '.svg', '.vbs', '.msi', '.com'
];

function sanitizeFilename(originalName: string): string {
  const base = path.basename(originalName);
  return base.replace(/[/\\?%*:|"<>]/g, '_');
}

function validateBufferSignature(buffer: Buffer, ext: string): boolean {
  if (buffer.length < 4) return false;

  // JPEG: FF D8 FF
  if (['.jpg', '.jpeg'].includes(ext)) {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  // PNG: 89 50 4E 47
  if (ext === '.png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  }
  // WebP: RIFF at 0..3 and WEBP at 8..11
  if (ext === '.webp') {
    return (
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  // PDF: %PDF
  if (ext === '.pdf') {
    return buffer.subarray(0, 4).toString('ascii') === '%PDF';
  }
  // XLSX: PK\x03\x04
  if (ext === '.xlsx') {
    return buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05);
  }
  // XLS: \xD0\xCF\x11\xE0
  if (ext === '.xls') {
    return buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  }
  // CSV / text: check no NULL bytes in first 512 bytes
  if (ext === '.csv') {
    const slice = buffer.subarray(0, Math.min(buffer.length, 512));
    for (let i = 0; i < slice.length; i++) {
      if (slice[i] === 0) return false;
    }
    return true;
  }
  return true;
}

export class OrderDocumentService {
  /**
   * Uploads an order document (Logistics Codes, Driver License, or Vehicle Registration).
   */
  static async uploadDocument(
    session: JWTPayload,
    orderId: string,
    type: string,
    fileName: string,
    fileBuffer: Buffer,
    reportedMimeType?: string,
    req?: NextRequest
  ): Promise<OrderDocument> {
    if (!orderId) {
      throw new Error('ID заказа не указан.');
    }

    if (!fileName || !fileBuffer || fileBuffer.length === 0) {
      throw new Error('Файл не предоставлен или пуст.');
    }

    // 1. Validate Document Type
    const validTypes: OrderDocumentType[] = [
      OrderDocumentType.LOGISTICS_CODES,
      OrderDocumentType.DRIVER_LICENSE_PHOTO,
      OrderDocumentType.VEHICLE_REGISTRATION_PHOTO
    ];

    if (!validTypes.includes(type as OrderDocumentType)) {
      throw new Error(`Недопустимый тип документа: ${type}`);
    }

    const docType = type as OrderDocumentType;

    // 2. Permission Check for Upload
    if (docType === OrderDocumentType.LOGISTICS_CODES) {
      if (!hasPermission(session, 'orders:logistics_codes:upload')) {
        throw new Error('Недостаточно прав для загрузки кодов логистики.');
      }
    } else if (
      docType === OrderDocumentType.DRIVER_LICENSE_PHOTO ||
      docType === OrderDocumentType.VEHICLE_REGISTRATION_PHOTO
    ) {
      if (!hasPermission(session, 'orders:transport_docs:upload')) {
        throw new Error('Недостаточно прав для загрузки транспортных документов.');
      }
    }

    // 3. Verify Order Existence and Access
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        companyId: true,
        customerId: true
      }
    });

    if (!order) {
      throw new Error('Заказ не найден.');
    }

    if (!hasPermission(session, 'orders:view_all')) {
      if (session.companyId && order.companyId !== session.companyId) {
        throw new Error('Доступ запрещен.');
      }
      if (!session.companyId && order.customerId !== session.userId) {
        throw new Error('Доступ запрещен.');
      }
    }

    // 4. File Extension & MIME Validation
    const cleanFileName = sanitizeFilename(fileName);
    const ext = path.extname(cleanFileName).toLowerCase();

    if (FORBIDDEN_EXTENSIONS.includes(ext)) {
      throw new Error('Недопустимый формат файла.');
    }

    let detectedMime = reportedMimeType || 'application/octet-stream';

    if (docType === OrderDocumentType.LOGISTICS_CODES) {
      if (fileBuffer.length > LOGISTICS_CODES_MAX_SIZE) {
        throw new Error(`Размер файла кодов превышает допустимый лимит ${LOGISTICS_CODES_MAX_SIZE / (1024 * 1024)} МБ.`);
      }

      if (!ALLOWED_LOGISTICS_CODES_EXTENSIONS.includes(ext)) {
        throw new Error('Недопустимый формат файла кодов. Разрешены форматы: .xlsx, .xls, .csv, .pdf');
      }

      if (reportedMimeType && !ALLOWED_LOGISTICS_CODES_MIME_TYPES.includes(reportedMimeType.toLowerCase())) {
        throw new Error('Недопустимый MIME-тип файла кодов.');
      }

      if (!validateBufferSignature(fileBuffer, ext)) {
        throw new Error('Содержимое файла не соответствует расширению.');
      }

      // Default MIME if generic
      if (!reportedMimeType || reportedMimeType === 'application/octet-stream') {
        if (ext === '.xlsx') detectedMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        else if (ext === '.xls') detectedMime = 'application/vnd.ms-excel';
        else if (ext === '.pdf') detectedMime = 'application/pdf';
        else if (ext === '.csv') detectedMime = 'text/csv';
      }
    } else {
      // Transport Photos
      if (fileBuffer.length > TRANSPORT_PHOTO_MAX_SIZE) {
        throw new Error(`Размер фотографии превышает допустимый лимит ${TRANSPORT_PHOTO_MAX_SIZE / (1024 * 1024)} МБ.`);
      }

      if (!ALLOWED_PHOTO_EXTENSIONS.includes(ext)) {
        throw new Error('Недопустимый формат фотографии. Разрешены форматы: .jpg, .jpeg, .png, .webp');
      }

      if (reportedMimeType && !ALLOWED_PHOTO_MIME_TYPES.includes(reportedMimeType.toLowerCase())) {
        throw new Error('Недопустимый MIME-тип изображения.');
      }

      if (!validateBufferSignature(fileBuffer, ext)) {
        throw new Error('Содержимое изображения повреждено или не соответствует формату.');
      }

      if (!reportedMimeType || reportedMimeType === 'application/octet-stream') {
        if (['.jpg', '.jpeg'].includes(ext)) detectedMime = 'image/jpeg';
        else if (ext === '.png') detectedMime = 'image/png';
        else if (ext === '.webp') detectedMime = 'image/webp';
      }
    }

    // 5. Generate Safe Storage Filename to prevent collisions
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const storageFileName = `ord_${orderId}_${docType.toLowerCase()}_${Date.now()}_${randomSuffix}_${cleanFileName}`;

    // 6. Upload to Storage
    const uploadRes = await uploadFile(storageFileName, fileBuffer, detectedMime, 'Orders');

    // 7. Resolve CreatedByUserId
    let validUserId: string | null = null;
    if (session.userId) {
      const userExists = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true }
      });
      if (userExists) {
        validUserId = userExists.id;
      }
    }

    // 8. Create OrderDocument Record
    const document = await prisma.orderDocument.create({
      data: {
        orderId,
        type: docType,
        fileId: uploadRes.fileId,
        fileName: cleanFileName,
        fileUrl: uploadRes.path || '',
        mimeType: detectedMime,
        fileSize: fileBuffer.length,
        createdByUserId: validUserId,
        metadata: {
          originalFileName: cleanFileName,
          storageFileName,
          uploadedSource: docType === OrderDocumentType.LOGISTICS_CODES ? 'LOGISTICS' : 'TRANSPORT'
        }
      }
    });

    // 9. Audit Logging
    await AuditService.log({
      userId: validUserId,
      action: 'UPLOAD_ORDER_DOCUMENT',
      details: `Загружен документ (Doc ID: ${document.id}, Тип: ${docType}, Файл: ${cleanFileName}, Заказ: ${order.orderNumber})`,
      newValue: JSON.stringify({
        documentId: document.id,
        documentType: docType,
        fileName: cleanFileName,
        orderId: order.id,
        orderNumber: order.orderNumber,
        fileSize: fileBuffer.length
      }),
      req
    });

    return document;
  }

  /**
   * Retrieves document metadata and file buffer for download.
   */
  static async getDocumentForDownload(
    session: JWTPayload,
    documentId: string,
    req?: NextRequest
  ): Promise<{ document: OrderDocument; fileBuffer: Buffer }> {
    if (!documentId) {
      throw new Error('ID документа не указан.');
    }

    const document = await prisma.orderDocument.findUnique({
      where: { id: documentId },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            companyId: true,
            customerId: true
          }
        }
      }
    });

    if (!document) {
      throw new Error('Документ не найден.');
    }

    // Permission check by document type
    if (document.type === OrderDocumentType.WAREHOUSE_ASSEMBLY_REQUEST) {
      if (!hasPermission(session, 'orders:warehouse_request:download')) {
        throw new Error('Недостаточно прав для скачивания запроса на сборку.');
      }
    } else if (document.type === OrderDocumentType.LOGISTICS_CODES) {
      if (!hasPermission(session, 'orders:logistics_codes:download')) {
        throw new Error('Недостаточно прав для скачивания файлов кодов логистики.');
      }
    } else if (
      document.type === OrderDocumentType.DRIVER_LICENSE_PHOTO ||
      document.type === OrderDocumentType.VEHICLE_REGISTRATION_PHOTO
    ) {
      if (!hasPermission(session, 'orders:transport_docs:download')) {
        throw new Error('Недостаточно прав для скачивания транспортных документов.');
      }
    }

    // Access check for order ownership
    if (!hasPermission(session, 'orders:view_all')) {
      if (session.companyId && document.order.companyId !== session.companyId) {
        throw new Error('Доступ запрещен.');
      }
      if (!session.companyId && document.order.customerId !== session.userId) {
        throw new Error('Доступ запрещен.');
      }
    }

    if (!document.fileId) {
      throw new Error('Идентификатор файла отсутствует в записи документа.');
    }

    const storageFileName = (document.metadata as any)?.storageFileName || document.fileName;
    const fileBuffer = await downloadFile(document.fileId, storageFileName, 'Orders');

    // Audit Logging
    let validUserId: string | null = null;
    if (session.userId) {
      const userExists = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true }
      });
      if (userExists) {
        validUserId = userExists.id;
      }
    }

    await AuditService.log({
      userId: validUserId,
      action: 'DOWNLOAD_ORDER_DOCUMENT',
      details: `Скачан документ (Doc ID: ${document.id}, Тип: ${document.type}, Файл: ${document.fileName}, Заказ: ${document.order.orderNumber})`,
      newValue: JSON.stringify({
        documentId: document.id,
        documentType: document.type,
        fileName: document.fileName,
        orderId: document.order.id,
        orderNumber: document.order.orderNumber
      }),
      req
    });

    return { document, fileBuffer };
  }

  /**
   * Retrieves document metadata and file buffer for secure image preview.
   */
  static async getDocumentForPreview(
    session: JWTPayload,
    documentId: string,
    req?: NextRequest
  ): Promise<{ document: OrderDocument; fileBuffer: Buffer; mimeType: string }> {
    if (!documentId) {
      throw new Error('ID документа не указан.');
    }

    const document = await prisma.orderDocument.findUnique({
      where: { id: documentId },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            companyId: true,
            customerId: true
          }
        }
      }
    });

    if (!document) {
      throw new Error('Документ не найден.');
    }

    // Only transport photos can be previewed via this endpoint
    if (
      document.type !== OrderDocumentType.DRIVER_LICENSE_PHOTO &&
      document.type !== OrderDocumentType.VEHICLE_REGISTRATION_PHOTO
    ) {
      throw new Error('Предпросмотр доступен только для фотографий транспортных документов.');
    }

    // Permission check
    if (!hasPermission(session, 'orders:transport_docs:view')) {
      throw new Error('Недостаточно прав для просмотра транспортных документов.');
    }

    // Access check for order ownership
    if (!hasPermission(session, 'orders:view_all')) {
      if (session.companyId && document.order.companyId !== session.companyId) {
        throw new Error('Доступ запрещен.');
      }
      if (!session.companyId && document.order.customerId !== session.userId) {
        throw new Error('Доступ запрещен.');
      }
    }

    if (!document.fileId) {
      throw new Error('Идентификатор файла отсутствует в записи документа.');
    }

    const storageFileName = (document.metadata as any)?.storageFileName || document.fileName;
    const fileBuffer = await downloadFile(document.fileId, storageFileName, 'Orders');

    const mimeType = document.mimeType || 'image/jpeg';

    // Audit Logging
    let validUserId: string | null = null;
    if (session.userId) {
      const userExists = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true }
      });
      if (userExists) {
        validUserId = userExists.id;
      }
    }

    await AuditService.log({
      userId: validUserId,
      action: 'PREVIEW_ORDER_DOCUMENT',
      details: `Предпросмотр документа (Doc ID: ${document.id}, Тип: ${document.type}, Файл: ${document.fileName}, Заказ: ${document.order.orderNumber})`,
      newValue: JSON.stringify({
        documentId: document.id,
        documentType: document.type,
        fileName: document.fileName,
        orderId: document.order.id,
        orderNumber: document.order.orderNumber
      }),
      req
    });

    return { document, fileBuffer, mimeType };
  }
}
