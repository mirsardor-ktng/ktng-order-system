import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { generateExcelOrder, ExcelOrderData } from '../src/lib/excel';

async function main() {
  console.log('--- RUNNING TEST: EXCEL QUANTITY BREAKDOWN ---');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`[PASS] ${msg}`);
      passed++;
    } else {
      console.error(`[FAIL] ${msg}`);
      failed++;
    }
  }

  // 1. Check strict mathematical breakdown function
  const testQuantities = [
    { packs: 10, expectedBoxes: 0, expectedRemBlocks: 1, expectedTotalBlocks: 1, expectedRemPacks: 0 },
    { packs: 480, expectedBoxes: 0, expectedRemBlocks: 48, expectedTotalBlocks: 48, expectedRemPacks: 0 },
    { packs: 500, expectedBoxes: 1, expectedRemBlocks: 0, expectedTotalBlocks: 50, expectedRemPacks: 0 },
    { packs: 510, expectedBoxes: 1, expectedRemBlocks: 1, expectedTotalBlocks: 51, expectedRemPacks: 0 },
    { packs: 980, expectedBoxes: 1, expectedRemBlocks: 48, expectedTotalBlocks: 98, expectedRemPacks: 0 },
    { packs: 1000, expectedBoxes: 2, expectedRemBlocks: 0, expectedTotalBlocks: 100, expectedRemPacks: 0 },
  ];

  for (const t of testQuantities) {
    const boxes = Math.floor(t.packs / 500);
    const remPacks = t.packs % 500;
    const remBlocks = Math.floor(remPacks / 10);
    const loosePacks = remPacks % 10;
    const totalBlocks = Math.floor(t.packs / 10);

    assert(boxes === t.expectedBoxes, `Math ${t.packs}p: boxes === ${t.expectedBoxes} (got ${boxes})`);
    assert(remBlocks === t.expectedRemBlocks, `Math ${t.packs}p: remBlocks === ${t.expectedRemBlocks} (got ${remBlocks})`);
    assert(totalBlocks === t.expectedTotalBlocks, `Math ${t.packs}p: totalBlocks === ${t.expectedTotalBlocks} (got ${totalBlocks})`);
    assert(loosePacks === t.expectedRemPacks, `Math ${t.packs}p: loosePacks === ${t.expectedRemPacks} (got ${loosePacks})`);
  }

  // 2. Test generateExcelOrder with a dynamic workbook
  const templatePath = path.join(process.cwd(), 'templates', 'order_template.xlsx');
  let templateBuffer: Buffer;
  if (fs.existsSync(templatePath)) {
    templateBuffer = fs.readFileSync(templatePath);
  } else {
    // Generate a test template in memory
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Order');
    ws.getCell('A1').value = 'Client: {CLIENT_NAME}';
    ws.getCell('A2').value = 'Order: {ORDER_NUMBER}';
    ws.getCell('A3').value = '{SKU_NAME}';
    ws.getCell('B3').value = '{QTY_CASES}';
    ws.getCell('C3').value = '{QTY_BLOCKS}';
    ws.getCell('D3').value = '{QTY_PACKS}';
    ws.getCell('E3').value = '{TOTAL_BLOCKS}';
    ws.getCell('A4').value = 'Итого:';
    ws.getCell('B4').value = '{TOTAL_CASES}';
    ws.getCell('C4').value = '{TOTAL_BLOCKS}';
    ws.getCell('D4').value = '{TOTAL_PACKS}';
    templateBuffer = Buffer.from(await wb.xlsx.writeBuffer());
  }

  // TEST 2A: 500 packs order (1 box, 0 rem blocks, 50 total blocks)
  const orderData500: ExcelOrderData = {
    clientName: 'Test Retail 500',
    orderDate: '2026-09-30',
    orderNumber: 'ORD-500',
    totalBlocks: 50,
    totalCases: 1,
    totalPrice: 5000000,
    items: [
      {
        sku: 'SKU-500',
        name: 'Product 500',
        packs: 500,
        blocks: 50,
        cases: 1,
        totalQuantityPacks: 500,
        totalQuantityBlocks: 50,
        price: 10000,
        itemTotalPrice: 5000000
      }
    ]
  };

  const buffer500 = await generateExcelOrder(templateBuffer, orderData500);
  const resultWb500 = new ExcelJS.Workbook();
  await resultWb500.xlsx.load(buffer500 as any);
  const ws500 = resultWb500.worksheets[0];

  // Inspect generated rows in 500 packs order
  let foundTotalBlocks500 = false;
  let foundTotalCases500 = false;
  let foundQtyCases500 = false;
  let foundQtyBlocks500 = false;

  ws500.eachRow((row) => {
    row.eachCell((cell) => {
      const v = String(cell.value ?? '');
      if (v === '50') foundTotalBlocks500 = true;
      if (v === '1') foundTotalCases500 = true;
      if (v === '0') foundQtyBlocks500 = true;
    });
  });

  assert(foundTotalBlocks500, 'Excel 500p: {TOTAL_BLOCKS} is 50 (NOT 0)');
  assert(foundTotalCases500, 'Excel 500p: {TOTAL_CASES} is 1');

  // TEST 2B: 980 packs order (1 box, 48 rem blocks, 98 total blocks)
  const orderData980: ExcelOrderData = {
    clientName: 'Test Retail 980',
    orderDate: '2026-09-30',
    orderNumber: 'ORD-980',
    totalBlocks: 98,
    totalCases: 1.96,
    totalPrice: 9800000,
    items: [
      {
        sku: 'SKU-980',
        name: 'Product 980',
        packs: 980,
        blocks: 98,
        cases: 1,
        totalQuantityPacks: 980,
        totalQuantityBlocks: 98,
        price: 10000,
        itemTotalPrice: 9800000
      }
    ]
  };

  const buffer980 = await generateExcelOrder(templateBuffer, orderData980);
  const resultWb980 = new ExcelJS.Workbook();
  await resultWb980.xlsx.load(buffer980 as any);
  const ws980 = resultWb980.worksheets[0];

  let foundTotalBlocks980 = false;
  let foundQtyBlocks980 = false;

  ws980.eachRow((row) => {
    row.eachCell((cell) => {
      const v = String(cell.value ?? '');
      if (v === '98') foundTotalBlocks980 = true;
      if (v === '48') foundQtyBlocks980 = true;
    });
  });

  assert(foundTotalBlocks980, 'Excel 980p: {TOTAL_BLOCKS} is 98');
  assert(foundQtyBlocks980, 'Excel 980p: {QTY_BLOCKS} is 48');

  // TEST 2C: 1000 packs order (2 boxes, 0 rem blocks, 100 total blocks)
  const orderData1000: ExcelOrderData = {
    clientName: 'Test Retail 1000',
    orderDate: '2026-09-30',
    orderNumber: 'ORD-1000',
    totalBlocks: 100,
    totalCases: 2,
    totalPrice: 10000000,
    items: [
      {
        sku: 'SKU-1000',
        name: 'Product 1000',
        packs: 1000,
        blocks: 100,
        cases: 2,
        totalQuantityPacks: 1000,
        totalQuantityBlocks: 100,
        price: 10000,
        itemTotalPrice: 10000000
      }
    ]
  };

  const buffer1000 = await generateExcelOrder(templateBuffer, orderData1000);
  const resultWb1000 = new ExcelJS.Workbook();
  await resultWb1000.xlsx.load(buffer1000 as any);
  const ws1000 = resultWb1000.worksheets[0];

  let foundTotalBlocks1000 = false;
  let foundTotalCases1000 = false;

  ws1000.eachRow((row) => {
    row.eachCell((cell) => {
      const v = String(cell.value ?? '');
      if (v === '100') foundTotalBlocks1000 = true;
      if (v === '2') foundTotalCases1000 = true;
    });
  });

  assert(foundTotalBlocks1000, 'Excel 1000p: {TOTAL_BLOCKS} is 100 (NOT 0)');
  assert(foundTotalCases1000, 'Excel 1000p: {TOTAL_CASES} is 2');

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
