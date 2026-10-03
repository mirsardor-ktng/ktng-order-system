import prisma from '@/lib/db';
import { OrderCalculationConfig, ConfigProduct, ConfigProductGroup, ConfigPromotion } from './types';

interface CachedEntry {
  config: OrderCalculationConfig;
  expiresAt: number;
}

const configCache = new Map<string, CachedEntry>();
let configVersion = 1;
const DEFAULT_TTL_MS = 60 * 1000; // 60 seconds TTL

export function invalidateOrderCalculationConfig() {
  configCache.clear();
  configVersion++;
}

export async function getOrderCalculationConfig(
  companyId?: string | null,
  forceRefresh = false
): Promise<{ config: OrderCalculationConfig; cacheHit: boolean; loadMs: number }> {
  const cacheKey = companyId || '__GLOBAL__';
  const now = Date.now();

  if (!forceRefresh) {
    const cached = configCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return { config: cached.config, cacheHit: true, loadMs: 0 };
    }
  }

  const start = performance.now();
  const date = new Date();

  // Load products, active groups, and active promotions in a single combined batch
  const [dbProducts, dbGroups, dbPromotions] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        sku: true,
        name: true,
        basePrice: true,
        groupId: true,
        priority: true,
        isActive: true
      }
    }),
    prisma.productGroup.findMany({
      where: { isActive: true },
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
            priority: true,
            stockPacks: true
          }
        }
      },
      orderBy: { displayName: 'asc' }
    }),
    prisma.promotion.findMany({
      where: {
        isActive: true,
        OR: [{ startDate: null }, { startDate: { lte: date } }],
        AND: [{ OR: [{ endDate: null }, { endDate: { gte: date } }] }]
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
    })
  ]);

  // Filter promotions for company
  const filteredPromotions = dbPromotions.filter(p => {
    if (p.applyToAllCompanies) return true;
    if (!companyId) return false;
    return p.companies.some(c => c.id === companyId);
  });

  const promotions: ConfigPromotion[] = filteredPromotions.map(p => ({
    id: p.id,
    name: p.name,
    type: p.type as any,
    applyToAllCompanies: p.applyToAllCompanies,
    bonusMode: p.bonusMode as any,
    minimumBlocks: p.minimumBlocks,
    bonusBlocks: p.bonusBlocks,
    sourceProductId: p.sourceProductId,
    sourceGroupId: p.sourceGroupId,
    bonusProductId: p.bonusProductId,
    discountPercent: p.discountPercent,
    remainingAmount: p.remainingAmount,
    maxOrderUsagePercent: p.maxOrderUsagePercent,
    bonusProduct: p.bonusProduct,
    companyIds: p.companies.map(c => c.id)
  }));

  const products: ConfigProduct[] = dbProducts.map(p => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    basePrice: p.basePrice,
    groupId: p.groupId,
    priority: p.priority,
    isActive: p.isActive
  }));

  const groups: ConfigProductGroup[] = dbGroups.map(g => ({
    id: g.id,
    displayName: g.displayName,
    skus: g.skus
  }));

  const config: OrderCalculationConfig = {
    version: configVersion,
    timestamp: now,
    companyId: companyId || null,
    products,
    groups,
    promotions
  };

  configCache.set(cacheKey, {
    config,
    expiresAt: now + DEFAULT_TTL_MS
  });

  const loadMs = Math.round(performance.now() - start);
  return { config, cacheHit: false, loadMs };
}
