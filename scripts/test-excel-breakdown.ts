import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { generateExcelOrder, ExcelOrderData } from '../src/lib/excel';

async function main() {
  console.log('--- RUNNING TEST: EXCEL QUANTITY BREAKDOWN (8 SCENARIOS) ---');

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

  // Create an in-memory template that captures both item and total placeholders
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
  const templateBuffer = Buffer.from(await wb.xlsx.writeBuffer());

  // Helper to run order through generateExcelOrder and parse results
  async function testOrderScenario(
    testName: string,
    orderData: ExcelOrderData,
    expectedTotalCases: number,
    expectedTotalBlocks: number
  ) {
    const buffer = await generateExcelOrder(templateBuffer, orderData);
    const resultWb = new ExcelJS.Workbook();
    await resultWb.xlsx.load(buffer as any);
    const resultWs = resultWb.worksheets[0];

    // Find summary row (marked by 'Итого:' in column A)
    let summaryRow: ExcelJS.Row | null = null;
    resultWs.eachRow((row) => {
      if (String(row.getCell(1).value ?? '').trim() === 'Итого:') {
        summaryRow = row;
      }
    });

    if (!summaryRow) {
      assert(false, `${testName}: Summary row not found`);
      return;
    }

    const actualTotalCases = Number((summaryRow as ExcelJS.Row).getCell(2).value);
    const actualTotalBlocks = Number((summaryRow as ExcelJS.Row).getCell(3).value);

    assert(
      actualTotalCases === expectedTotalCases,
      `${testName}: TOTAL_CASES expected ${expectedTotalCases}, got ${actualTotalCases}`
    );
    assert(
      actualTotalBlocks === expectedTotalBlocks,
      `${testName}: TOTAL_BLOCKS expected ${expectedTotalBlocks}, got ${actualTotalBlocks}`
    );
  }

  // SCENARIO 1: 70 blocks across multiple SKUs (e.g. 7 SKUs x 10 blocks each) -> 0 boxes / 70 blocks
  await testOrderScenario(
    'Scenario 1 (70 blocks across 7 SKUs)',
    {
      clientName: 'Client 1',
      orderDate: '2026-10-01',
      orderNumber: 'ORD-1',
      totalBlocks: 70,
      totalCases: 0,
      totalPrice: 700000,
      items: Array.from({ length: 7 }, (_, i) => ({
        sku: `SKU-${i + 1}`,
        name: `Item ${i + 1}`,
        packs: 100, // 10 blocks
        blocks: 10,
        cases: 0,
        totalQuantityPacks: 100,
        totalQuantityBlocks: 10,
        price: 1000,
        itemTotalPrice: 100000
      }))
    },
    0,
    70
  );

  // SCENARIO 2: 50 blocks one SKU -> 1 box / 0 blocks
  await testOrderScenario(
    'Scenario 2 (50 blocks one SKU)',
    {
      clientName: 'Client 2',
      orderDate: '2026-10-01',
      orderNumber: 'ORD-2',
      totalBlocks: 50,
      totalCases: 1,
      totalPrice: 500000,
      items: [
        {
          sku: 'SKU-50BL',
          name: 'Item 50BL',
          packs: 500,
          blocks: 50,
          cases: 1,
          totalQuantityPacks: 500,
          totalQuantityBlocks: 50,
          price: 1000,
          itemTotalPrice: 500000
        }
      ]
    },
    1,
    0
  );

  // SCENARIO 3: 49 blocks one SKU -> 0 boxes / 49 blocks
  await testOrderScenario(
    'Scenario 3 (49 blocks one SKU)',
    {
      clientName: 'Client 3',
      orderDate: '2026-10-01',
      orderNumber: 'ORD-3',
      totalBlocks: 49,
      totalCases: 0,
      totalPrice: 490000,
      items: [
        {
          sku: 'SKU-49BL',
          name: 'Item 49BL',
          packs: 490,
          blocks: 49,
          cases: 0,
          totalQuantityPacks: 490,
          totalQuantityBlocks: 49,
          price: 1000,
          itemTotalPrice: 490000
        }
      ]
    },
    0,
    49
  );

  // SCENARIO 4: 500 packs one SKU -> 1 box / 0 blocks
  await testOrderScenario(
    'Scenario 4 (500 packs one SKU)',
    {
      clientName: 'Client 4',
      orderDate: '2026-10-01',
      orderNumber: 'ORD-4',
      totalBlocks: 50,
      totalCases: 1,
      totalPrice: 500000,
      items: [
        {
          sku: 'SKU-500P',
          name: 'Item 500P',
          packs: 500,
          blocks: 50,
          cases: 1,
          totalQuantityPacks: 500,
          totalQuantityBlocks: 50,
          price: 1000,
          itemTotalPrice: 500000
        }
      ]
    },
    1,
    0
  );

  // SCENARIO 5: 600 packs one SKU -> 1 box + 10 blocks
  await testOrderScenario(
    'Scenario 5 (600 packs one SKU)',
    {
      clientName: 'Client 5',
      orderDate: '2026-10-01',
      orderNumber: 'ORD-5',
      totalBlocks: 60,
      totalCases: 1.2,
      totalPrice: 600000,
      items: [
        {
          sku: 'SKU-600P',
          name: 'Item 600P',
          packs: 600,
          blocks: 60,
          cases: 1,
          totalQuantityPacks: 600,
          totalQuantityBlocks: 60,
          price: 1000,
          itemTotalPrice: 600000
        }
      ]
    },
    1,
    10
  );

  // SCENARIO 6: 980 packs one SKU -> 1 box + 48 blocks
  await testOrderScenario(
    'Scenario 6 (980 packs one SKU)',
    {
      clientName: 'Client 6',
      orderDate: '2026-10-01',
      orderNumber: 'ORD-6',
      totalBlocks: 98,
      totalCases: 1.96,
      totalPrice: 980000,
      items: [
        {
          sku: 'SKU-980P',
          name: 'Item 980P',
          packs: 980,
          blocks: 98,
          cases: 1,
          totalQuantityPacks: 980,
          totalQuantityBlocks: 98,
          price: 1000,
          itemTotalPrice: 980000
        }
      ]
    },
    1,
    48
  );

  // SCENARIO 7: Multiple SKUs where only one reaches 500 packs -> 1 box + 20 blocks
  // SKU 1: 500 packs (1 box, 0 blocks)
  // SKU 2: 200 packs (0 boxes, 20 blocks)
  await testOrderScenario(
    'Scenario 7 (SKU 1: 500 packs, SKU 2: 200 packs)',
    {
      clientName: 'Client 7',
      orderDate: '2026-10-01',
      orderNumber: 'ORD-7',
      totalBlocks: 70,
      totalCases: 1.4,
      totalPrice: 700000,
      items: [
        {
          sku: 'SKU-7A',
          name: 'Item 7A',
          packs: 500,
          blocks: 50,
          cases: 1,
          totalQuantityPacks: 500,
          totalQuantityBlocks: 50,
          price: 1000,
          itemTotalPrice: 500000
        },
        {
          sku: 'SKU-7B',
          name: 'Item 7B',
          packs: 200,
          blocks: 20,
          cases: 0,
          totalQuantityPacks: 200,
          totalQuantityBlocks: 20,
          price: 1000,
          itemTotalPrice: 200000
        }
      ]
    },
    1,
    20
  );

  // SCENARIO 8: Multiple SKUs where total > 500 packs, but no single SKU reaches 500 packs
  // SKU 1: 300 packs (0 boxes, 30 blocks)
  // SKU 2: 300 packs (0 boxes, 30 blocks)
  // Total: 600 packs -> 0 boxes / 60 blocks (NOT 1 box + 10 blocks!)
  await testOrderScenario(
    'Scenario 8 (SKU 1: 300 packs, SKU 2: 300 packs - total 600 packs)',
    {
      clientName: 'Client 8',
      orderDate: '2026-10-01',
      orderNumber: 'ORD-8',
      totalBlocks: 60,
      totalCases: 0,
      totalPrice: 600000,
      items: [
        {
          sku: 'SKU-8A',
          name: 'Item 8A',
          packs: 300,
          blocks: 30,
          cases: 0,
          totalQuantityPacks: 300,
          totalQuantityBlocks: 30,
          price: 1000,
          itemTotalPrice: 300000
        },
        {
          sku: 'SKU-8B',
          name: 'Item 8B',
          packs: 300,
          blocks: 30,
          cases: 0,
          totalQuantityPacks: 300,
          totalQuantityBlocks: 30,
          price: 1000,
          itemTotalPrice: 300000
        }
      ]
    },
    0,
    60
  );

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
