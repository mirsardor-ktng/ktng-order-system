export interface ConfigProduct {
  id: string;
  sku: string;
  name: string;
  basePrice: number;
  groupId?: string | null;
  priority?: number;
  isActive?: boolean;
}

export interface ConfigGroupSku {
  id: string;
  sku: string;
  name: string;
  basePrice: number;
  groupId?: string | null;
  priority: number;
  stockPacks?: number;
}

export interface ConfigProductGroup {
  id: string;
  displayName: string;
  skus: ConfigGroupSku[];
}

export interface ConfigPromotion {
  id: string;
  name: string;
  type: 'SKU_BONUS' | 'ORDER_PERCENTAGE' | 'ORDER_FIXED_AMOUNT';
  applyToAllCompanies: boolean;
  bonusMode: 'SAME_SKU' | 'ANOTHER_SKU';
  minimumBlocks: number;
  bonusBlocks: number;
  sourceProductId?: string | null;
  sourceGroupId?: string | null;
  bonusProductId?: string | null;
  discountPercent?: number | null;
  remainingAmount?: number | null;
  maxOrderUsagePercent?: number | null;
  bonusProduct?: {
    id: string;
    sku: string;
    name: string;
    basePrice: number;
    groupId?: string | null;
  } | null;
  companyIds?: string[];
}

export interface OrderCalculationConfig {
  version: number;
  timestamp: number;
  companyId?: string | null;
  products: ConfigProduct[];
  groups: ConfigProductGroup[];
  promotions: ConfigPromotion[];
}

export interface CalculatedOrderItem {
  productId: string;
  sku: string;
  name: string;
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
  originalPrice: number;
  effectivePrice: number;
  itemTotalPrice: number;
  promotionDiscount: number;
  isBonus: boolean;
  promotionId?: string;
  promotionNote?: string;
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
  subtotalPrice: number;
  stage1Price: number;
  stage2Price: number;
  totalPrice: number;
  totalDiscount: number;
  appliedPromotions: AppliedPromotionInfo[];
  fixedAmountDeductions: Array<{ promotionId: string; amount: number }>;
}

export interface CalculationInputItem {
  productId: string;
  sku?: string;
  name?: string;
  baseQuantityPacks: number;
  price?: number;
  groupId?: string;
  groupDisplayName?: string;
}
