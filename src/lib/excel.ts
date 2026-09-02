import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { normalizePacks } from './conversion';

export interface ExcelOrderData {
  clientName: string;
  orderDate: string;
  orderNumber: string;
  totalBlocks: number;
  totalCases: number;
  totalPrice: number;
  items: Array<{
    sku: string;
    name: string;
    packs: number; // totalQuantityPacks (backward compat alias)
    blocks: number; // totalQuantityBlocks
    cases: number; // totalQuantityCases
    baseQuantityPacks?: number;
    bonusQuantityPacks?: number;
    totalQuantityPacks?: number;
    baseQuantityBlocks?: number;
    bonusQuantityBlocks?: number;
    totalQuantityBlocks?: number;
    price: number;
    effectivePrice?: number;
    itemTotalPrice: number;
    isBonus?: boolean;
    promotionNote?: string;
  }>;
}

/**
 * Loads an Excel template, fills in the placeholder values, preserves styles and formatting,
 * and returns the completed spreadsheet as a Buffer.
 * 
 * Supports two distinct templates formats:
 * 1. FIXED: Pre-arranged layout where the template has a static row for each cigarette SKU,
 *    and we simply find the row containing that SKU and fill the placeholders.
 * 2. DYNAMIC: General template containing a single row with "{SKU_NAME}" which we clone
 *    dynamically for each ordered item, preserving borders and fonts.
 */
