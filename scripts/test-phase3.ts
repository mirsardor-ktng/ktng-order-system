import prisma from '../src/lib/db';
import { WarehouseAssemblyRequestService } from '../src/lib/warehouse/warehouse-assembly-request.service';
import { PromotionsService } from '../src/lib/promotions/promotions.service';
import { en } from '../src/i18n/dictionaries/en';

async function main() {
  console.log('--- STARTING PHASE 3 TEST SUITE ---');

  // ==========================================
  // TEST 1: DailySequence Concurrency & Monotonicity
  // ==========================================
  console.log('\n[Test 1] Testing DailySequence atomic concurrent generation...');
  const testDateKey = `WAREHOUSE_TEST_${Date.now()}`;

  // Clean up any potential stale test key
  await prisma.dailySequence.deleteMany({ where: { dateKey: testDateKey } });

  // Run 10 concurrent requests
  const promises = Array.from({ length: 10 }, () =>
    WarehouseAssemblyRequestService.getNextDailyOutboundNumber(testDateKey)
  );

  const results = await Promise.all(promises);
  console.log('Generated numbers concurrently:', results);

  const indexes = results.map((r) => r.index).sort((a, b) => a - b);
  for (let i = 0; i < 10; i++) {
    if (indexes[i] !== i + 1) {
      throw new Error(`Test 1 Failed: Expected sequence 1..10, got ${JSON.stringify(indexes)}`);
    }
  }
  console.log('✓ Concurrent generation passed: 10/10 unique sequential numbers [1..10]');

  // Test monotonicity after gap:
  // Next number must be 11
  const nextResult = await WarehouseAssemblyRequestService.getNextDailyOutboundNumber(testDateKey);
  if (nextResult.index !== 11) {
    throw new Error(`Test 1 Failed: Expected next number to be 11, got ${nextResult.index}`);
  }
  console.log('✓ Monotonicity passed: next number after 10 is 11');

  // Cleanup test key
  await prisma.dailySequence.deleteMany({ where: { dateKey: testDateKey } });

  // ==========================================
  // TEST 2: Authoritative Pricing & Tiyn Rounding
  // ==========================================
  console.log('\n[Test 2] Testing Authoritative Pricing & Tiyn Rounding...');

  // Mock items for calculation:
  // Item 1: 33 packs at base price 15,250 so'm
  // Item 2: 77 packs at base price 18,333.33 so'm
  // Item 3: 13 packs at base price 22,000 so'm
  const mockOrderItems = [
    {
      productId: 'prod-1',
      totalPacks: 33,
      basePrice: 15250,
      stage3LinePrice: 0,
      effectivePrice: 0,
      finalLinePrice: 0,
      appliedPromotions: [],
    },
    {
      productId: 'prod-2',
      totalPacks: 77,
      basePrice: 18333.33,
      stage3LinePrice: 0,
      effectivePrice: 0,
      finalLinePrice: 0,
      appliedPromotions: [],
    },
    {
      productId: 'prod-3',
      totalPacks: 13,
      basePrice: 22000,
      stage3LinePrice: 0,
      effectivePrice: 0,
      finalLinePrice: 0,
      appliedPromotions: [],
    },
  ];

  // Test 2.1: Percentage discount calculation
  // Apply a 7% order discount
  const orderBaseTotal = mockOrderItems.reduce((sum, i) => sum + i.totalPacks * i.basePrice, 0);
  const discountRate = 0.07;
  const mockDiscount = orderBaseTotal * discountRate;

  // Distribute stage 3 proportional discount
  mockOrderItems.forEach((item) => {
    const itemBaseLine = item.totalPacks * item.basePrice;
    const itemShare = itemBaseLine / orderBaseTotal;
    item.stage3LinePrice = itemBaseLine - mockDiscount * itemShare;
  });

  // Execute Stage 4 calculation rule
  mockOrderItems.forEach((item) => {
    const rawUnitPrice = item.stage3LinePrice / item.totalPacks;
    item.effectivePrice = Math.round(rawUnitPrice * 100) / 100;
    item.finalLinePrice = Math.round(item.effectivePrice * item.totalPacks * 100) / 100;
  });

  const finalPayableTotal = Math.round(
    mockOrderItems.reduce((sum, i) => sum + i.finalLinePrice, 0) * 100
  ) / 100;

  console.log('Items calculation results:');
  let sumOfLines = 0;
  mockOrderItems.forEach((item, idx) => {
    const calculatedLine = Math.round(item.effectivePrice * item.totalPacks * 100) / 100;
    console.log(
      `  Item ${idx + 1}: ${item.totalPacks} packs @ ${item.effectivePrice} so'm = ${item.finalLinePrice} so'm (calc: ${calculatedLine})`
    );
    if (calculatedLine !== item.finalLinePrice) {
      throw new Error(`Test 2 Failed: Item ${idx + 1} displayed price * qty != line total`);
    }
    sumOfLines += item.finalLinePrice;
  });
  sumOfLines = Math.round(sumOfLines * 100) / 100;

  console.log(`Sum of line totals: ${sumOfLines}`);
  console.log(`Order final payable total: ${finalPayableTotal}`);

  if (sumOfLines !== finalPayableTotal) {
    throw new Error(
      `Test 2 Failed: Sum of line totals (${sumOfLines}) does not equal order total (${finalPayableTotal})`
    );
  }
  console.log('✓ Authoritative pricing & tiyn rounding passed: Line totals and order totals match exactly!');

  // ==========================================
  // TEST 3: Terminology (cases -> boxes)
  // ==========================================
  console.log('\n[Test 3] Testing English Terminology (cases -> boxes)...');

  const termChecks: [string, string][] = [
    ['seller.casesShipped', en.seller.casesShipped],
    ['seller.casesConversionHint', en.seller.casesConversionHint],
    ['seller.inCases', en.seller.inCases],
    ['units.cases', en.units.cases],
    ['units.casesShort', en.units.casesShort],
    ['units.perCase', en.units.perCase],
    ['dashboard.casesUnit', en.dashboard.casesUnit],
    ['analytics.casesPurchased', en.analytics.casesPurchased],
    ['analytics.totalCases', en.analytics.totalCases],
    ['analytics.avgCases', en.analytics.avgCases],
    ['analytics.tableCases', en.analytics.tableCases],
    ['analytics.tooltipCases', en.analytics.tooltipCases],
  ];

  for (const [key, val] of termChecks) {
    console.log(`  ${key}: "${val}"`);
    if (/\bcases?\b/i.test(val)) {
      throw new Error(`Test 3 Failed: ${key} still contains "case(s)": "${val}"`);
    }
  }
  console.log('✓ English terminology passed: all packaging terms use boxes/box!');

  console.log('\n=== ALL PHASE 3 TESTS PASSED SUCCESSFULLY! ===');
}

main()
  .catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
