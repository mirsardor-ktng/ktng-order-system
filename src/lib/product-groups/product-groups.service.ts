import prisma from '../db';

export interface SkuAllocation {
  productId: string;
  sku: string;
  name: string;
  packs: number;
}

export class ProductGroupService {
  /**
   * Returns all groups with aggregated stock, active SKUs and their details.
   */
  static async getAllGroups() {
    return await prisma.productGroup.findMany({
      include: {
        skus: {
          orderBy: { priority: 'asc' },
          include: { tags: true }
        }
      },
      orderBy: { displayName: 'asc' }
    });
  }

  /**
   * Returns groups visible to customers (active groups with at least 1 active SKU).
   * Aggregates stockPacks, uses basePrice from highest-priority SKU.
   */
  static async getCatalogGroups(filters: { search?: string; favoritesOnly?: boolean } = {}) {
    const totalStart = performance.now();
    const { search, favoritesOnly } = filters;

    // 1. Fetch active product groups
    const dbStart = performance.now();
    const groups = await prisma.productGroup.findMany({
      where: { isActive: true },
      include: {
        skus: {
          where: { isActive: true },
          orderBy: { priority: 'asc' },
          include: { tags: true }
        }
      },
      orderBy: { displayName: 'asc' }
    });

    // 2. Fetch ungrouped active products (if any exist before migration)
    const ungroupedProducts = await prisma.product.findMany({
      where: {
        groupId: null,
        isActive: true
      },
      include: { tags: true },
      orderBy: { name: 'asc' }
    });
    const dbMs = Math.round(performance.now() - dbStart);

    const transformStart = performance.now();
    const groupItems = groups
      .filter(g => g.skus.length > 0)
      .filter(g => {
        if (!search) return true;
        return g.displayName.toLowerCase().includes(search.toLowerCase()) ||
          g.skus.some(s => s.sku.toLowerCase().includes(search.toLowerCase()));
      })
      .filter(g => {
        if (!favoritesOnly) return true;
        return g.skus.some(s => s.isFavorite);
      })
      .map(g => {
        const primarySku = g.skus[0]; // sorted by priority asc — lowest number = first
        const totalStock = g.skus.reduce((sum, s) => sum + s.stockPacks, 0);
        return {
          // Expose as a "Product-like" object so catalog UI needs minimal changes
          id: g.id,          // use groupId as the catalog item ID
          isGroup: true,
          displayName: g.displayName,
          name: g.displayName,
          sku: g.skus.map(s => s.sku).join(', '),
          imageUrl: primarySku.imageUrl,
          basePrice: primarySku.basePrice,
          stockPacks: totalStock,
          isActive: g.isActive,
          isFavorite: g.skus.some(s => s.isFavorite),
          tags: primarySku.tags,
          skus: g.skus,
          groupId: g.id
        };
      });

    const ungroupedItems = ungroupedProducts
      .filter(p => {
        if (!search) return true;
        return p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.sku.toLowerCase().includes(search.toLowerCase());
      })
      .filter(p => {
        if (!favoritesOnly) return true;
        return p.isFavorite;
      })
      .map(p => ({
        id: p.id,
        isGroup: false,
        displayName: p.name,
        name: p.name,
        sku: p.sku,
        imageUrl: p.imageUrl,
        basePrice: p.basePrice,
        stockPacks: p.stockPacks,
        isActive: p.isActive,
        isFavorite: p.isFavorite,
        tags: p.tags,
        skus: [{
          id: p.id,
          sku: p.sku,
          name: p.name,
          stockPacks: p.stockPacks,
          priority: 0,
          isActive: p.isActive,
          basePrice: p.basePrice,
          imageUrl: p.imageUrl
        }],
        groupId: null
      }));

    const transformMs = Math.round(performance.now() - transformStart);
    const totalMs = Math.round(performance.now() - totalStart);
    console.log(`[PERF] ProductGroupService.getCatalogGroups dbMs: ${dbMs}, transformMs: ${transformMs}, totalMs: ${totalMs}`);

    return [...groupItems, ...ungroupedItems];
  }

  /**
   * Allocates packs across active SKUs within a group by priority (ascending).
   * Returns per-SKU allocation array.
   */
  static allocatePacks(
    skus: Array<{ id: string; sku: string; name: string; stockPacks: number; priority: number; isActive: boolean }>,
    totalPacks: number
  ): SkuAllocation[] {
    const sorted = [...skus]
      .filter(s => s.isActive)
      .sort((a, b) => a.priority - b.priority);

    let remaining = totalPacks;
    const result: SkuAllocation[] = [];

    for (const sku of sorted) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, sku.stockPacks);
      if (take > 0) {
        result.push({ productId: sku.id, sku: sku.sku, name: sku.name, packs: take });
        remaining -= take;
      }
    }

    // If still remaining > 0 after all SKUs, stock is insufficient
    if (remaining > 0) {
      const totalAvailable = sorted.reduce((s, x) => s + x.stockPacks, 0);
      throw new Error(
        `Недостаточно товара на складе. Доступно: ${Math.floor(totalAvailable / 10)} блоков.`
      );
    }

    return result;
  }

  /**
   * Returns total available stock for a group (sum of all active SKUs).
   */
  static getTotalStock(
    skus: Array<{ stockPacks: number; isActive: boolean }>
  ): number {
    return skus.filter(s => s.isActive).reduce((sum, s) => sum + s.stockPacks, 0);
  }

  /**
   * Backfill: wrap each ungrouped Product in its own ProductGroup.
   * Safe to run multiple times (idempotent).
   */
  static async migrateUngroupedProducts(): Promise<{ migrated: number }> {
    const ungrouped = await prisma.product.findMany({
      where: { groupId: null }
    });

    let migrated = 0;
    for (const product of ungrouped) {
      const group = await prisma.productGroup.create({
        data: {
          displayName: product.name,
          isActive: product.isActive
        }
      });
      await prisma.product.update({
        where: { id: product.id },
        data: { groupId: group.id, priority: 0 }
      });
      migrated++;
    }

    return { migrated };
  }
}
