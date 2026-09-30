import { ProductGroupService } from '../src/lib/product-groups/product-groups.service';
import { localizeError } from '../src/i18n';

async function main() {
  console.log('--- RUNNING TEST: GROUPED SKUS & STOCK ---');

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

  // TEST 1: SKU-A = 10, SKU-B = 100. Single group position = 15 packs.
  // Expected: SKU-A = 10, SKU-B = 5.
  try {
    const skus1 = [
      { id: 'sku-a', sku: 'SKU-A', name: 'Product A', stockPacks: 10, priority: 1, isActive: true },
      { id: 'sku-b', sku: 'SKU-B', name: 'Product B', stockPacks: 100, priority: 2, isActive: true },
    ];
    const allocs1 = ProductGroupService.allocatePacks(skus1, 15);
    assert(allocs1.length === 2, 'Test 1: allocs count is 2');
    assert(allocs1[0].sku === 'SKU-A' && allocs1[0].packs === 10, 'Test 1: SKU-A allocated 10 packs');
    assert(allocs1[1].sku === 'SKU-B' && allocs1[1].packs === 5, 'Test 1: SKU-B allocated 5 packs');
  } catch (err: any) {
    assert(false, `Test 1 failed with error: ${err.message}`);
  }

  // TEST 2: SKU-A = 0, SKU-B = 100. Order = 20 packs.
  // Expected: SKU-A = 0, SKU-B = 20.
  try {
    const skus2 = [
      { id: 'sku-a', sku: 'SKU-A', name: 'Product A', stockPacks: 0, priority: 1, isActive: true },
      { id: 'sku-b', sku: 'SKU-B', name: 'Product B', stockPacks: 100, priority: 2, isActive: true },
    ];
    const allocs2 = ProductGroupService.allocatePacks(skus2, 20);
    assert(allocs2.length === 1, 'Test 2: allocs count is 1 (SKU-A skipped)');
    assert(allocs2[0].sku === 'SKU-B' && allocs2[0].packs === 20, 'Test 2: SKU-B allocated 20 packs');
  } catch (err: any) {
    assert(false, `Test 2 failed with error: ${err.message}`);
  }

  // TEST 3: Two lines of the same ProductGroup within one order.
  // SKU-A = 10, SKU-B = 100.
  // Line 1 = 10 packs -> SKU-A = 10
  // Line 2 = 20 packs -> SKU-B = 20 (SKU-A cannot be reused!)
  try {
    const rawSkus = [
      { id: 'sku-a', sku: 'SKU-A', name: 'Product A', stockPacks: 10, priority: 1, isActive: true },
      { id: 'sku-b', sku: 'SKU-B', name: 'Product B', stockPacks: 100, priority: 2, isActive: true },
    ];

    const stockTracker = new Map<string, number>();

    // Line 1: 10 packs
    const availableSkusLine1 = rawSkus.map(s => ({
      ...s,
      stockPacks: Math.max(0, s.stockPacks - (stockTracker.get(s.id) || 0))
    }));
    const allocsLine1 = ProductGroupService.allocatePacks(availableSkusLine1, 10);
    for (const a of allocsLine1) {
      stockTracker.set(a.productId, (stockTracker.get(a.productId) || 0) + a.packs);
    }

    assert(allocsLine1.length === 1 && allocsLine1[0].sku === 'SKU-A' && allocsLine1[0].packs === 10, 'Test 3 Line 1: SKU-A allocated 10');

    // Line 2: 20 packs
    const availableSkusLine2 = rawSkus.map(s => ({
      ...s,
      stockPacks: Math.max(0, s.stockPacks - (stockTracker.get(s.id) || 0))
    }));
    const allocsLine2 = ProductGroupService.allocatePacks(availableSkusLine2, 20);
    for (const a of allocsLine2) {
      stockTracker.set(a.productId, (stockTracker.get(a.productId) || 0) + a.packs);
    }

    assert(allocsLine2.length === 1 && allocsLine2[0].sku === 'SKU-B' && allocsLine2[0].packs === 20, 'Test 3 Line 2: SKU-B allocated 20 (SKU-A was not reused)');
    assert(stockTracker.get('sku-a') === 10, 'Test 3: stockTracker SKU-A total = 10');
    assert(stockTracker.get('sku-b') === 20, 'Test 3: stockTracker SKU-B total = 20');
  } catch (err: any) {
    assert(false, `Test 3 failed with error: ${err.message}`);
  }

  // TEST 4: Real stock error produces regular stock error, NOT bonus stock error in i18n
  try {
    const regularErrorMsg = 'Превышен доступный лимит запасов для позиции: Winston Blue. Пожалуйста, обновите страницу и проверьте остатки.';
    const localizedRu = localizeError(regularErrorMsg, 'ru');
    assert(!localizedRu.includes('бонусной'), 'Test 4 RU: Regular error does NOT contain "бонусной"');
    assert(localizedRu.includes('Winston Blue'), 'Test 4 RU: Regular error contains product name');
    assert(localizedRu.includes('Недостаточно остатка для позиции'), 'Test 4 RU: Translated to stockInsufficient');

    const localizedEn = localizeError(regularErrorMsg, 'en');
    assert(!localizedEn.toLowerCase().includes('bonus'), 'Test 4 EN: Regular error does NOT contain "bonus"');
    assert(localizedEn.includes('Insufficient stock for item: Winston Blue.'), 'Test 4 EN: Translated to stockInsufficient in English');

    const localizedUz = localizeError(regularErrorMsg, 'uz');
    assert(!localizedUz.toLowerCase().includes('bonus'), 'Test 4 UZ: Regular error does NOT contain "bonus"');
    assert(localizedUz.includes('Mahsulot qoldig‘i yetarli emas: Winston Blue.'), 'Test 4 UZ: Translated to stockInsufficient in Uzbek');
  } catch (err: any) {
    assert(false, `Test 4 failed with error: ${err.message}`);
  }

  // TEST 5: Bonus stock error correctly produces bonusStockInsufficient
  try {
    const bonusErrorMsg = 'Превышен доступный лимит запасов для бонусной позиции: Sobranie Gold. Пожалуйста, уменьшите объем заказа.';
    const localizedRu = localizeError(bonusErrorMsg, 'ru');
    assert(localizedRu.includes('бонусной позиции'), 'Test 5 RU: Bonus error contains "бонусной позиции"');
    assert(localizedRu.includes('Sobranie Gold'), 'Test 5 RU: Bonus error contains product name');

    const localizedEn = localizeError(bonusErrorMsg, 'en');
    assert(localizedEn.toLowerCase().includes('bonus item: sobranie gold'), 'Test 5 EN: Bonus error in English');

    const localizedUz = localizeError(bonusErrorMsg, 'uz');
    assert(localizedUz.toLowerCase().includes('bonus mahsulot qoldig‘i'), 'Test 5 UZ: Bonus error in Uzbek');
  } catch (err: any) {
    assert(false, `Test 5 failed with error: ${err.message}`);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
