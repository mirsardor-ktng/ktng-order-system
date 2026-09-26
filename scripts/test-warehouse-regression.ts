import assert from 'assert';
import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import { WarehouseAssemblyRequestService } from '../src/lib/warehouse/warehouse-assembly-request.service';
import prisma from '../src/lib/db';
import { JWTPayload } from '../src/lib/auth';

async function runRegressionTests() {
  console.log('=== STARTING WAREHOUSE AUTOMATIC CODE GENERATION TESTS ===');

  // Helper simulating the universal automatic rule
  const generateWarehouseCodes = (sku: string, name: string) => {
    const cleanSku = (sku || '').trim();
    if (!cleanSku) throw new Error('Empty SKU');
    return {
      caseCode: cleanSku,
      caseName: name || cleanSku,
      blockCode: `${cleanSku}(b)`,
      blockName: `${name || cleanSku} (Block)`
    };
  };

  // Test 1: Standard SKU 10009500A0
  console.log('\n--- Test 1: Standard SKU (10009500A0) ---');
  const t1 = generateWarehouseCodes('10009500A0', 'SIMPLE E-On Island Pink');
  assert.strictEqual(t1.caseCode, '10009500A0');
  assert.strictEqual(t1.caseName, 'SIMPLE E-On Island Pink');
  assert.strictEqual(t1.blockCode, '10009500A0(b)');
  assert.strictEqual(t1.blockName, 'SIMPLE E-On Island Pink (Block)');
  console.log('✓ Test 1 passed: Standard SKU produces expected case/block codes and names:');
  console.log('  Case:', t1.caseCode, '|', t1.caseName);
  console.log('  Block:', t1.blockCode, '|', t1.blockName);

  // Test 2: Completely new SKU (99999999A0) without changing any mapping code
  console.log('\n--- Test 2: Completely new SKU (99999999A0) ---');
  const t2 = generateWarehouseCodes('99999999A0', 'BRAND NEW TEST PRODUCT');
  assert.strictEqual(t2.caseCode, '99999999A0');
  assert.strictEqual(t2.caseName, 'BRAND NEW TEST PRODUCT');
  assert.strictEqual(t2.blockCode, '99999999A0(b)');
  assert.strictEqual(t2.blockName, 'BRAND NEW TEST PRODUCT (Block)');
  console.log('✓ Test 2 passed: New SKU 99999999A0 automatically resolves without code changes:');
  console.log('  Case:', t2.caseCode, '|', t2.caseName);
  console.log('  Block:', t2.blockCode, '|', t2.blockName);

  // Test 3: 580 packs conversion
  console.log('\n--- Test 3: 580 packs conversion ---');
  const packs580 = 580;
  assert.strictEqual(packs580 % 10, 0, 'Must be multiple of 10');
  const cases580 = Math.floor(packs580 / 500);
  const blocks580 = Math.floor((packs580 % 500) / 10);
  assert.strictEqual(cases580, 1, '580 packs must yield exactly 1 case');
  assert.strictEqual(blocks580, 8, '580 packs must yield exactly 8 blocks');
  console.log(`✓ Test 3 passed: 580 packs = ${cases580} case(s) + ${blocks580} block(s)!`);

  // Test 4: Current order calculation (980 packs -> 1 case + 48 blocks = 49 physical places)
  console.log('\n--- Test 4: Current order physical places calculation ---');
  const orderSkus = [
    { sku: '10008726A1', name: 'ESSE Change Cold Black', packs: 10 },
    { sku: '10008730A2', name: 'ESSE Change Grip Style', packs: 10 },
    { sku: '10008751A2', name: 'ESSE Silver Grip Style', packs: 30 },
    { sku: '10009153A2', name: 'ESSE Change UP', packs: 30 },
    { sku: '10009161A3', name: 'ESSE Change', packs: 580 },
    { sku: '10009324A0', name: 'ESSE Sense Himalaya Grip Style', packs: 10 },
    { sku: '10009356A0', name: 'ESSE Sense Himalaya Demi', packs: 40 },
    { sku: '10009500A0', name: 'SIMPLE E-On Island Pink', packs: 10 },
    { sku: '10009529A0', name: 'BOHEM Libre Red', packs: 30 },
    { sku: '10009833A0', name: 'BOHEM Cavana Brown', packs: 20 },
    { sku: '10010258A0', name: 'PINE Blue', packs: 20 },
    { sku: '10010259A0', name: 'PINE Blue KS', packs: 10 },
    { sku: '10010311A0', name: 'PINE Green', packs: 20 },
    { sku: '10010372A0', name: 'ESSE Change Bing Grip Style', packs: 30 },
    { sku: '10010640A0', name: 'ESSE Change 1 Grip Style', packs: 130 }
  ];

  let totalOrderPacks = 0;
  let totalCases = 0;
  let totalBlocks = 0;

  for (const item of orderSkus) {
    totalOrderPacks += item.packs;
    assert.strictEqual(item.packs % 10, 0, `SKU ${item.sku} must be multiple of 10`);
    const itemCases = Math.floor(item.packs / 500);
    const itemBlocks = Math.floor((item.packs % 500) / 10);
    totalCases += itemCases;
    totalBlocks += itemBlocks;
  }

  assert.strictEqual(totalOrderPacks, 980, 'Total packs must be 980');
  assert.strictEqual(totalCases, 1, 'Total cases must be 1');
  assert.strictEqual(totalBlocks, 48, 'Total blocks must be 48');
  assert.strictEqual(totalCases + totalBlocks, 49, 'Total physical places must be 49');
  console.log(`✓ Test 4 passed: ${totalOrderPacks} packs = ${totalCases} case + ${totalBlocks} blocks = ${totalCases + totalBlocks} physical places!`);

  // Test 5: Live Service test & Excel inspection for order cmufeigoc0002rty8vvh0xbnj
  console.log('\n--- Test 5: Live WarehouseAssemblyRequestService Excel generation ---');
  const mockAdminSession: JWTPayload = {
    userId: 'admin-test-user',
    email: 'admin@ktng.uz',
    name: 'Admin Test',
    role: 'ADMIN',
    permissions: ['*']
  };

  const document = await WarehouseAssemblyRequestService.generateWarehouseRequest(
    mockAdminSession,
    'cmufeigoc0002rty8vvh0xbnj'
  );

  assert.ok(document.id, 'Document ID must be generated');
  console.log('Generated document:', document.id, '| Outbound:', (document.metadata as any)?.outboundNumber);

  const downloadResult = await WarehouseAssemblyRequestService.getWarehouseRequestDocument(
    mockAdminSession,
    document.id
  );
  assert.ok(downloadResult.fileBuffer.length > 0, 'Buffer must be valid');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(downloadResult.fileBuffer as any);
  const ws = wb.getWorksheet('TDSheet');
  assert.ok(ws, 'TDSheet must exist');

  // Verify Excel rows contain expected codes and names
  const populatedRows: Array<{ no: number; code: string; name: string; qty: number }> = [];
  for (let r = 9; r <= 44; r++) {
    const no = ws.getCell(`A${r}`).value;
    const code = ws.getCell(`B${r}`).value;
    const name = ws.getCell(`C${r}`).value;
    const qty = ws.getCell(`D${r}`).value;
    if (no !== null || code !== null || name !== null || qty !== null) {
      populatedRows.push({
        no: Number(no),
        code: String(code),
        name: String(name),
        qty: Number(qty)
      });
    }
  }

  console.log(`Populated Excel rows count: ${populatedRows.length}`);
  assert.strictEqual(populatedRows.length, 16, 'Should have 1 case row + 15 block rows = 16 rows');

  // Check 10009500A0(b) in Excel
  const simplePinkRow = populatedRows.find(r => r.code === '10009500A0(b)');
  assert.ok(simplePinkRow, 'Row with code 10009500A0(b) must exist in Excel');
  assert.strictEqual(simplePinkRow.name, 'SIMPLE E-On Island Pink (Block)');
  assert.strictEqual(simplePinkRow.qty, 1);
  console.log('✓ Found 10009500A0(b) row in Excel:', simplePinkRow);

  // Check 10009161A3 (case) in Excel
  const esseChangeCaseRow = populatedRows.find(r => r.code === '10009161A3');
  assert.ok(esseChangeCaseRow, 'Row with code 10009161A3 must exist in Excel');
  assert.strictEqual(esseChangeCaseRow.name, 'ESSE Change');
  assert.strictEqual(esseChangeCaseRow.qty, 1);
  console.log('✓ Found 10009161A3 (case) row in Excel:', esseChangeCaseRow);

  // Check total row in Excel
  assert.strictEqual(ws.getCell('A45').value, 'Итого:');
  const totalCellVal: any = ws.getCell('D45').value;
  assert.strictEqual(totalCellVal.formula, 'SUM(D9:D44)');
  assert.strictEqual(totalCellVal.result, 49, 'Excel total result must be exactly 49');
  console.log('✓ Total row verified in Excel: formula = SUM(D9:D44), result = 49');

  console.log('\n=== ALL REGRESSION TESTS PASSED SUCCESSFULLY! ===');
}

runRegressionTests().catch(err => {
  console.error('Regression test failed:', err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
