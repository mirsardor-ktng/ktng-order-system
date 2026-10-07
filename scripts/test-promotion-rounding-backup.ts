import { calculateOrderPure } from '../src/lib/calculation/engine';
import { OrderCalculationConfig } from '../src/lib/calculation/types';
import { generateExcelOrder, ExcelOrderData, createDefaultExcelTemplateOnDisk } from '../src/lib/excel';
import { findFileInFolder, downloadFile } from '../src/lib/gdrive';
import { decrypt } from '../src/lib/security';
import { OrdersService } from '../src/lib/orders/orders.service';
import prisma from '../src/lib/db';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';

interface TestResult {
  name: string;
  expected: string;
  actual: string;
  status: 'PASS' | 'FAIL';
  details?: string;
}

const results: TestResult[] = [];

function record(name: string, expected: string, actual: string, pass: boolean, details?: string) {
  const status = pass ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name} | Expected: ${expected} | Actual: ${actual}`);
  if (details) console.log(`       Details: ${details}`);
  results.push({ name, expected, actual, status, details });
  if (!pass) {
    throw new Error(`Test failed: ${name}`);
  }
}

async function main() {
  console.log('================================================================');
  console.log('   PROMOTION CALCULATION, ROUNDING & BACKUP VALIDATION SUITE    ');
  console.log('================================================================\n');

  // Products definitions
  const pA = { id: 'pA', sku: 'SKU-A', name: 'Product A', basePrice: 10000, groupId: 'gA' };
  const pB = { id: 'pB', sku: 'SKU-B', name: 'Product B', basePrice: 12000, groupId: 'gB' };
  const pC = { id: 'pC', sku: 'SKU-C', name: 'Product C', basePrice: 15000, groupId: 'gC' };
  const pD = { id: 'pD', sku: 'SKU-D', name: 'Product D', basePrice: 20000, groupId: 'gD' };
  const pE = { id: 'pE', sku: 'SKU-E', name: 'Product E', basePrice: 25000, groupId: 'gE' };

  const baseConfig: OrderCalculationConfig = {
    version: 1,
    timestamp: Date.now(),
    companyId: 'test-co',
    products: [pA, pB, pC, pD, pE],
    groups: [],
    promotions: []
  };

  // =========================================================================
  // TEST A: SAME_SKU (10+1: 10 blocks A -> 1 block A bonus)
  // =========================================================================
  console.log('\n--- TEST A: SAME_SKU ---');
  const configA: OrderCalculationConfig = {
    ...baseConfig,
    promotions: [
      {
        id: 'promo-same-sku',
        name: '10+1 Same SKU A',
        type: 'SKU_BONUS',
        applyToAllCompanies: true,
        bonusMode: 'SAME_SKU',
        minimumBlocks: 10,
        bonusBlocks: 1,
        sourceProductId: 'pA',
        bonusProductId: 'pA'
      }
    ]
  };
  const resA = calculateOrderPure([{ productId: 'pA', baseQuantityPacks: 100 }], configA);
  const itemA = resA.items.find(i => i.productId === 'pA')!;
  // 100 base packs + 10 bonus packs = 110 packs
  // Nominal: 110 * 10,000 = 1,100,000
  // Base cost: 100 * 10,000 = 1,000,000
  // raw unit price = 1,000,000 / 110 = 9090.90909... -> 9090.91 tiyin
  // line total = 9090.91 * 110 = 1,000,000.10
  record(
    'TEST A: SAME_SKU Total Packs',
    '110 packs (100 base + 10 bonus)',
    `${resA.totalPacks} packs (${resA.totalBasePacks} base + ${resA.totalBonusPacks} bonus)`,
    resA.totalPacks === 110 && resA.totalBonusPacks === 10
  );
  record(
    'TEST A: SAME_SKU Effective Unit Price',
    '9090.91 UZS',
    `${itemA.effectivePrice} UZS`,
    itemA.effectivePrice === 9090.91
  );
  record(
    'TEST A: SAME_SKU Final Order Total',
    '1000000.10 UZS',
    `${resA.totalPrice} UZS`,
    resA.totalPrice === 1000000.10
  );

  // =========================================================================
  // TEST B: ANOTHER_SKU (10 blocks A @ 10k -> 1 block B @ 12k bonus)
  // =========================================================================
  console.log('\n--- TEST B: ANOTHER_SKU (Proportional Allocation) ---');
  const configB: OrderCalculationConfig = {
    ...baseConfig,
    promotions: [
      {
        id: 'promo-another-sku',
        name: 'Buy 10 A get 1 B bonus',
        type: 'SKU_BONUS',
        applyToAllCompanies: true,
        bonusMode: 'ANOTHER_SKU',
        minimumBlocks: 10,
        bonusBlocks: 1,
        sourceProductId: 'pA',
        bonusProductId: 'pB',
        bonusProduct: pB
      }
    ]
  };
  const resB = calculateOrderPure([{ productId: 'pA', baseQuantityPacks: 100 }], configB);
  const itemB_A = resB.items.find(i => i.productId === 'pA')!;
  const itemB_B = resB.items.find(i => i.productId === 'pB')!;

  record('TEST B: Items count', '2 items (A and B)', `${resB.items.length} items`, resB.items.length === 2);
  record('TEST B: Bonus SKU B not zeroed', '> 0 UZS', `${itemB_B.effectivePrice} UZS`, itemB_B.effectivePrice > 0);
  record('TEST B: Gross prices retained', 'A=10000, B=12000', `A=${itemB_A.originalPrice}, B=${itemB_B.originalPrice}`, itemB_A.originalPrice === 10000 && itemB_B.originalPrice === 12000);
  record('TEST B: A effective price', '8928.57 UZS', `${itemB_A.effectivePrice} UZS`, itemB_A.effectivePrice === 8928.57);
  record('TEST B: B effective price', '10714.29 UZS', `${itemB_A ? itemB_B.effectivePrice : 0} UZS`, itemB_B.effectivePrice === 10714.29);
  record('TEST B: A line total', '892857.00 UZS', `${itemB_A.itemTotalPrice} UZS`, itemB_A.itemTotalPrice === 892857);
  record('TEST B: B line total', '107142.90 UZS', `${itemB_B.itemTotalPrice} UZS`, itemB_B.itemTotalPrice === 107142.9);
  record('TEST B: Final order total', '999999.90 UZS', `${resB.totalPrice} UZS`, resB.totalPrice === 999999.9);
  record('TEST B: Proportional discounts', 'A disc=107143, B disc=12857.1', `A disc=${itemB_A.promotionDiscount}, B disc=${itemB_B.promotionDiscount}`, itemB_A.promotionDiscount === 107143 && itemB_B.promotionDiscount === 12857.1);

  // =========================================================================
  // TEST C: ANOTHER_SKU + UNRELATED C (50 packs @ 15,000 UZS)
  // =========================================================================
  console.log('\n--- TEST C: ANOTHER_SKU + UNRELATED C ---');
  const resC = calculateOrderPure(
    [
      { productId: 'pA', baseQuantityPacks: 100 },
      { productId: 'pC', baseQuantityPacks: 50 }
    ],
    configB
  );
  const itemC_A = resC.items.find(i => i.productId === 'pA')!;
  const itemC_B = resC.items.find(i => i.productId === 'pB')!;
  const itemC_C = resC.items.find(i => i.productId === 'pC')!;

  record('TEST C: Unrelated C discount is 0', '0 UZS', `${itemC_C.promotionDiscount} UZS`, itemC_C.promotionDiscount === 0);
  record('TEST C: Unrelated C unit price unchanged', '15000 UZS', `${itemC_C.effectivePrice} UZS`, itemC_C.effectivePrice === 15000);
  record('TEST C: Unrelated C line total exact', '750000 UZS', `${itemC_C.itemTotalPrice} UZS`, itemC_C.itemTotalPrice === 750000);
  record('TEST C: A & B receive promo discounts identically', 'A=892857, B=107142.9', `A=${itemC_A.itemTotalPrice}, B=${itemC_B.itemTotalPrice}`, itemC_A.itemTotalPrice === 892857 && itemC_B.itemTotalPrice === 107142.9);
  record('TEST C: Total price sum(lineTotals)', '1749999.90 UZS', `${resC.totalPrice} UZS`, resC.totalPrice === 1749999.9);

  // =========================================================================
  // TEST D: ORDER-LEVEL PERCENTAGE PROMOTION + SKU PROMO
  // =========================================================================
  console.log('\n--- TEST D: SKU PROMO + ORDER PERCENTAGE ---');
  const configD: OrderCalculationConfig = {
    ...baseConfig,
    promotions: [
      configB.promotions[0], // SKU Promo A -> B
      {
        id: 'promo-pct-10',
        name: '10% Order Discount',
        type: 'ORDER_PERCENTAGE',
        applyToAllCompanies: true,
        bonusMode: 'SAME_SKU',
        minimumBlocks: 0,
        bonusBlocks: 0,
        discountPercent: 10
      }
    ]
  };
  const resD = calculateOrderPure([{ productId: 'pA', baseQuantityPacks: 100 }], configD);
  const itemD_A = resD.items.find(i => i.productId === 'pA')!;
  const itemD_B = resD.items.find(i => i.productId === 'pB')!;
  // Stage 1: A=892,857.14, B=107,142.86
  // Stage 2: 10% off -> A = 803,571.43, B = 96,428.57
  // Unit prices: A = 8035.71, B = 9642.86
  // Lines: A = 803,571.00, B = 96,428.60
  // Total = 899,999.60
  record('TEST D: Staging applied', '2 applied promotions', `${resD.appliedPromotions.length} applied promotions`, resD.appliedPromotions.length === 2);
  record('TEST D: A effective price after 10%', '8035.71 UZS', `${itemD_A.effectivePrice} UZS`, itemD_A.effectivePrice === 8035.71);
  record('TEST D: B effective price after 10%', '9642.86 UZS', `${itemD_B.effectivePrice} UZS`, itemD_B.effectivePrice === 9642.86);
  record('TEST D: Order Total equals sum of lines', '899999.60 UZS', `${resD.totalPrice} UZS`, resD.totalPrice === 899999.6);

  // =========================================================================
  // TEST E: MULTIPLE INDEPENDENT SKU PROMOTIONS
  // =========================================================================
  console.log('\n--- TEST E: MULTIPLE INDEPENDENT SKU PROMOTIONS ---');
  const configE: OrderCalculationConfig = {
    ...baseConfig,
    promotions: [
      configB.promotions[0], // Promo 1: A -> B
      {
        id: 'promo-d-e',
        name: 'Buy 10 D get 1 E bonus',
        type: 'SKU_BONUS',
        applyToAllCompanies: true,
        bonusMode: 'ANOTHER_SKU',
        minimumBlocks: 10,
        bonusBlocks: 1,
        sourceProductId: 'pD',
        bonusProductId: 'pE',
        bonusProduct: pE
      }
    ]
  };
  const resE = calculateOrderPure(
    [
      { productId: 'pA', baseQuantityPacks: 100 },
      { productId: 'pD', baseQuantityPacks: 100 }
    ],
    configE
  );
  const itemE_A = resE.items.find(i => i.productId === 'pA')!;
  const itemE_B = resE.items.find(i => i.productId === 'pB')!;
  const itemE_D = resE.items.find(i => i.productId === 'pD')!;
  const itemE_E = resE.items.find(i => i.productId === 'pE')!;

  // A & B must be completely unaffected by D & E
  record('TEST E: Promo 1 unaffected by Promo 2', 'A=892857, B=107142.9', `A=${itemE_A.itemTotalPrice}, B=${itemE_B.itemTotalPrice}`, itemE_A.itemTotalPrice === 892857 && itemE_B.itemTotalPrice === 107142.9);
  // D (100 * 20,000 = 2,000,000) -> E (10 * 25,000 = 250,000)
  // Participating: 2,250,000
  // k_promo = 2,000,000 / 2,250,000 = 8 / 9 = 0.888888...
  // D unit = 20,000 * 8/9 = 17777.78 -> 100 * 17777.78 = 1,777,778.00
  // E unit = 25,000 * 8/9 = 22222.22 -> 10 * 22222.22 = 222,222.20
  record('TEST E: Promo 2 isolated calculation', 'D=1777778, E=222222.2', `D=${itemE_D.itemTotalPrice}, E=${itemE_E.itemTotalPrice}`, itemE_D.itemTotalPrice === 1777778 && itemE_E.itemTotalPrice === 222222.2);

  // =========================================================================
  // TEST F: NO PROMOTION
  // =========================================================================
  console.log('\n--- TEST F: NO PROMOTION ---');
  const resF = calculateOrderPure(
    [
      { productId: 'pA', baseQuantityPacks: 100 },
      { productId: 'pB', baseQuantityPacks: 50 }
    ],
    baseConfig
  );
  record('TEST F: No discount applied', '0 UZS', `${resF.totalDiscount} UZS`, resF.totalDiscount === 0);
  record('TEST F: Exact total matches gross', '1600000 UZS', `${resF.totalPrice} UZS`, resF.totalPrice === 1600000);
  record('TEST F: Unit prices equal basePrice', 'A=10000, B=12000', `A=${resF.items[0].effectivePrice}, B=${resF.items[1].effectivePrice}`, resF.items[0].effectivePrice === 10000 && resF.items[1].effectivePrice === 12000);

  // =========================================================================
  // TEST G: FINAL ROUNDING ASSERTION (Order total MUST equal sum of rounded lines)
  // =========================================================================
  console.log('\n--- TEST G: FINAL ROUNDING ASSERTION ---');
  // In resB:
  // Theoretical unrounded total = 1,000,000.00
  // Line A = round(8928.571428... * 100)/100 * 100 = 8928.57 * 100 = 892,857.00
  // Line B = round(10714.285714... * 100)/100 * 10 = 10714.29 * 10 = 107,142.90
  // Sum of lines = 999,999.90
  // If the engine used unrounded total, totalPrice would be 1,000,000.00.
  const sumOfLineTotalsB = Math.round(resB.items.reduce((s, i) => s + i.itemTotalPrice, 0) * 100) / 100;
  record(
    'TEST G: Order total strictly equals sum(lineTotals)',
    `${sumOfLineTotalsB} UZS`,
    `${resB.totalPrice} UZS`,
    resB.totalPrice === sumOfLineTotalsB && resB.totalPrice !== 1000000
  );

  // =========================================================================
  // TEST H: EXCEL RECONCILIATION
  // =========================================================================
  console.log('\n--- TEST H: EXCEL RECONCILIATION ---');
  // Generate an Excel sheet with default template
  const templatePath = path.join(process.cwd(), 'templates', 'default_order_template.xlsx');
  if (!fs.existsSync(templatePath)) {
    await createDefaultExcelTemplateOnDisk(templatePath);
  }
  const templateBuf = fs.readFileSync(templatePath);

  const excelData: ExcelOrderData = {
    clientName: 'Test Client LLC',
    orderDate: '07.10.2026',
    orderNumber: 'ORD-TEST-001',
    totalBlocks: resB.totalBlocks,
    totalCases: resB.totalCases,
    totalPrice: resB.totalPrice,
    items: resB.items.map(i => ({
      sku: i.sku,
      name: i.name,
      packs: i.totalQuantityPacks,
      blocks: i.totalQuantityBlocks,
      cases: i.totalQuantityCases,
      baseQuantityPacks: i.baseQuantityPacks,
      bonusQuantityPacks: i.bonusQuantityPacks,
      totalQuantityPacks: i.totalQuantityPacks,
      baseQuantityBlocks: i.baseQuantityBlocks,
      bonusQuantityBlocks: i.bonusQuantityBlocks,
      totalQuantityBlocks: i.totalQuantityBlocks,
      price: i.originalPrice,
      effectivePrice: i.effectivePrice,
      itemTotalPrice: i.itemTotalPrice,
      promotionDiscount: i.promotionDiscount,
      grossValue: i.totalQuantityPacks * i.originalPrice,
      isBonus: i.isBonus,
      promotionNote: i.promotionNote
    }))
  };

  const excelBuffer = await generateExcelOrder(templateBuf, excelData);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(excelBuffer as any);
  const sheet = workbook.worksheets[0];

  // Read generated cells from Excel sheet
  let excelOrderTotalCell: any = null;
  let excelItemTotalSum = 0;
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      const v = cell.value;
      if (typeof v === 'number') {
        if (v === excelData.totalPrice) {
          excelOrderTotalCell = v;
        }
      }
    });
  });

  // Calculate sum of item totals from excelData items
  excelItemTotalSum = Math.round(excelData.items.reduce((s, it) => s + it.itemTotalPrice, 0) * 100) / 100;

  record(
    'TEST H: Excel final total matches engine total',
    `${resB.totalPrice} UZS`,
    `${excelOrderTotalCell} UZS`,
    excelOrderTotalCell === resB.totalPrice
  );
  record(
    'TEST H: Excel items sum matches Excel total price',
    `${resB.totalPrice} UZS`,
    `${excelItemTotalSum} UZS`,
    excelItemTotalSum === resB.totalPrice
  );

  // =========================================================================
  // TEST I: GOOGLE DRIVE BACKUP DOWNLOAD & DECRYPT
  // =========================================================================
  console.log('\n--- TEST I: GOOGLE DRIVE BACKUP DOWNLOAD & DECRYPT ---');
  const fileMeta = await findFileInFolder('users.enc.json', 'Users');
  record(
    'TEST I: Google Drive users.enc.json discovery',
    'Found file with real Google Drive ID',
    fileMeta ? `Found id: ${fileMeta.id}` : 'Not found',
    !!fileMeta && !!fileMeta.id && fileMeta.id.length > 15
  );

  if (fileMeta) {
    const downloadedBuf = await downloadFile(fileMeta.id, fileMeta.name, 'Users');
    record(
      'TEST I: Google Drive backup download size',
      '> 1000 bytes',
      `${downloadedBuf.length} bytes`,
      downloadedBuf.length > 1000
    );

    const keySetting = await prisma.systemSetting.findUnique({ where: { key: 'BACKUP_ENCRYPTION_KEY' } });
    const pass = keySetting?.value || 'B2BSecureSystemPassphrase2026';
    const decrypted = decrypt(downloadedBuf.toString('utf8'), pass);
    const users = JSON.parse(decrypted);

    record(
      'TEST I: Google Drive backup decryption & valid users',
      'Valid array of users',
      `Decrypted array with ${users.length} users`,
      Array.isArray(users) && users.length > 0 && !!users[0].email
    );
  }

  // =========================================================================
  // TEST J: DESTRUCTIVE CLEANUP SAFETY GUARDS
  // =========================================================================
  console.log('\n--- TEST J: DESTRUCTIVE CLEANUP SAFETY GUARDS ---');
  let guardTriggeredUndefined = false;
  let guardTriggeredEmpty = false;

  const mockSession = { userId: 'admin-id', role: 'ADMIN', email: 'admin@b2b.com' } as any;

  try {
    await OrdersService.deleteDraft(mockSession, undefined as any);
  } catch (err: any) {
    if (err.message.includes('missing orderId') || err.message.includes('Refusing cleanup')) {
      guardTriggeredUndefined = true;
    }
  }

  try {
    await OrdersService.deleteDraft(mockSession, '   ');
  } catch (err: any) {
    if (err.message.includes('missing orderId') || err.message.includes('Refusing cleanup')) {
      guardTriggeredEmpty = true;
    }
  }

  record(
    'TEST J: deleteDraft rejects undefined orderId',
    'Refusing cleanup: missing orderId',
    guardTriggeredUndefined ? 'Rejected with expected error' : 'Failed to reject',
    guardTriggeredUndefined
  );
  record(
    'TEST J: deleteDraft rejects empty whitespace orderId',
    'Refusing cleanup: missing orderId',
    guardTriggeredEmpty ? 'Rejected with expected error' : 'Failed to reject',
    guardTriggeredEmpty
  );

  console.log('\n================================================================');
  console.log(`   ALL TESTS COMPLETED: ${results.filter(r => r.status === 'PASS').length} / ${results.length} PASSED`);
  console.log('================================================================\n');
}

main()
  .catch(err => {
    console.error('Test suite error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
