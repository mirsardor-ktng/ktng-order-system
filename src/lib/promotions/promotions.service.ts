import prisma from '@/lib/db';

export interface CalculatedOrderItem {
  productId: string;
  sku: string;
  name: string;
  // Group-level fields (logical product)
  groupId?: string;
  groupDisplayName?: string;
  baseQuantityPacks: number;
  bonusQuantityPacks: number;
  totalQuantityPacks: number;
  baseQuantityBlocks: number;
  bonusQuantityBlocks: number;
  totalQuantityBlocks: number;
  baseQuantityCases: number;
  bonusQuantityCases: number;
  totalQuantityCases: number;
  originalPrice: number; // Catalog base price per pack
  effectivePrice: number; // Effective unit price after discount redistribution
  itemTotalPrice: number; // Final line total price
  promotionDiscount: number; // Total discount amount on this line
  isBonus: boolean;
  promotionId?: string;
  promotionNote?: string;
  // Per-SKU warehouse allocations (filled by OrdersService after calculateOrder)
  skuAllocations?: Array<{ productId: string; sku: string; name: string; packs: number }>;
}

export interface AppliedPromotionInfo {
  promotionId: string;
  promotionName: string;
  type: 'SKU_BONUS' | 'ORDER_PERCENTAGE' | 'ORDER_FIXED_AMOUNT';
  discountPercent?: number;
  usedAmount?: number;
  bonusPacks?: number;
  note: string;
}

export interface CalculatedOrder {
  items: CalculatedOrderItem[];
  totalBasePacks: number;
  totalBonusPacks: number;
  totalPacks: number;
  totalBaseBlocks: number;
  totalBonusBlocks: number;
  totalBlocks: number;
  totalBaseCases: number;
  totalBonusCases: number;
  totalCases: number;
  subtotalPrice: number; // Total nominal cost before bonus redistribution
  stage1Price: number;   // Price after Stage 1 (SKU Promos)
  stage2Price: number;   // Price after Stage 2 (Percentage Discounts)
  totalPrice: number;    // Final payable price after Stage 3 & 4
  totalDiscount: number; // Total savings/discount
  appliedPromotions: AppliedPromotionInfo[];
  fixedAmountDeductions: Array<{ promotionId: string; amount: number }>;
}

export class PromotionsService {
  /**
   * Retrieves active promotions applicable for a specific company and date.
   */
  static async getApplicablePromotions(companyId?: string | null, date: Date = new Date()) {
    const promotions = await prisma.promotion.findMany({
      where: {
        isActive: true,
        OR: [
          { startDate: null },
          { startDate: { lte: date } }
        ],
        AND: [
          {
            OR: [
              { endDate: null },
              { endDate: { gte: date } }
            ]
          }
        ]
      },
      select: {
        id: true,
        name: true,
        type: true,
        applyToAllCompanies: true,
        bonusMode: true,
        minimumBlocks: true,
        bonusBlocks: true,
        sourceProductId: true,
        sourceGroupId: true,
        bonusProductId: true,
        discountPercent: true,
        remainingAmount: true,
        maxOrderUsagePercent: true,
        bonusProduct: {
          select: {
            id: true,
            sku: true,
            name: true,
            basePrice: true,
            groupId: true
          }
        },
        companies: { select: { id: true } }
      }
    });

    if (!companyId) {
      return promotions.filter(p => p.applyToAllCompanies);
    }

    return promotions.filter(p => p.applyToAllCompanies || p.companies.some(c => c.id === companyId));
  }

