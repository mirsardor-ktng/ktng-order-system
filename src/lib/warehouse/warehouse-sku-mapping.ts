/**
 * Official Warehouse SKU Mapping
 * Sourced directly from official warehouse assembly request templates.
 *
 * For each physical SKU, defines official warehouse codes and names for:
 * - full cases (cases of 500 packs)
 * - loose blocks (blocks of 10 packs)
 */

export interface WarehouseSkuDefinition {
  caseCode: string;
  caseName: string;
  blockCode: string;
  blockName: string;
}

export const WAREHOUSE_SKU_MAPPING: Record<string, WarehouseSkuDefinition> = {
  '10009161A3': {
    caseCode: '10009161A3',
    caseName: 'ESSE CHANGE',
    blockCode: '10009161A3(b)',
    blockName: 'ESSE CHANGE (Block)'
  },
  '10009156A2': {
    caseCode: '10009156A2',
    caseName: 'ESSE CHANGE M',
    blockCode: '10009156A2(b)',
    blockName: 'ESSE CHANGE M (Block)'
  },
  '10009153A2': {
    caseCode: '10009153A2',
    caseName: 'ESSE CHANGE UP',
    blockCode: '10009153A2(b)',
    blockName: 'ESSE CHANGE UP (Block)'
  },
  '10008730A2': {
    caseCode: '10008730A2',
    caseName: 'ESSE CHANGE GRIP STYLE',
    blockCode: '10008730A2(b)',
    blockName: 'ESSE CHANGE GRIP STYLE (Block)'
  },
  '10008751A2': {
    caseCode: '10008751A2',
    caseName: 'ESSE SILVER GRIP STYLE',
    blockCode: '10008751A2(b)',
    blockName: 'ESSE SILVER GRIP STYLE (Block)'
  },
  '10009136A1': {
    caseCode: '10009136A1',
    caseName: 'ESSE CHANGE DOUBLE TROPIC',
    blockCode: '10009136A1(b)',
    blockName: 'ESSE CHANGE DOUBLE TROPIC (Block)'
  },
  '10009543A0': {
    caseCode: '10009543A0',
    caseName: 'BOHEM LIBRE BROWN',
    blockCode: '10009543A0(b)',
    blockName: 'BOHEM LIBRE BROWN (Block)'
  },
  '10009326A0': {
    caseCode: '10009326A0',
    caseName: 'ESSE SENSE HIMALAYA',
    blockCode: '10009326A0(b)',
    blockName: 'ESSE SENSE HIMALAYA (Block)'
  },
  '10009356A0': {
    caseCode: '10009356A0',
    caseName: 'ESSE SENSE HIMALAYA DEMI',
    blockCode: '10009356A0(b)',
    blockName: 'ESSE SENSE HIMALAYA DEMI (Block)'
  },
  '10009324A0': {
    caseCode: '10009324A0',
    caseName: 'ESSE SENSE HIMALAYA GRIP STYLE',
    blockCode: '10009324A0(b)',
    blockName: 'ESSE SENSE HIMALAYA GRIP STYLE (Block)'
  },
  '10010639A0': {
    caseCode: '10010639A0',
    caseName: 'ESSE CHANGE 1',
    blockCode: '10010639A0(b)',
    blockName: 'ESSE CHANGE 1 (Block)'
  },
  '10009163A2': {
    caseCode: '10009163A2',
    caseName: 'ESSE BLUE',
    blockCode: '10009163A2(b)',
    blockName: 'ESSE BLUE (Block)'
  },
  '10009150A1': {
    caseCode: '10009150A1',
    caseName: 'ESSE SPECIAL GOLD',
    blockCode: '10009150A1(b)',
    blockName: 'ESSE SPECIAL GOLD (Block)'
  },
  '10008726A1': {
    caseCode: '10008726A1',
    caseName: 'ESSE CHANGE COLD BLACK',
    blockCode: '10008726A1(b)',
    blockName: 'ESSE CHANGE COLD BLACK (Block)'
  },
  '10010372A0': {
    caseCode: '10010372A0',
    caseName: 'ESSE CHANGE BING GRIP STYLE',
    blockCode: '10010372A0(b)',
    blockName: 'ESSE CHANGE BING GRIP STYLE (Block)'
  },
  '10010375A0': {
    caseCode: '10010375A0',
    caseName: 'ESSE CHANGE UP GRIP STYLE',
    blockCode: '10010375A0(b)',
    blockName: 'ESSE CHANGE UP GRIP STYLE (Block)'
  },
  '10009525A0': {
    caseCode: '10009525A0',
    caseName: 'BOHEM CAVANA MOJO',
    blockCode: '10009525A0(b)',
    blockName: 'BOHEM CAVANA MOJO (Block)'
  },
  '10009583A0': {
    caseCode: '10009583A0',
    caseName: 'BOHEM FIESTA BROWN',
    blockCode: '10009583A0(b)',
    blockName: 'BOHEM FIESTA BROWN (Block)'
  },
  '10009551A0': {
    caseCode: '10009551A0',
    caseName: 'BOHEM CAVANA DEMI',
    blockCode: '10009551A0(b)',
    blockName: 'BOHEM CAVANA DEMI (Block)'
  },
  '10009833A0': {
    caseCode: '10009833A0',
    caseName: 'BOHEM CAVANA BROWN',
    blockCode: '10009833A0(b)',
    blockName: 'BOHEM CAVANA BROWN (Block)'
  },
  '10009564A0': {
    caseCode: '10009564A0',
    caseName: 'BOHEM CAVANA ORIGINAL',
    blockCode: '10009564A0(b)',
    blockName: 'BOHEM CAVANA ORIGINAL (Block)'
  },
  '10009529A0': {
    caseCode: '10009529A0',
    caseName: 'BOHEM LIBRE RED',
    blockCode: '10009529A0(b)',
    blockName: 'BOHEM LIBRE RED (Block)'
  },
  '10010311A0': {
    caseCode: '10010311A0',
    caseName: 'PINE GREEN',
    blockCode: '10010311A0(b)',
    blockName: 'PINE GREEN (Block)'
  },
  '10010258A0': {
    caseCode: '10010258A0',
    caseName: 'PINE BLUE',
    blockCode: '10010258A0(b)',
    blockName: 'PINE BLUE (Block)'
  },
  '10010259A0': {
    caseCode: '10010259A0',
    caseName: 'PINE BLUE KS',
    blockCode: '10010259A0(b)',
    blockName: 'PINE BLUE KS (Block)'
  },
  '10010640A0': {
    caseCode: '10010640A0',
    caseName: 'ESSE CHANGE 1 GRIP STYLE',
    blockCode: '10010640A0(b)',
    blockName: 'ESSE CHANGE 1 GRIP STYLE (Block)'
  }
};

/**
 * Resolves official warehouse mapping for a given SKU.
 * Throws a descriptive error if the SKU is not registered.
 */
export function resolveWarehouseSku(sku: string): WarehouseSkuDefinition {
  const cleanSku = (sku || '').trim();
  const def = WAREHOUSE_SKU_MAPPING[cleanSku];
  if (!def) {
    throw new Error(`ÐžÑ‚ÑÑƒÑ‚ÑÑ‚Ð²ÑƒÐµÑ‚ ÑÐºÐ»Ð°Ð´ÑÐºÐ¾Ð¹ Ð¼Ð°Ð¿Ð¿Ð¸Ð½Ð³ Ð´Ð»Ñ SKU: ${cleanSku}`);
  }
  return def;
}