export async function generateExcelOrder(
  templateBuffer: Buffer,
  orderData: ExcelOrderData
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  // Cast templateBuffer as any to bypass ExcelJS type mismatch on Buffer definition
  await workbook.xlsx.load(templateBuffer as any);
  
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Template does not contain any worksheets.');
  }

  // Calculate global breakdown totals using canonical totalQuantityPacks with packs fallback
  const totalPacksSum = orderData.items.reduce((sum, item) => sum + (item.totalQuantityPacks ?? item.packs), 0);
  const totalCasesBreakdown = Math.floor(totalPacksSum / 500);
  const totalBlocksBreakdown = Math.floor((totalPacksSum % 500) / 10);
  const totalPacksBreakdown = totalPacksSum % 10;

  // 1. Process Global / Meta Placeholders (e.g. {CLIENT_NAME}, {ORDER_DATE})
  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      const val = cell.value;
      if (typeof val === 'string') {
        let text = val;
        if (text.includes('{CLIENT_NAME}')) text = text.replace('{CLIENT_NAME}', orderData.clientName);
        if (text.includes('{ORDER_DATE}')) text = text.replace('{ORDER_DATE}', orderData.orderDate);
        if (text.includes('{ORDER_NUMBER}')) text = text.replace('{ORDER_NUMBER}', orderData.orderNumber);
        if (text.includes('{TOTAL_BLOCKS}')) text = text.replace('{TOTAL_BLOCKS}', String(totalBlocksBreakdown));
        if (text.includes('{TOTAL_CASES}')) text = text.replace('{TOTAL_CASES}', String(totalCasesBreakdown));
        if (text.includes('{TOTAL_PACKS}')) text = text.replace('{TOTAL_PACKS}', String(totalPacksBreakdown));
        if (text.includes('{TOTAL_QTY_PACKS}')) text = text.replace('{TOTAL_QTY_PACKS}', String(totalPacksSum));
        if (text.includes('{TOTAL_PRICE}')) text = text.replace('{TOTAL_PRICE}', String(orderData.totalPrice));
        cell.value = text;
      }
    });
  });

  // 2. Identify repeating row or static rows
  let dynamicRowIndex = -1;
  
  // Find dynamic list marker row (e.g. row that contains {SKU_NAME})
  worksheet.eachRow((row, rowIndex) => {
    row.eachCell((cell) => {
      const val = cell.value;
      if (typeof val === 'string' && val.includes('{SKU_NAME}')) {
        dynamicRowIndex = rowIndex;
      }
    });
  });

  const resolveAndEvaluate = (text: string, vars: Record<string, any>): any => {
    if (text in vars) {
      return vars[text];
    }

    let substituted = text;
    for (const [key, val] of Object.entries(vars)) {
      substituted = substituted.replaceAll(key, String(val));
    }

    const sanitized = substituted.replace(/[^0-9\s.+\-*/()]/g, '');
    if (sanitized.trim() === substituted.trim() && /[+\-*/()]/g.test(substituted)) {
      try {
        const result = new Function(`return (${sanitized})`)();
        if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
          return result;
        }
      } catch {
        // Fallback
      }
    }
    return substituted;
  };

  if (dynamicRowIndex !== -1) {
    // APPROACH 1: DYNAMIC ROWS (Duplicate the row for each ordered item)
    const orderItems = orderData.items.filter(item => (item.totalQuantityPacks ?? item.packs) > 0);

    if (orderItems.length > 0) {
      if (orderItems.length > 1) {
        worksheet.duplicateRow(dynamicRowIndex, orderItems.length - 1, true);
      }

      for (let i = 0; i < orderItems.length; i++) {
        const item = orderItems[i];
        const row = worksheet.getRow(dynamicRowIndex + i);
        
        row.eachCell({ includeEmpty: true }, (cell) => {
          const val = cell.value;
          if (typeof val === 'string') {
            const basePacks = item.baseQuantityPacks ?? item.packs;
            const bonusPacks = item.bonusQuantityPacks ?? 0;
            const totalPacks = item.totalQuantityPacks ?? item.packs;

            const baseBlocks = item.baseQuantityBlocks ?? Math.floor(basePacks / 10);
            const bonusBlocks = item.bonusQuantityBlocks ?? Math.floor(bonusPacks / 10);
            const totalBlocks = item.totalQuantityBlocks ?? item.blocks ?? Math.floor(totalPacks / 10);

            const qtyDetails = bonusBlocks > 0 
              ? `${totalBlocks} бл. (${baseBlocks} оплат. + ${bonusBlocks} бонус)`
              : `${totalBlocks} бл.`;

            const itemVars: Record<string, any> = {
              '{QTY_PACKS}': totalPacks % 10,
              '{QTY_BLOCKS}': Math.floor((totalPacks % 500) / 10),
              '{QTY_CASES}': Math.floor(totalPacks / 500),
              '{ITEM_QTY_PACKS}': totalPacks,
              '{BASE_PACKS}': basePacks,
              '{BONUS_PACKS}': bonusPacks,
              '{TOTAL_PACKS}': totalPacks,
              '{BASE_BLOCKS}': baseBlocks,
              '{BONUS_BLOCKS}': bonusBlocks,
              '{TOTAL_BLOCKS}': totalBlocks,
              '{QTY_DETAILS}': qtyDetails,
              '{PRICE}': item.effectivePrice || item.price,
              '{ORIGINAL_PRICE}': item.price,
              '{EFFECTIVE_PRICE}': item.effectivePrice || item.price,
              '{PROMOTION_NOTE}': item.promotionNote || '',
              '{ITEM_TOTAL}': item.itemTotalPrice,
              '{ITEM_TOTAL_PRICE}': item.itemTotalPrice,
              '{TOTAL_PRICE}': orderData.totalPrice,
              '{SKU_NAME}': item.promotionNote ? `${item.name} (${item.promotionNote})` : item.name,
              '{SKU_CODE}': item.sku
            };
            cell.value = resolveAndEvaluate(val, itemVars);
          }
        });
      }
    } else {
      worksheet.spliceRows(dynamicRowIndex, 1);
    }
  } else {
    // APPROACH 2: FIXED ROWS
    worksheet.eachRow((row) => {
      let isProductRow = false;
      let matchingItem: typeof orderData.items[0] | undefined;

      row.eachCell((cell) => {
        const val = cell.value;
        if (typeof val === 'string') {
          const matching = orderData.items.find(
            item => val === item.name || val === item.sku
          );
          if (matching) {
            isProductRow = true;
            matchingItem = matching;
          }
        }
      });

      if (isProductRow && matchingItem) {
        row.eachCell((cell) => {
          const val = cell.value;
          if (typeof val === 'string') {
            const itemVars: Record<string, any> = (() => {
                const tp = matchingItem!.totalQuantityPacks ?? matchingItem!.packs;
                const bp = matchingItem!.baseQuantityPacks ?? tp;
                const bonusP = matchingItem!.bonusQuantityPacks ?? 0;
                const baseBlocks = matchingItem!.baseQuantityBlocks ?? Math.floor(bp / 10);
                const bonusBlocks = matchingItem!.bonusQuantityBlocks ?? Math.floor(bonusP / 10);
                const totalBlocks = matchingItem!.totalQuantityBlocks ?? matchingItem!.blocks ?? Math.floor(tp / 10);
                return {
                  '{QTY_PACKS}': tp > 0 ? (tp % 10) : 0,
                  '{QTY_BLOCKS}': tp > 0 ? Math.floor((tp % 500) / 10) : 0,
                  '{QTY_CASES}': tp > 0 ? Math.floor(tp / 500) : 0,
                  '{ITEM_QTY_PACKS}': tp > 0 ? tp : 0,
                  '{BASE_PACKS}': bp,
                  '{BONUS_PACKS}': bonusP,
                  '{TOTAL_PACKS}': tp,
                  '{BASE_BLOCKS}': baseBlocks,
                  '{BONUS_BLOCKS}': bonusBlocks,
                  '{TOTAL_BLOCKS}': totalBlocks,
                  '{QTY_DETAILS}': bonusBlocks > 0
                    ? `${totalBlocks} бл. (${baseBlocks} оплат. + ${bonusBlocks} бонус)`
                    : `${totalBlocks} бл.`,
                  '{PRICE}': matchingItem!.effectivePrice || matchingItem!.price,
                  '{ORIGINAL_PRICE}': matchingItem!.price,
                  '{EFFECTIVE_PRICE}': matchingItem!.effectivePrice || matchingItem!.price,
                  '{ITEM_TOTAL}': matchingItem!.itemTotalPrice > 0 ? matchingItem!.itemTotalPrice : 0,
                  '{ITEM_TOTAL_PRICE}': matchingItem!.itemTotalPrice > 0 ? matchingItem!.itemTotalPrice : 0,
                  '{TOTAL_PRICE}': orderData.totalPrice,
                };
              })();
            cell.value = resolveAndEvaluate(val, itemVars);
          }
        });
      }
    });
  }

  const outputBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(outputBuffer);
}