  /**
   * Single Source of Truth for order calculations:
   * Promotion Engine v2 (Sprint 3.1):
   * Sequential multi-stage calculation pipeline:
   * Stage 1: SKU Promotions (10+1, 5+2, etc.)
   * Stage 2: Order Percentage Discounts (e.g. 4%, 7%)
   * Stage 3: Order Fixed Amount Discounts (consumable, capped at maxOrderUsagePercent, default 10%)
   * Stage 4: Final Tiin Rounding
   */
  static async calculateOrder(
    inputItems: Array<{
      productId: string;
      sku?: string;
      name?: string;
      baseQuantityPacks: number;
      price?: number;
      groupId?: string;
      groupDisplayName?: string;
    }>,
    companyId?: string | null
  ): Promise<CalculatedOrder> {
    const totalStart = performance.now();

    // Fetch product and group details if sku/name/price missing or if item.productId is a group ID
    const productIds = inputItems.map(i => i.productId).filter(Boolean);
    const groupIds = inputItems.map(i => i.groupId || i.productId).filter(Boolean);

    let productsMs = 0;
    let groupsMs = 0;
    let promotionsMs = 0;

    const [promotions, dbProducts, dbGroups] = await Promise.all([
      (async () => {
        const s = performance.now();
        const res = await this.getApplicablePromotions(companyId);
        promotionsMs = Math.round(performance.now() - s);
        return res;
      })(),
      (async () => {
        const s = performance.now();
        const res = await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            sku: true,
            name: true,
            basePrice: true,
            groupId: true
          }
        });
        productsMs = Math.round(performance.now() - s);
        return res;
      })(),
      (async () => {
        const s = performance.now();
        const res = await prisma.productGroup.findMany({
          where: { id: { in: groupIds } },
          select: {
            id: true,
            displayName: true,
            skus: {
              where: { isActive: true },
              orderBy: { priority: 'asc' },
              select: {
                id: true,
                sku: true,
                name: true,
                basePrice: true,
                groupId: true,
                priority: true
              }
            }
          }
        });
        groupsMs = Math.round(performance.now() - s);
        return res;
      })()
    ]);

    // Group promotions by stage
    const skuPromos = promotions.filter(p => !p.type || p.type === 'SKU_BONUS');
    const percentagePromos = promotions.filter(p => p.type === 'ORDER_PERCENTAGE' && p.discountPercent && p.discountPercent > 0);
    const fixedAmountPromos = promotions.filter(p => p.type === 'ORDER_FIXED_AMOUNT' && (p.remainingAmount === null || (p.remainingAmount !== null && p.remainingAmount > 0)));

    const calcStart = performance.now();

    const productMap = new Map(dbProducts.map(p => [p.id, p]));
    const groupMap = new Map(dbGroups.map(g => [g.id, g]));

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
      // Determine the aggregate base packs eligible for this promotion.
      // Priority: sourceGroupId (logical product) > sourceProductId (single SKU)
      let sourceBasePacks = 0;
      let primarySourceItem: typeof itemMap extends Map<string, infer V> ? V : never = null as any;

      if ((promo as any).sourceGroupId) {
        // Group-level promo: sum basePacks of all items that belong to this group
        itemMap.forEach(item => {
          if (item.groupId === (promo as any).sourceGroupId) {
            sourceBasePacks += item.basePacks;
            if (!primarySourceItem) primarySourceItem = item; // first item in group for note
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

      // Bonus calculation ALWAYS relies ONLY on base user input (never bonus quantities)
      const sourceBaseBlocks = Math.floor(sourceBasePacks / 10);
      if (sourceBaseBlocks < promo.minimumBlocks) continue;

      const multiplier = Math.floor(sourceBaseBlocks / promo.minimumBlocks);
      const bonusBlocksTotal = multiplier * promo.bonusBlocks;
      const bonusPacksTotal = bonusBlocksTotal * 10;

      if (bonusPacksTotal <= 0) continue;

      const note = `Акция "${promo.name}": +${bonusBlocksTotal} бл. бонус`;

      if (promo.bonusMode === 'SAME_SKU' || !promo.bonusProductId || promo.bonusProductId === promo.sourceProductId) {
        // For group-level promos: add bonus to the primary (first) item of the group.
        // OrdersService will redistribute via allocatePacks after calculateOrder.
        primarySourceItem.bonusPacks += bonusPacksTotal;
        if (!primarySourceItem.promotionId) primarySourceItem.promotionId = promo.id;
        primarySourceItem.promotionNotes.push(note);
      } else {
        let bonusProductItem = itemMap.get(promo.bonusProductId);
        if (!bonusProductItem) {
          const bonusProd = promo.bonusProduct || (promo.bonusProductId ? await prisma.product.findUnique({
            where: { id: promo.bonusProductId },
            select: { id: true, sku: true, name: true, basePrice: true, groupId: true }
          }) : null);
          if (bonusProd) {
            bonusProductItem = {
              productId: bonusProd.id,
              sku: bonusProd.sku,
              name: bonusProd.name,
              groupId: (bonusProd as any).groupId || undefined,
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
    // Tracks Stage 1 line prices: default for each item is basePacks * price
    const stage1LinePriceMap = new Map<string, number>();
    itemMap.forEach(item => {
      stage1LinePriceMap.set(item.productId, item.basePacks * item.price);
    });

    // For each triggered SKU promotion, redistribute cost ONLY among its participating items
    for (const promo of skuPromos) {
      const qualifyingSourceIds: string[] = [];
      let sourceBaseCost = 0;

      if ((promo as any).sourceGroupId) {
        itemMap.forEach(item => {
          if (item.groupId === (promo as any).sourceGroupId && item.basePacks > 0) {
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

      // Check if any bonus was actually awarded for this promotion
      const hasBonus = participatingIds.some(id => (itemMap.get(id)?.bonusPacks ?? 0) > 0);
      if (!hasBonus) continue;

      // Calculate nominal value of participating items (totalPacks * price)
      let participatingNominalCost = 0;
      participatingIds.forEach(id => {
        const it = itemMap.get(id);
        if (it) {
          participatingNominalCost += (it.basePacks + it.bonusPacks) * it.price;
        }
      });

      if (participatingNominalCost > 0) {
        const k_promo = sourceBaseCost / participatingNominalCost;
        // Apply k_promo ONLY to the participating items
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

      // Distribute proportionally across all line items based on item.stage3LinePrice
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

    const stage3TotalPrice = currentOrderSubtotalForFixed;

    // ==========================================
    // STAGE 4: Final Tiin Rounding
    // ==========================================
    let calculatedTotalPriceSum = 0;

    lineItems.forEach(item => {
      item.finalLinePrice = Math.round(item.stage3LinePrice * 100) / 100;
      item.effectivePrice = item.totalPacks > 0 ? Math.round((item.finalLinePrice / item.totalPacks) * 100) / 100 : item.originalPrice;
      calculatedTotalPriceSum += item.finalLinePrice;
    });

    const expectedPayableTotalPrice = Math.round(stage3TotalPrice * 100) / 100;
    const roundingDiff = Math.round((expectedPayableTotalPrice - calculatedTotalPriceSum) * 100) / 100;

    if (Math.abs(roundingDiff) > 0 && lineItems.length > 0) {
      // Find item line with maximum total price
      const maxItem = lineItems.reduce((prev, curr) => (curr.finalLinePrice > prev.finalLinePrice ? curr : prev), lineItems[0]);
      maxItem.finalLinePrice = Math.round((maxItem.finalLinePrice + roundingDiff) * 100) / 100;
      maxItem.effectivePrice = maxItem.totalPacks > 0 ? Math.round((maxItem.finalLinePrice / maxItem.totalPacks) * 100) / 100 : maxItem.originalPrice;
    }

    // Build final CalculatedOrderItem[] output
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
        skuAllocations: undefined // Filled by OrdersService after calculateOrder
      };
    });

    const finalPayableTotal = Math.round(lineItems.reduce((sum, i) => sum + i.finalLinePrice, 0) * 100) / 100;
    const nominalSubtotal = Math.round(subtotalNominal * 100) / 100;

    const calculationMs = Math.round(performance.now() - calcStart);
    const totalMs = Math.round(performance.now() - totalStart);
    console.log(`[PERF] PromotionsService.calculateOrder productsMs: ${productsMs}, groupsMs: ${groupsMs}, promotionsMs: ${promotionsMs}, calculationMs: ${calculationMs}, totalMs: ${totalMs}`);

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

  // Alias processOrderPromotions for backward compatibility if referenced elsewhere
  static async processOrderPromotions(
    inputItems: Array<{ productId: string; sku: string; name: string; packs: number; price: number }>,
    companyId?: string | null
  ) {
    const formatted = inputItems.map(i => ({
      productId: i.productId,
      sku: i.sku,
      name: i.name,
      baseQuantityPacks: i.packs,
      price: i.price
    }));
    return await this.calculateOrder(formatted, companyId);
  }
}
