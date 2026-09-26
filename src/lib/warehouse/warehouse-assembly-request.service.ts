import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { NextRequest } from 'next/server';
import prisma from '../db';
import { JWTPayload, hasPermission } from '../auth';
import { AuditService } from '../audit/audit.service';
import { uploadFile, downloadFile } from '../gdrive';
import { resolveWarehouseSku } from './warehouse-sku-mapping';
import { OrderDocument, OrderDocumentType } from '@prisma/client';

export interface WarehouseRequestItemRow {
  code: string;
  name: string;
  qty: number;
  type: 'CASE' | 'BLOCK';
  sku: string;
}

export interface WarehouseRequestMetadata {
  outboundNumber: string;
  dateKey: string;
  index: number;
  totalPhysicalItems: number;
  totalCases: number;
  totalBlocks: number;
  totalPacks: number;
  itemsCount: number;
  generatedAt: string;
}

export class WarehouseAssemblyRequestService {
  /**
   * Generates or re-generates a Warehouse Assembly Request document for an order.
   */
  static async generateWarehouseRequest(
    session: JWTPayload,
    orderId: string,
    req?: NextRequest
  ): Promise<OrderDocument> {
    // 1. Permission check
    if (!hasPermission(session, 'orders:warehouse_request:create')) {
      throw new Error('Недостаточно прав для формирования складского запроса на сборку.');
    }

    // 2. Fetch order with customer, company, items, and skuAllocations
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        company: true,
        customer: true,
        items: {
          include: {
            product: true,
            skuAllocations: {
              include: {
                product: true
              },
              orderBy: { id: 'asc' }
            }
          }
        },
        documents: {
          where: { type: 'WAREHOUSE_ASSEMBLY_REQUEST' },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!order) {
      throw new Error('Заказ не найден.');
    }

    // Access check for non-view_all users
    if (!hasPermission(session, 'orders:view_all')) {
      if (session.companyId && order.companyId !== session.companyId) {
        throw new Error('Доступ запрещен.');
      }
      if (!session.companyId && order.customerId !== session.userId) {
        throw new Error('Доступ запрещен.');
      }
    }

    // 3. Company validation
    const companyName = order.company?.name?.trim();
    if (!companyName) {
      throw new Error('У заказа отсутствует привязка к компании (контрагенту).');
    }

    // 4. Physical SKU & Quantities aggregation
    if (!order.items || order.items.length === 0) {
      throw new Error('В заказе отсутствуют позиции товаров.');
    }

    const skuPacksMap = new Map<string, { sku: string; name: string; packs: number }>();

    for (const item of order.items) {
      if (item.skuAllocations && item.skuAllocations.length > 0) {
        // Multi-SKU product group: take actual physical SKU allocations
        for (const alloc of item.skuAllocations) {
          const sku = (alloc.product?.sku || '').trim();
          const name = alloc.product?.name || sku;
          const packs = alloc.packs || 0;
          if (sku && packs > 0) {
            const current = skuPacksMap.get(sku);
            if (current) {
              current.packs += packs;
            } else {
              skuPacksMap.set(sku, { sku, name, packs });
            }
          }
        }
      } else {
        // Single-SKU product or legacy item
        const sku = (item.skuSnapshot || item.product?.sku || '').trim();
        const name = item.productNameSnapshot || item.product?.name || sku;
        const packs = item.totalQuantityPacks || item.quantityPacks || 0;
        if (sku && packs > 0) {
          const current = skuPacksMap.get(sku);
          if (current) {
            current.packs += packs;
          } else {
            skuPacksMap.set(sku, { sku, name, packs });
          }
        }
      }
    }

    if (skuPacksMap.size === 0) {
      throw new Error('В заказе отсутствуют позиции с ненулевым физическим количеством.');
    }

    // 5. Validation: multiple of 10 & SKU mapping resolution
    const caseRows: WarehouseRequestItemRow[] = [];
    const blockRows: WarehouseRequestItemRow[] = [];
    let totalPacksSum = 0;

    for (const [sku, info] of skuPacksMap.entries()) {
      if (info.packs % 10 !== 0) {
        throw new Error(
          `Количество пачек для SKU ${sku} (${info.name}) должно быть кратно 10 (1 блоку). Текущее количество: ${info.packs}`
        );
      }

      totalPacksSum += info.packs;

      // Will throw if SKU is not in warehouse mapping
      const mapping = resolveWarehouseSku(sku);

      const cases = Math.floor(info.packs / 500);
      const blocks = Math.floor((info.packs % 500) / 10);

      if (cases > 0) {
        caseRows.push({
          code: mapping.caseCode,
          name: mapping.caseName,
          qty: cases,
          type: 'CASE',
          sku
        });
      }

      if (blocks > 0) {
        blockRows.push({
          code: mapping.blockCode,
          name: mapping.blockName,
          qty: blocks,
          type: 'BLOCK',
          sku
        });
      }
    }

    // Table rows: cases first, then blocks
    const finalRows: WarehouseRequestItemRow[] = [...caseRows, ...blockRows];

    // 6. Stable Outbound Number Generation
    const existingDoc = order.documents?.[0] || null;
    let outboundNumber: string;
    let dateKey: string;
    let index: number;

    const existingMetadata = existingDoc?.metadata as any;
    if (existingMetadata && existingMetadata.outboundNumber) {
      // Reuse existing Outbound Number on re-generation
      outboundNumber = existingMetadata.outboundNumber;
      dateKey = existingMetadata.dateKey || outboundNumber.split('/')[0];
      index = existingMetadata.index || parseInt(outboundNumber.split('/')[1] || '1', 10);
    } else {
      // Generate new Outbound Number in Asia/Tashkent timezone: DDMMYYYY/Index
      const now = new Date();
      const tashkentDateParts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Tashkent',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }).format(now).split('/'); // ["DD", "MM", "YYYY"]

      dateKey = `${tashkentDateParts[0]}${tashkentDateParts[1]}${tashkentDateParts[2]}`;

      // Query existing warehouse documents created today to determine next sequence index
      const docsToday = await prisma.orderDocument.findMany({
        where: {
          type: 'WAREHOUSE_ASSEMBLY_REQUEST',
          metadata: {
            path: ['dateKey'],
            equals: dateKey
          }
        },
        select: { metadata: true }
      });

      let maxIndex = 0;
      for (const d of docsToday) {
        const dMeta = d.metadata as any;
        const dIdx = dMeta?.index || parseInt((dMeta?.outboundNumber || '').split('/')[1] || '0', 10);
        if (dIdx > maxIndex) {
          maxIndex = dIdx;
        }
      }

      index = maxIndex + 1;
      outboundNumber = `${dateKey}/${index}`;
    }

    // 7. Load Template Buffer
    let templateBuffer: Buffer;
    const dbTemplate = await prisma.template.findFirst({
      where: {
        isActive: true,
        type: 'WAREHOUSE_ASSEMBLY_REQUEST'
      }
    });

    if (dbTemplate) {
      if (dbTemplate.isLocal && dbTemplate.filePath && fs.existsSync(dbTemplate.filePath)) {
        templateBuffer = fs.readFileSync(dbTemplate.filePath);
      } else if (dbTemplate.fileId) {
        templateBuffer = await downloadFile(dbTemplate.fileId, dbTemplate.name, 'Templates');
      } else {
        const defaultPath = path.join(process.cwd(), 'templates', 'warehouse_assembly_request.xlsx');
        templateBuffer = fs.readFileSync(defaultPath);
      }
    } else {
      const defaultPath = path.join(process.cwd(), 'templates', 'warehouse_assembly_request.xlsx');
      if (!fs.existsSync(defaultPath)) {
        throw new Error(`Файл шаблона не найден по пути: ${defaultPath}`);
      }
      templateBuffer = fs.readFileSync(defaultPath);
    }

    // 8. Populate Workbook via ExcelJS
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(templateBuffer as any);

    const worksheet = workbook.getWorksheet('TDSheet') || workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('Лист TDSheet не найден в шаблоне.');
    }

