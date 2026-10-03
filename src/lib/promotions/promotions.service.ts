import prisma from '@/lib/db';
import {
  CalculatedOrderItem,
  AppliedPromotionInfo,
  CalculatedOrder,
  CalculationInputItem
} from '@/lib/calculation/types';
import { calculateOrderPure } from '@/lib/calculation/engine';
import {
  getOrderCalculationConfig,
  invalidateOrderCalculationConfig
} from '@/lib/calculation/config-cache';

export type { CalculatedOrderItem, AppliedPromotionInfo, CalculatedOrder };
export { invalidateOrderCalculationConfig };

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
   * Uses cached OrderCalculationConfig and the pure calculation engine.
   * Eliminates repetitive database queries on every calculation.
   */
  static async calculateOrder(
    inputItems: CalculationInputItem[],
    companyId?: string | null
  ): Promise<CalculatedOrder> {
    const totalStart = performance.now();

    const { config, cacheHit, loadMs: configLoadMs } = await getOrderCalculationConfig(companyId);

    const calcStart = performance.now();
    const result = calculateOrderPure(inputItems, config);
    const calculationMs = Math.round(performance.now() - calcStart);

    const totalMs = Math.round(performance.now() - totalStart);
    console.log(
      `[PERF] PromotionsService.calculateOrder configLoadMs: ${configLoadMs}, cacheHit: ${cacheHit}, cacheMiss: ${!cacheHit}, calculationMs: ${calculationMs}, totalMs: ${totalMs}`
    );

    return result;
  }

  // Alias processOrderPromotions for backward compatibility
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
