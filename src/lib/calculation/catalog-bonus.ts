type CatalogProduct = {
  id: string;
  groupId?: string | null;
  isGroup?: boolean;
  skus?: Array<{ id: string }>;
};

type CatalogCalculatedItem = {
  productId: string;
  groupId?: string;
  baseQuantityPacks: number;
  bonusQuantityPacks: number;
};

/** Returns calculated lines represented by a customer catalog card. */
export function getCatalogCalculatedItems<T extends CatalogCalculatedItem>(
  product: CatalogProduct,
  items: T[]
): T[] {
  const skuIds = new Set(product.skus?.map(sku => sku.id) ?? []);
  return items.filter(item => {
    if (item.productId === product.id) return true;
    if (product.isGroup && item.groupId === product.id) return true;
    return skuIds.has(item.productId);
  });
}

export function getCatalogBonusSummary(
  product: CatalogProduct,
  items: CatalogCalculatedItem[]
) {
  const matchingItems = getCatalogCalculatedItems(product, items);
  const baseQuantityPacks = matchingItems.reduce((sum, item) => sum + item.baseQuantityPacks, 0);
  const bonusQuantityPacks = matchingItems.reduce((sum, item) => sum + item.bonusQuantityPacks, 0);

  return {
    baseQuantityPacks,
    bonusQuantityPacks,
    totalQuantityPacks: baseQuantityPacks + bonusQuantityPacks,
    isBonusOnly: baseQuantityPacks === 0 && bonusQuantityPacks > 0
  };
}