    // Set Header fields
    // Row 4: Outbound №
    worksheet.getCell('B4').value = 'Outbound №';
    worksheet.getCell('C4').value = outboundNumber;

    // Row 5: От кого
    worksheet.getCell('A5').value = 'От кого';
    worksheet.getCell('B5').value = 'TRANSOSIYO';

    // Row 6: Кому
    worksheet.getCell('A6').value = 'Кому ';
    worksheet.getCell('B6').value = companyName;

    // Table Data Rows
    const BASE_START_ROW = 9;
    const TEMPLATE_CAPACITY = 36; // Rows 9 to 44
    const totalPhysicalItemsSum = finalRows.reduce((sum, r) => sum + r.qty, 0);

    const thinBorder = {
      top: { style: 'thin' as const },
      left: { style: 'thin' as const },
      bottom: { style: 'thin' as const },
      right: { style: 'thin' as const }
    };
    const fontRegular = { name: 'Arial', size: 9, bold: false };
    const fontHeaderBold = { name: 'Arial', size: 9, bold: true };

    let totalRowIndex = 45;

    if (finalRows.length > TEMPLATE_CAPACITY) {
      const extraRows = finalRows.length - TEMPLATE_CAPACITY;
      // Insert extra rows before row 45
      for (let i = 0; i < extraRows; i++) {
        worksheet.insertRow(45 + i, [null, null, null, null], 'i+');
        const insertedRow = worksheet.getRow(45 + i);
        insertedRow.height = 12.0;
        for (let col = 1; col <= 4; col++) {
          const cell = insertedRow.getCell(col);
          cell.border = thinBorder;
          cell.font = col === 1 ? fontHeaderBold : fontRegular;
          cell.alignment = {
            vertical: 'bottom',
            horizontal: col === 1 ? 'center' : (col === 4 ? 'center' : 'left')
          };
        }
      }

      totalRowIndex = 45 + extraRows;

      // Update merged cells for Total row
      try {
        worksheet.unMergeCells('A45:C45');
      } catch (e) {
        // ignore if not merged at original coords
      }
      worksheet.mergeCells(`A${totalRowIndex}:C${totalRowIndex}`);
    }