/**
 * Creates a default, basic Excel template file on disk.
 * This is used if the Admin hasn't uploaded a template yet, providing a default.
 */
export async function createDefaultExcelTemplateOnDisk(filePath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Заказ B2B');

  // Page title
  worksheet.mergeCells('A1:G1');
  worksheet.getCell('A1').value = 'B2B СИГАРЕТНАЯ ПРОДУКЦИЯ - БЛАНК ЗАКАЗА';
  worksheet.getCell('A1').font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  worksheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getCell('A1').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF3B82F6' } // Blue primary color
  };
  worksheet.getRow(1).height = 40;

  // Meta Info Table
  worksheet.getCell('A3').value = 'Клиент:';
  worksheet.getCell('A3').font = { bold: true };
  worksheet.getCell('B3').value = '{CLIENT_NAME}';
  worksheet.mergeCells('B3:D3');

  worksheet.getCell('F3').value = 'Дата заказа:';
  worksheet.getCell('F3').font = { bold: true };
  worksheet.getCell('G3').value = '{ORDER_DATE}';

  worksheet.getCell('A4').value = 'Номер заказа:';
  worksheet.getCell('A4').font = { bold: true };
  worksheet.getCell('B4').value = '{ORDER_NUMBER}';
  worksheet.mergeCells('B4:D4');

  // Headers
  const headers = ['Код SKU', 'Наименование продукции', 'Пачки (кол-во)', 'Блоки (кол-во)', 'Коробки (кол-во)', 'Цена (сум)', 'Сумма (сум)'];
  worksheet.getRow(6).values = headers;
  worksheet.getRow(6).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  worksheet.getRow(6).height = 25;
  
  const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  cols.forEach((col) => {
    const cell = worksheet.getCell(`${col}6`);
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F2937' } // Dark gray header
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin' },
      bottom: { style: 'thin' },
      left: { style: 'thin' },
      right: { style: 'thin' }
    };
  });

  // Dynamic Row Marker
  worksheet.getCell('A7').value = '{SKU_CODE}';
  worksheet.getCell('B7').value = '{SKU_NAME}';
  worksheet.getCell('C7').value = '{QTY_PACKS}';
  worksheet.getCell('D7').value = '{QTY_BLOCKS}';
  worksheet.getCell('E7').value = '{QTY_CASES}';
  worksheet.getCell('F7').value = '{PRICE}';
  worksheet.getCell('G7').value = '{ITEM_TOTAL}';

  cols.forEach((col) => {
    const cell = worksheet.getCell(`${col}7`);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin' },
      bottom: { style: 'thin' },
      left: { style: 'thin' },
      right: { style: 'thin' }
    };
  });

  // Totals Row
  worksheet.getCell('C9').value = 'Итого блоков:';
  worksheet.getCell('C9').font = { bold: true };
  worksheet.getCell('D9').value = '{TOTAL_BLOCKS}';
  worksheet.getCell('D9').font = { bold: true };

  worksheet.getCell('C10').value = 'Итого коробок:';
  worksheet.getCell('C10').font = { bold: true };
  worksheet.getCell('D10').value = '{TOTAL_CASES}';
  worksheet.getCell('D10').font = { bold: true };

  worksheet.getCell('F10').value = 'Сумма Итого:';
  worksheet.getCell('F10').font = { bold: true, size: 12 };
  worksheet.getCell('G10').value = '{TOTAL_PRICE}';
  worksheet.getCell('G10').font = { bold: true, size: 12, color: { argb: 'FF10B981' } }; // Success Green

  // Set nice column widths
  worksheet.getColumn('A').width = 15;
  worksheet.getColumn('B').width = 30;
  worksheet.getColumn('C').width = 15;
  worksheet.getColumn('D').width = 15;
  worksheet.getColumn('E').width = 15;
  worksheet.getColumn('F').width = 15;
  worksheet.getColumn('G').width = 18;

  // Make directories if missing
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await workbook.xlsx.writeFile(filePath);
  console.log(`[Excel Engine] Created default static template blank at: ${filePath}`);
}
