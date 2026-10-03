import {
  CalculationInputItem,
  OrderCalculationConfig,
  CalculatedOrder,
  CalculatedOrderItem,
  AppliedPromotionInfo,
  ConfigPromotion
} from './types';

/**
 * Pure, deterministic order calculation engine.
 * Independent from Prisma, React, HTTP, or any database connection.
 * Can execute identically in browser (client-side) or Node.js (server-side).
 */
export function calculateOrderPure(
  inputItems: CalculationInputItem[],
  config: OrderCalculationConfig
): CalculatedOrder {
  const productMap = new Map(config.products.map(p => [p.id, p]));
  const groupMap = new Map(config.groups.map(g => [g.id, g]));

  // Filter applicable promotions for this order
  const promotions = config.promotions;
  const skuPromos = promotions.filter(p => !p.type || p.type === 'SKU_BONUS');
  const percentagePromos = promotions.filter(
    p => p.type === 'ORDER_PERCENTAGE' && p.discountPercent && p.discountPercent > 0
  );
  const fixedAmountPromos = promotions.filter(
    p => p.type === 'ORDER_FIXED_AMOUNT' && (p.remainingAmount === null || (p.remainingAmount !== null && p.remainingAmount > 0))
  );

  // Initialize item map with base user inputs ONLY
  const itemMap = new Map<string, {
    productId: string;
    sku: string;
    name: string;
    groupId?: string;
    groupDisplayName?: string;
    basePacks: number;
    bonusPacks: number;
    price: number;
    promotionId?: string;
    promotionNotes: string[];
  }>();

  for (const item of inputItems) {
    const basePacks = Math.max(0, parseInt(String(item.baseQuantityPacks)) || 0);
    if (basePacks <= 0) continue;

    const targetGroupId = item.groupId || (groupMap.has(item.productId) ? item.productId : undefined);
    const matchedGroup = targetGroupId ? groupMap.get(targetGroupId) : undefined;
    const primarySku = matchedGroup?.skus?.[0];

    const product = productMap.get(item.productId) || primarySku;
    const sku = item.sku || product?.sku || primarySku?.sku || '';
    const name = item.name || matchedGroup?.displayName || product?.name || '';
    const price = item.price ?? product?.basePrice ?? primarySku?.basePrice ?? 0;
    const finalGroupId = targetGroupId || (product as any)?.groupId || undefined;
    const finalGroupDisplayName = item.groupDisplayName || matchedGroup?.displayName || undefined;

    itemMap.set(item.productId, {
      productId: item.productId,
      sku,
      name,
      groupId: finalGroupId,
      groupDisplayName: finalGroupDisplayName,
      basePacks,
      bonusPacks: 0,
      price,
      promotionNotes: []
    });
  }

  const appliedPromotions: AppliedPromotionInfo[] = [];

  // ==========================================
  // STAGE 1: SKU Promotions (10+1, 5+2, etc.)
  // ==========================================
  for (const promo of skuPromos) {
    let sourceBasePacks = 0;
    let primarySourceItem: (ReturnType<typeof itemMap.get> extends infer V ? (V extends undefined ? never : V) : never) = null as any;

    if (promo.sourceGroupId) {
      itemMap.forEach(item => {
        if (item.groupId === promo.sourceGroupId) {
          sourceBasePacks += item.basePacks;
          if (!primarySourceItem) primarySourceItem = item;
        }
      });
    } else if (promo.sourceProductId) {
      const item = itemMap.get(promo.sourceProductId);
      if (item) {
        sourceBasePacks = item.basePacks;
        primarySourceItem = item;
      }
    }

    if (!primarySourceItem || sourceBasePacks <= 0) continue;

    const sourceBaseBlocks = Math.floor(sourceBasePacks / 10);
    if (sourceBaseBlocks < promo.minimumBlocks) continue;

    const multiplier = Math.floor(sourceBaseBlocks / promo.minimumBlocks);
    const bonusBlocksTotal = multiplier * promo.bonusBlocks;
    const bonusPacksTotal = bonusBlocksTotal * 10;

    if (bonusPacksTotal <= 0) continue;

    const note = `Акция "${promo.name}": +${bonusBlocksTotal} бл. бонус`;

    if (promo.bonusMode === 'SAME_SKU' || !promo.bonusProductId || promo.bonusProductId === promo.sourceProductId) {
      primarySourceItem.bonusPacks += bonusPacksTotal;
      if (!primarySourceItem.promotionId) primarySourceItem.promotionId = promo.id;
      primarySourceItem.promotionNotes.push(note);
    } else {
      let bonusProductItem = itemMap.get(promo.bonusProductId);
      if (!bonusProductItem) {
        const bonusProd = promo.bonusProduct || (promo.bonusProductId ? productMap.get(promo.bonusProductId) : null);
        if (bonusProd) {
          bonusProductItem = {
            productId: bonusProd.id,
            sku: bonusProd.sku,
            name: bonusProd.name,
            groupId: bonusProd.groupId || undefined,
            groupDisplayName: undefined,
            basePacks: 0,
            bonusPacks: 0,
            price: bonusProd.basePrice,
            promotionId: promo.id,
            promotionNotes: []
          };
          itemMap.set(bonusProd.id, bonusProductItem);
        }
      }

      if (bonusProductItem) {
        bonusProductItem.bonusPacks += bonusPacksTotal;
        if (!bonusProductItem.promotionId) bonusProductItem.promotionId = promo.id;
        const anotherNote = `Бонус по акции "${promo.name}" от ${primarySourceItem.name}: +${bonusBlocksTotal} бл.`;
        bonusProductItem.promotionNotes.push(anotherNote);
      }
    }

    appliedPromotions.push({
      promotionId: promo.id,
      promotionName: promo.name,
      type: 'SKU_BONUS',
      bonusPacks: bonusPacksTotal,
      note
    });
  }

  // ==========================================
  // STAGE 1 COST REDISTRIBUTION (Per-Promotion)
  // ==========================================
  const stage1LinePriceMap = new Map<string, number>();
  itemMap.forEach(item => {
    stage1LinePriceMap.set(item.productId, item.basePacks * item.price);
  });

  for (const promo of skuPromos) {
    const qualifyingSourceIds: string[] = [];
    let sourceBaseCost = 0;

    if (promo.sourceGroupId) {
      itemMap.forEach(item => {
        if (item.groupId === promo.sourceGroupId && item.basePacks > 0) {
          qualifyingSourceIds.push(item.productId);
          sourceBaseCost += item.basePacks * item.price;
        }
      });
    } else if (promo.sourceProductId) {
      const item = itemMap.get(promo.sourceProductId);
      if (item && item.basePacks > 0) {
        qualifyingSourceIds.push(item.productId);
        sourceBaseCost += item.basePacks * item.price;
      }
    }

    if (qualifyingSourceIds.length === 0 || sourceBaseCost <= 0) continue;

    const isSameSku = promo.bonusMode === 'SAME_SKU' || !promo.bonusProductId || promo.bonusProductId === promo.sourceProductId;
    const participatingIds = [...qualifyingSourceIds];
    if (!isSameSku && promo.bonusProductId) {
      participatingIds.push(promo.bonusProductId);
    }

    const hasBonus = participatingIds.some(id => (itemMap.get(id)?.bonusPacks ?? 0) > 0);
    if (!hasBonus) continue;

    let participatingNominalCost = 0;
    participatingIds.forEach(id => {
      const it = itemMap.get(id);
      if (it) {
        participatingNominalCost += (it.basePacks + it.bonusPacks) * it.price;
      }
    });

    if (participatingNominalCost > 0) {
      const k_promo = sourceBaseCost / participatingNominalCost;
      participatingIds.forEach(id => {
        const it = itemMap.get(id);
        if (it) {
          const totalPacks = it.basePacks + it.bonusPacks;
          stage1LinePriceMap.set(id, totalPacks * (it.price * k_promo));
        }
      });
    }
  }

  // Working line items for Stages 2, 3, 4
  let totalNominalCostWithBonus = 0;
  let stage1TotalPrice = 0;

  const lineItems: Array<{
    productId: string;
    sku: string;
    name: string;
    groupId?: string;
    groupDisplayName?: string;
    basePacks: number;
    bonusPacks: number;
    totalPacks: number;
    originalPrice: number;
    stage1LinePrice: number;
    stage2LinePrice: number;
    stage3LinePrice: number;
    finalLinePrice: number;
    effectivePrice: number;
    promotionId?: string;
    promotionNotes: string[];
  }> = [];

  itemMap.forEach(item => {
    const totalPacks = item.basePacks + item.bonusPacks;
    if (totalPacks <= 0) return;

    const stage1LinePrice = stage1LinePriceMap.get(item.productId) ?? (item.basePacks * item.price);
    const effectivePrice = totalPacks > 0 ? stage1LinePrice / totalPacks : item.price;

    totalNominalCostWithBonus += totalPacks * item.price;
    stage1TotalPrice += stage1LinePrice;

    lineItems.push({
      productId: item.productId,
      sku: item.sku,
      name: item.name,
      groupId: item.groupId,
      groupDisplayName: item.groupDisplayName,
      basePacks: item.basePacks,
      bonusPacks: item.bonusPacks,
      totalPacks,
      originalPrice: item.price,
      stage1LinePrice,
      stage2LinePrice: stage1LinePrice,
      stage3LinePrice: stage1LinePrice,
      finalLinePrice: stage1LinePrice,
      effectivePrice,
      promotionId: item.promotionId,
      promotionNotes: [...item.promotionNotes]
    });
  });

  const subtotalNominal = totalNominalCostWithBonus;

  // ==========================================
  // STAGE 2: Order Percentage Discounts
  // ==========================================
  let compoundPercentageFactor = 1.0;

  for (const promo of percentagePromos) {
    if (!promo.discountPercent || promo.discountPercent <= 0) continue;
    const factor = (1 - promo.discountPercent / 100);
    compoundPercentageFactor *= factor;

    const note = `Скидка на заказ ${promo.discountPercent}% ("${promo.name}")`;
    appliedPromotions.push({
      promotionId: promo.id,
      promotionName: promo.name,
      type: 'ORDER_PERCENTAGE',
      discountPercent: promo.discountPercent,
      note
    });
  }

  lineItems.forEach(item => {
    item.stage2LinePrice = item.stage1LinePrice * compoundPercentageFactor;
    item.stage3LinePrice = item.stage2LinePrice;
  });

  const stage2TotalPrice = lineItems.reduce((sum, item) => sum + item.stage2LinePrice, 0);

  // ==========================================
  // STAGE 3: Order Fixed Amount Discounts
  // ==========================================
  const fixedAmountDeductions: Array<{ promotionId: string; amount: number }> = [];
  let currentOrderSubtotalForFixed = stage2TotalPrice;

  for (const promo of fixedAmountPromos) {
    if (currentOrderSubtotalForFixed <= 0) break;

    const maxUsagePct = promo.maxOrderUsagePercent ?? 10.0;
    const maxAllowedForOrder = currentOrderSubtotalForFixed * (maxUsagePct / 100);

    const availableLimit = promo.remainingAmount ?? maxAllowedForOrder;
    const usableDiscount = Math.min(availableLimit, maxAllowedForOrder);

    if (usableDiscount <= 0) continue;

    const actualUsable = Math.min(usableDiscount, currentOrderSubtotalForFixed);
    if (actualUsable <= 0) continue;

    const previousStageSubtotal = currentOrderSubtotalForFixed;
    lineItems.forEach(item => {
      const itemShare = previousStageSubtotal > 0 ? (item.stage3LinePrice / previousStageSubtotal) : 0;
      item.stage3LinePrice -= itemShare * actualUsable;
    });

    currentOrderSubtotalForFixed -= actualUsable;

    fixedAmountDeductions.push({
      promotionId: promo.id,
      amount: Math.round(actualUsable * 100) / 100
    });

    const note = `Фиксированная скидка "${promo.name}": -${Math.round(actualUsable).toLocaleString('ru-RU')} сум`;
    appliedPromotions.push({
      promotionId: promo.id,
      promotionName: promo.name,
      type: 'ORDER_FIXED_AMOUNT',
      usedAmount: Math.round(actualUsable * 100) / 100,
      note
    });
  }

  // ==========================================
  // STAGE 4: Final Tiin Rounding & Authoritative Total Calculation
  // ==========================================
  lineItems.forEach(item => {
    if (item.totalPacks > 0) {
      if (item.basePacks === 0 && item.bonusPacks > 0) {
        item.effectivePrice = 0;
        item.finalLinePrice = 0;
      } else {
        const rawUnitPrice = item.stage3LinePrice / item.totalPacks;
        item.effectivePrice = Math.round(rawUnitPrice * 100) / 100;
        item.finalLinePrice = Math.round(item.effectivePrice * item.totalPacks * 100) / 100;
      }
    } else {
      item.effectivePrice = item.originalPrice;
      item.finalLinePrice = 0;
    }
  });

  let overallBasePacks = 0;
  let overallBonusPacks = 0;
  let overallTotalPacks = 0;

  let overallBaseBlocks = 0;
  let overallBonusBlocks = 0;
  let overallTotalBlocks = 0;

  let overallBaseCases = 0;
  let overallBonusCases = 0;
  let overallTotalCases = 0;

  const calculatedItems: CalculatedOrderItem[] = lineItems.map(item => {
    const baseBlocks = item.basePacks / 10;
    const bonusBlocks = item.bonusPacks / 10;
    const totalBlocks = item.totalPacks / 10;

    const baseCases = item.basePacks / 500;
    const bonusCases = item.bonusPacks / 500;
    const totalCases = item.totalPacks / 500;

    overallBasePacks += item.basePacks;
    overallBonusPacks += item.bonusPacks;
    overallTotalPacks += item.totalPacks;

    overallBaseBlocks += baseBlocks;
    overallBonusBlocks += bonusBlocks;
    overallTotalBlocks += totalBlocks;

    overallBaseCases += baseCases;
    overallBonusCases += bonusCases;
    overallTotalCases += totalCases;

    const promotionDiscount = Math.round(((item.totalPacks * item.originalPrice) - item.finalLinePrice) * 100) / 100;

    return {
      productId: item.productId,
      sku: item.sku,
      name: item.name,
      groupId: item.groupId,
      groupDisplayName: item.groupDisplayName,
      baseQuantityPacks: item.basePacks,
      bonusQuantityPacks: item.bonusPacks,
      totalQuantityPacks: item.totalPacks,
      baseQuantityBlocks: baseBlocks,
      bonusQuantityBlocks: bonusBlocks,
      totalQuantityBlocks: totalBlocks,
      baseQuantityCases: Math.round(baseCases * 100) / 100,
      bonusQuantityCases: Math.round(bonusCases * 100) / 100,
      totalQuantityCases: Math.round(totalCases * 100) / 100,
      originalPrice: item.originalPrice,
      effectivePrice: item.effectivePrice,
      itemTotalPrice: item.finalLinePrice,
      promotionDiscount,
      isBonus: item.bonusPacks > 0 && item.basePacks === 0,
      promotionId: item.promotionId,
      promotionNote: item.promotionNotes.join('; ') || undefined,
      skuAllocations: undefined
    };
  });

  const finalPayableTotal = Math.round(lineItems.reduce((sum, i) => sum + i.finalLinePrice, 0) * 100) / 100;
  const nominalSubtotal = Math.round(subtotalNominal * 100) / 100;

  return {
    items: calculatedItems,
    totalBasePacks: overallBasePacks,
    totalBonusPacks: overallBonusPacks,
    totalPacks: overallTotalPacks,
    totalBaseBlocks: overallBaseBlocks,
    totalBonusBlocks: overallBonusBlocks,
    totalBlocks: overallTotalBlocks,
    totalBaseCases: Math.round(overallBaseCases * 100) / 100,
    totalBonusCases: Math.round(overallBonusCases * 100) / 100,
    totalCases: Math.round(overallTotalCases * 100) / 100,
    subtotalPrice: nominalSubtotal,
    stage1Price: Math.round(stage1TotalPrice * 100) / 100,
    stage2Price: Math.round(stage2TotalPrice * 100) / 100,
    totalPrice: finalPayableTotal,
    totalDiscount: Math.round((nominalSubtotal - finalPayableTotal) * 100) / 100,
    appliedPromotions,
    fixedAmountDeductions
  };
}