    // Populate item rows
    for (let i = 0; i < finalRows.length; i++) {
      const rowNum = BASE_START_ROW + i;
      const row = worksheet.getRow(rowNum);
      const item = finalRows[i];

      const cA = row.getCell(1);
      cA.value = i + 1;
      cA.font = fontHeaderBold;
      cA.alignment = { vertical: 'bottom', horizontal: 'center' };
      cA.border = thinBorder;

      const cB = row.getCell(2);
      cB.value = item.code;
      cB.font = fontRegular;
      cB.alignment = { vertical: 'bottom', horizontal: 'left' };
      cB.border = thinBorder;

      const cC = row.getCell(3);
      cC.value = item.name;
      cC.font = fontRegular;
      cC.alignment = { vertical: 'bottom', horizontal: 'left' };
      cC.border = thinBorder;

      const cD = row.getCell(4);
      cD.value = item.qty;
      cD.font = fontRegular;
      cD.alignment = { vertical: 'bottom', horizontal: 'center' };
      cD.numFmt = '#,##0';
      cD.border = thinBorder;
    }

    // For any remaining template rows before Total row, clear values
    const lastFilledRow = BASE_START_ROW + finalRows.length - 1;
    for (let r = lastFilledRow + 1; r < totalRowIndex; r++) {
      const row = worksheet.getRow(r);
      for (let c = 1; c <= 4; c++) {
        const cell = row.getCell(c);
        cell.value = null;
        cell.border = thinBorder;
      }
    }

    // Configure Total Row
    const cTotalLabel = worksheet.getCell(`A${totalRowIndex}`);
    cTotalLabel.value = 'Итого:';
    cTotalLabel.font = fontHeaderBold;
    cTotalLabel.alignment = { vertical: 'bottom', horizontal: 'left' };
    cTotalLabel.border = thinBorder;
    worksheet.getCell(`B${totalRowIndex}`).border = thinBorder;
    worksheet.getCell(`C${totalRowIndex}`).border = thinBorder;

    const cTotalVal = worksheet.getCell(`D${totalRowIndex}`);
    cTotalVal.value = {
      formula: `SUM(D9:D${totalRowIndex - 1})`,
      result: totalPhysicalItemsSum
    };
    cTotalVal.font = fontHeaderBold;
    cTotalVal.alignment = { vertical: 'bottom', horizontal: 'center' };
    cTotalVal.numFmt = '#,##0';
    cTotalVal.border = thinBorder;

