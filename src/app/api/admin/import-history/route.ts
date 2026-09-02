import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import prisma from '@/lib/db';
import { getSession } from '@/lib/auth';
import { AuditService } from '@/lib/audit/audit.service';

export const dynamic = 'force-dynamic';

interface ExcelRowData {
  orderNumber: string;
  orderDate: Date;
  customerName: string;
  sku: string;
  quantityPacks: number;
  packPrice: number;
  rowNum: number;
}

export async function POST(req: NextRequest) {
  try {
    const session = getSession(req);
    if (!session || session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Доступ разрешен только администраторам.' }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as Blob | null;
    const action = formData.get('action') as string; // 'validate' | 'import'

    if (!file) {
      return NextResponse.json({ error: 'Файл не загружен.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return NextResponse.json({ error: 'Excel файл не содержит листов.' }, { status: 400 });
    }

    const parsedRows: ExcelRowData[] = [];
    const validationErrors: string[] = [];
    const missingCustomers = new Set<string>();
    const missingSkus = new Set<string>();

    const uniqueCustomersInFile = new Set<string>();
    const uniqueSkusInFile = new Set<string>();
    const orderNumbersInFile = new Set<string>();

    let minDate: Date | null = null;
    let maxDate: Date | null = null;

    // First row (index 1) is header: OrderNumber, OrderDate, Customer, SKU, QuantityPacks, PackPrice
    for (let i = 2; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      
      // Skip completely empty rows
      const hasValues = row.values && Array.isArray(row.values) && row.values.some(v => v !== null && v !== undefined && v !== '');
      if (!hasValues) continue;

      const orderNumber = row.getCell(1).value?.toString()?.trim();
      const orderDateVal = row.getCell(2).value;
      const customerName = row.getCell(3).value?.toString()?.trim();
      const skuVal = row.getCell(4).value?.toString()?.trim();
      const quantityVal = row.getCell(5).value;
      const priceVal = row.getCell(6).value;

      if (!orderNumber) {
        validationErrors.push(`Строка ${i}: Номер заказа (OrderNumber) пуст или отсутствует.`);
        continue;
      }

      // Parse Date
      let orderDate: Date;
      if (orderDateVal instanceof Date) {
        orderDate = orderDateVal;
      } else if (typeof orderDateVal === 'string') {
        const cleanDateStr = orderDateVal.trim();
        const parts = cleanDateStr.split(/[.-]/);
        if (parts.length === 3) {
          if (parts[0].length === 4) {
            orderDate = new Date(`${parts[0]}-${parts[1]}-${parts[2]}`);
          } else {
            orderDate = new Date(`${parts[1]}/${parts[0]}/${parts[2]}`);
          }
        } else {
          orderDate = new Date(cleanDateStr);
        }
      } else {
        orderDate = new Date(NaN);
      }

      if (isNaN(orderDate.getTime())) {
        validationErrors.push(`Строка ${i}: Невалидный формат даты: "${orderDateVal}"`);
        continue;
      }

      const now = new Date();
      if (orderDate > now) {
        validationErrors.push(`Строка ${i}: Дата заказа не может быть в будущем: "${orderDate.toLocaleDateString()}"`);
        continue;
      }

      // Update date range
      if (!minDate || orderDate < minDate) minDate = orderDate;
      if (!maxDate || orderDate > maxDate) maxDate = orderDate;

      if (!customerName) {
        validationErrors.push(`Строка ${i}: Название клиента пусто.`);
        continue;
      }

      if (!skuVal) {
        validationErrors.push(`Строка ${i}: Артикул/SKU товара пуст.`);
        continue;
      }

      const quantity = Math.round(Number(quantityVal));
      if (isNaN(quantity) || quantity <= 0) {
        validationErrors.push(`Строка ${i}: Количество должно быть целым положительным числом.`);
        continue;
      }

      if (quantity % 10 !== 0) {
        validationErrors.push(`Строка ${i}: Количество должно быть кратно 10 (блоки).`);
        continue;
      }

      const price = Number(priceVal);
      if (isNaN(price) || price <= 0) {
        validationErrors.push(`Строка ${i}: Цена должна быть больше нуля.`);
        continue;
      }

      uniqueCustomersInFile.add(customerName);
      uniqueSkusInFile.add(skuVal);
      orderNumbersInFile.add(orderNumber);

      parsedRows.push({
        orderNumber,
        orderDate,
        customerName,
        sku: skuVal,
        quantityPacks: quantity,
        packPrice: price,
        rowNum: i
      });
    }

    if (parsedRows.length === 0 && validationErrors.length === 0) {
      return NextResponse.json({ error: 'Excel файл пуст или содержит некорректные заголовки.' }, { status: 400 });
    }

    // Load actual db objects to check match
    const dbCustomers = await prisma.user.findMany({
      where: { name: { in: Array.from(uniqueCustomersInFile) } }
    });

    const dbProducts = await prisma.product.findMany({
      where: {
        OR: [
          { sku: { in: Array.from(uniqueSkusInFile) } },
          { name: { in: Array.from(uniqueSkusInFile) } }
        ]
      }
    });

    // Match validation
    for (const name of uniqueCustomersInFile) {
      const match = dbCustomers.find(c => c.name === name);
      if (!match) {
        missingCustomers.add(name);
      }
    }

    for (const sku of uniqueSkusInFile) {
      const match = dbProducts.find(p => p.sku === sku || p.name === sku);
      if (!match) {
        missingSkus.add(sku);
      }
    }

    const hasMismatches = missingCustomers.size > 0 || missingSkus.size > 0 || validationErrors.length > 0;

    // Check duplicate order numbers against database
    const existingOrders = await prisma.order.findMany({
      where: { orderNumber: { in: Array.from(orderNumbersInFile) } },
      select: { orderNumber: true }
    });
    const existingOrderNums = new Set(existingOrders.map(o => o.orderNumber));

    const skippedOrdersList = Array.from(orderNumbersInFile).filter(num => existingOrderNums.has(num));

    const finalOrdersCount = orderNumbersInFile.size - skippedOrdersList.length;

    // Statistics Object
    const summary = {
      ordersCount: orderNumbersInFile.size,
      rowsCount: parsedRows.length,
      customersCount: uniqueCustomersInFile.size,
      skusCount: uniqueSkusInFile.size,
      skippedCount: skippedOrdersList.length,
      importCount: finalOrdersCount,
      period: minDate && maxDate 
        ? `${minDate.toLocaleDateString('ru-RU')} — ${maxDate.toLocaleDateString('ru-RU')}` 
        : '—'
    };

    if (action === 'validate') {
      return NextResponse.json({
        success: true,
        summary,
        validationErrors,
        missingCustomers: Array.from(missingCustomers),
        missingSkus: Array.from(missingSkus),
        skippedOrders: skippedOrdersList,
        canImport: !hasMismatches
      });
    }

    if (action === 'import') {
      if (hasMismatches) {
        return NextResponse.json({ 
          error: 'Импорт невозможен: найдены несоответствия данных. Пожалуйста, запустите проверку.',
          canImport: false
        }, { status: 400 });
      }

      // Group rows by orderNumber to create unified orders
      const ordersMap = new Map<string, ExcelRowData[]>();
      for (const row of parsedRows) {
        if (existingOrderNums.has(row.orderNumber)) continue; // Skip existing orders
        if (!ordersMap.has(row.orderNumber)) {
          ordersMap.set(row.orderNumber, []);
        }
        ordersMap.get(row.orderNumber)!.push(row);
      }

      // Execute import inside single database transaction
      const importStats = await prisma.$transaction(async (tx) => {
        let ordersImported = 0;
        let itemsImported = 0;

        for (const [orderNumber, rows] of ordersMap.entries()) {
          const firstRow = rows[0];
          const dbCustomer = dbCustomers.find(c => c.name === firstRow.customerName)!;

          let totalPacks = 0;
          let totalPrice = 0;
          const orderItemsData: any[] = [];

          for (const row of rows) {
            const dbProduct = dbProducts.find(p => p.sku === row.sku || p.name === row.sku)!;
            const itemTotalPrice = row.quantityPacks * row.packPrice;

            totalPacks += row.quantityPacks;
            totalPrice += itemTotalPrice;

            orderItemsData.push({
              productId: dbProduct.id,
              productNameSnapshot: dbProduct.name,
              skuSnapshot: dbProduct.sku,
              quantityPacks: row.quantityPacks,
              quantityBlocks: row.quantityPacks / 10,
              quantityCases: row.quantityPacks / 500,
              price: row.packPrice,
              itemTotalPrice,
              createdAt: firstRow.orderDate
            });

            itemsImported++;
          }

          // Create historical completed order
          await tx.order.create({
            data: {
              orderNumber,
              customerId: dbCustomer.id,
              status: 'COMPLETED',
              totalPacks,
              totalBlocks: totalPacks / 10,
              totalCases: Math.round((totalPacks / 500) * 100) / 100,
              totalPrice,
              source: 'IMPORT',
              isHistorical: true,
              createdAt: firstRow.orderDate,
              updatedAt: firstRow.orderDate,
              items: {
                create: orderItemsData
              }
            }
          });

          ordersImported++;
        }

        return {
          ordersImported,
          itemsImported
        };
      });

      // Write Audit Log
      await AuditService.log({
        userId: session.userId,
        action: 'IMPORT_HISTORICAL_ORDERS',
        details: `Администратор успешно импортировал историю продаж: ${importStats.ordersImported} заказов, ${importStats.itemsImported} строк. Период: ${summary.period}`,
        req
      });

      return NextResponse.json({
        success: true,
        importedOrders: importStats.ordersImported,
        importedRows: importStats.itemsImported,
        skippedOrders: skippedOrdersList.length,
        summary
      });
    }

    return NextResponse.json({ error: 'Неверное действие импорта.' }, { status: 400 });
  } catch (error: any) {
    console.error('[Import History Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
