import { calculateOrderPure } from '../src/lib/calculation/engine';
import { OrderCalculationConfig } from '../src/lib/calculation/types';

async function main() {
  console.log('=== STARTING UNIT TESTS: PURE CALCULATION ENGINE ===');

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

  // Base test products & groups
  const testConfig: OrderCalculationConfig = {
    version: 1,
    timestamp: Date.now(),
    companyId: 'test-co',
    products: [
      { id: 'p1', sku: 'SKU-A', name: 'Product A', basePrice: 10000, groupId: 'g1' },
      { id: 'p2', sku: 'SKU-B', name: 'Product B', basePrice: 15000, groupId: 'g2' },
      { id: 'p3', sku: 'SKU-GIFT', name: 'Gift Product', basePrice: 8000, groupId: 'g3' },
    ],
    groups: [
      {
        id: 'g1',
        displayName: 'Group A',
        skus: [{ id: 'p1', sku: 'SKU-A', name: 'Product A', basePrice: 10000, groupId: 'g1', priority: 0 }]
      },
      {
        id: 'g2',
        displayName: 'Group B',
        skus: [{ id: 'p2', sku: 'SKU-B', name: 'Product B', basePrice: 15000, groupId: 'g2', priority: 0 }]
      },
      {
        id: 'g3',
        displayName: 'Group Gift',
        skus: [{ id: 'p3', sku: 'SKU-GIFT', name: 'Gift Product', basePrice: 8000, groupId: 'g3', priority: 0 }]
      }
    ],
    promotions: []
  };

  // Test 1: Plain order without promotions
  console.log('\n[Test 1] Plain order without promotions');
  const res1 = calculateOrderPure(
    [{ productId: 'p1', baseQuantityPacks: 100 }], // 10 blocks of p1
    testConfig
  );
  assert(res1.totalPacks === 100, 'res1 totalPacks === 100');
  assert(res1.totalBonusPacks === 0, 'res1 totalBonusPacks === 0');
  assert(res1.subtotalPrice === 1000000, 'res1 subtotalPrice === 1,000,000');
  assert(res1.totalPrice === 1000000, 'res1 totalPrice === 1,000,000');
  assert(res1.items[0].effectivePrice === 10000, 'res1 effectivePrice === 10,000');

  // Test 2: SKU Bonus (SAME_SKU: 50 blocks -> 5 blocks bonus)
  console.log('\n[Test 2] Same SKU bonus (10+1 / 50+5)');
  const config2: OrderCalculationConfig = {
    ...testConfig,
    promotions: [
      {
        id: 'promo-same-sku',
        name: '50+5 Same SKU',
        type: 'SKU_BONUS',
        applyToAllCompanies: true,
        bonusMode: 'SAME_SKU',
        minimumBlocks: 50,
        bonusBlocks: 5,
        sourceProductId: 'p1',
        bonusProductId: 'p1'
      }
    ]
  };
  const res2 = calculateOrderPure(
    [{ productId: 'p1', baseQuantityPacks: 500 }], // 50 blocks
    config2
  );
  assert(res2.totalBasePacks === 500, 'res2 totalBasePacks === 500');
  assert(res2.totalBonusPacks === 50, 'res2 totalBonusPacks === 50');
  assert(res2.totalPacks === 550, 'res2 totalPacks === 550');
  // Cost redistribution: user pays for 500 packs = 5,000,000 so'm across 550 packs
  // effectivePrice = 5,000,000 / 550 = 9090.909 -> 9090.91 tiyin
  assert(res2.items[0].effectivePrice === 9090.91, `res2 effectivePrice === 9090.91 (got ${res2.items[0].effectivePrice})`);
  assert(res2.totalPrice === 5000000.5, `res2 totalPrice tiyin rounded === 5000000.5 (got ${res2.totalPrice})`);
  assert(res2.appliedPromotions.length === 1, 'res2 appliedPromotions count === 1');

  // Test 3: Another SKU bonus
  console.log('\n[Test 3] Another SKU bonus (p1 -> p3 bonus)');
  const config3: OrderCalculationConfig = {
    ...testConfig,
    promotions: [
      {
        id: 'promo-another-sku',
        name: 'Buy A get Gift',
        type: 'SKU_BONUS',
        applyToAllCompanies: true,
        bonusMode: 'ANOTHER_SKU',
        minimumBlocks: 50,
        bonusBlocks: 5,
        sourceProductId: 'p1',
        bonusProductId: 'p3',
        bonusProduct: { id: 'p3', sku: 'SKU-GIFT', name: 'Gift Product', basePrice: 8000, groupId: 'g3' }
      }
    ]
  };
  const res3 = calculateOrderPure(
    [{ productId: 'p1', baseQuantityPacks: 500 }],
    config3
  );
  assert(res3.items.length === 2, 'res3 items count === 2 (p1 and p3)');
  const giftItem = res3.items.find(i => i.productId === 'p3');
  assert(giftItem !== undefined, 'res3 giftItem exists');
  assert(giftItem?.bonusQuantityPacks === 50, 'res3 giftItem bonusQuantityPacks === 50');
  assert(giftItem?.isBonus === true, 'res3 giftItem isBonus === true');

  // Test 4: Order Percentage Discount (5%)
  console.log('\n[Test 4] Order percentage discount (5%)');
  const config4: OrderCalculationConfig = {
    ...testConfig,
    promotions: [
      {
        id: 'promo-pct',
        name: '5% Off',
        type: 'ORDER_PERCENTAGE',
        applyToAllCompanies: true,
        bonusMode: 'SAME_SKU',
        minimumBlocks: 0,
        bonusBlocks: 0,
        discountPercent: 5
      }
    ]
  };
  const res4 = calculateOrderPure(
    [{ productId: 'p1', baseQuantityPacks: 100 }], // 1,000,000 so'm
    config4
  );
  // 1,000,000 * 0.95 = 950,000 so'm
  assert(res4.totalPrice === 950000, `res4 totalPrice === 950,000 (got ${res4.totalPrice})`);
  assert(res4.totalDiscount === 50000, `res4 totalDiscount === 50,000 (got ${res4.totalDiscount})`);

  // Test 5: Order Fixed Amount Discount with 10% maxOrderUsagePercent cap
  console.log('\n[Test 5] Order fixed amount discount with 10% cap');
  const config5: OrderCalculationConfig = {
    ...testConfig,
    promotions: [
      {
        id: 'promo-fixed',
        name: 'Budget 200,000',
        type: 'ORDER_FIXED_AMOUNT',
        applyToAllCompanies: true,
        bonusMode: 'SAME_SKU',
        minimumBlocks: 0,
        bonusBlocks: 0,
        remainingAmount: 200000,
        maxOrderUsagePercent: 10.0
      }
    ]
  };
  // Order of 1,000,000 so'm. 10% cap = 100,000 so'm maximum usable!
  const res5 = calculateOrderPure(
    [{ productId: 'p1', baseQuantityPacks: 100 }],
    config5
  );
  assert(res5.totalPrice === 900000, `res5 totalPrice === 900,000 (got ${res5.totalPrice})`);
  assert(res5.fixedAmountDeductions[0]?.amount === 100000, `res5 fixed deduction === 100,000 (got ${res5.fixedAmountDeductions[0]?.amount})`);

  // Test 6: Multi-stage simultaneous promotions (SKU bonus + 5% + Fixed amount)
  console.log('\n[Test 6] Multi-stage promotions pipeline');
  const config6: OrderCalculationConfig = {
    ...testConfig,
    promotions: [
      config2.promotions[0],
      config4.promotions[0],
      config5.promotions[0]
    ]
  };
  const res6 = calculateOrderPure(
    [{ productId: 'p1', baseQuantityPacks: 500 }],
    config6
  );
  assert(res6.appliedPromotions.length === 3, 'res6 appliedPromotions length === 3');
  assert(res6.totalPacks === 550, 'res6 totalPacks === 550');
  assert(res6.totalPrice < 5000000, 'res6 final price reflects all stages');

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