    // Ensure signatures row exists and is styled
    const signaturesRowIndex = totalRowIndex + 4;
    const cSign1 = worksheet.getCell(`A${signaturesRowIndex}`);
    if (!cSign1.value) {
      cSign1.value = 'Отпустил: __________________';
      cSign1.font = { name: 'Arial', size: 8, bold: false };
      cSign1.alignment = { vertical: 'bottom', horizontal: 'left' };
    }
    const cSign2 = worksheet.getCell(`D${signaturesRowIndex}`);
    if (!cSign2.value) {
      cSign2.value = 'Получил: ___________________';
      cSign2.font = { name: 'Arial', size: 8, bold: false };
      cSign2.alignment = { vertical: 'bottom', horizontal: 'left' };
    }

    // 9. Generate file buffer
    const outputBuffer = await workbook.xlsx.writeBuffer();

    // 10. Upload file to storage
    const sanitizedCompanyName = companyName.replace(/[/\\?%*:|"<>]/g, '_');
    const safeOutboundName = outboundNumber.replace('/', '_');
    const fileName = `${safeOutboundName} Заказ отгрузки ${sanitizedCompanyName}.xlsx`;

    const uploadRes = await uploadFile(
      fileName,
      Buffer.from(outputBuffer),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Orders'
    );

    // 11. Save or Update OrderDocument
    const metadata: WarehouseRequestMetadata = {
      outboundNumber,
      dateKey,
      index,
      totalPhysicalItems: totalPhysicalItemsSum,
      totalCases: caseRows.reduce((sum, r) => sum + r.qty, 0),
      totalBlocks: blockRows.reduce((sum, r) => sum + r.qty, 0),
      totalPacks: totalPacksSum,
      itemsCount: finalRows.length,
      generatedAt: new Date().toISOString()
    };

    let document: OrderDocument;

    if (existingDoc) {
      document = await prisma.orderDocument.update({
        where: { id: existingDoc.id },
        data: {
          fileName,
          fileId: uploadRes.fileId,
          fileUrl: uploadRes.path || `https://drive.google.com/file/d/${uploadRes.fileId}/view`,
          createdByUserId: session.userId,
          metadata: metadata as any
        }
      });
    } else {
      document = await prisma.orderDocument.create({
        data: {
          orderId,
          type: 'WAREHOUSE_ASSEMBLY_REQUEST',
          fileName,
          fileId: uploadRes.fileId,
          fileUrl: uploadRes.path || `https://drive.google.com/file/d/${uploadRes.fileId}/view`,
          createdByUserId: session.userId,
          metadata: metadata as any
        }
      });
    }

    // 12. Create Audit Log
    await AuditService.log({
      userId: session.userId,
      action: 'GENERATE_WAREHOUSE_REQUEST',
      details: `Сформирован запрос на сборку на склад для заказа ${order.orderNumber} (Outbound № ${outboundNumber})`,
      oldValue: existingDoc ? `Doc ID: ${existingDoc.id}, Outbound: ${existingMetadata?.outboundNumber || 'N/A'}` : null,
      newValue: `Doc ID: ${document.id}, Outbound: ${outboundNumber}, Файл: ${fileName}, Позиций: ${finalRows.length}, Физических мест: ${totalPhysicalItemsSum}`,
      req
    });

    return document;
  }

  /**
   * Retrieves warehouse request document metadata and file buffer for download.
   */
  static async getWarehouseRequestDocument(
    session: JWTPayload,
    documentId: string,
    req?: NextRequest
  ): Promise<{ document: OrderDocument; fileBuffer: Buffer }> {
    // 1. Permission check
    if (!hasPermission(session, 'orders:warehouse_request:download')) {
      throw new Error('Недостаточно прав для скачивания складского запроса на сборку.');
    }

    // 2. Fetch document
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

    // Access check for non-view_all users
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

    // 3. Download buffer
    const fileBuffer = await downloadFile(document.fileId, document.fileName, 'Orders');

    // 4. Create Audit Log
    await AuditService.log({
      userId: session.userId,
      action: 'DOWNLOAD_WAREHOUSE_REQUEST',
      details: `Скачан запрос на сборку на склад (Doc ID: ${document.id}, Файл: ${document.fileName}, Заказ: ${document.order.orderNumber})`,
      req
    });

    return { document, fileBuffer };
  }
}
