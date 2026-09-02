// Strict Tobacco Business Units Conversion Math
// Rules:
// 1 block = 10 packs
// 1 case (box/коробка) = 50 blocks = 500 packs
// Fractional packs are strictly prohibited. Every order must be multiple of 10 packs (1 block).

export type UnitMode = 'PACKS' | 'BLOCKS' | 'CASES';

export const PACKS_PER_BLOCK = 10;
export const BLOCKS_PER_CASE = 50;
export const PACKS_PER_CASE = 500;

/**
 * Rounds given packs to the nearest multiple of 10 packs (1 block).
 * Ensures that there are no loose pack remainders.
 */
export function normalizePacks(packs: number): number {
  if (packs < 0) return 0;
  // Round to nearest multiple of 10 packs (1 block)
  const rounded = Math.round(packs / PACKS_PER_BLOCK) * PACKS_PER_BLOCK;
  return rounded;
}

/**
 * Converts a standard raw pack quantity into current UI unit value.
 */
export function packsToUnit(packs: number, unit: UnitMode): number {
  const roundedPacks = normalizePacks(packs);
  switch (unit) {
    case 'PACKS':
      return roundedPacks;
    case 'BLOCKS':
      return roundedPacks / PACKS_PER_BLOCK;
    case 'CASES':
      // Division by 500 can be float. B2B often shows cases as floats (e.g. 1.2 cases = 60 blocks)
      // We will round to 2 decimals
      return Math.round((roundedPacks / PACKS_PER_CASE) * 100) / 100;
    default:
      return roundedPacks;
  }
}

/**
 * Converts UI input back into internal base unit (packs).
 * Enforces block-multiples.
 */
export function unitToPacks(val: number, unit: UnitMode): number {
  if (isNaN(val) || val < 0) return 0;
  let packs = 0;
  switch (unit) {
    case 'PACKS':
      packs = val;
      break;
    case 'BLOCKS':
      packs = val * PACKS_PER_BLOCK;
      break;
    case 'CASES':
      packs = val * PACKS_PER_CASE;
      break;
  }
  return normalizePacks(packs);
}

/**
 * Formats a given packs quantity with proper Russian plural labels.
 */
export function formatQuantity(packs: number, unit: UnitMode): string {
  const roundedPacks = normalizePacks(packs);
  const blocks = roundedPacks / PACKS_PER_BLOCK;
  const cases = roundedPacks / PACKS_PER_CASE;

  switch (unit) {
    case 'PACKS': {
      return `${roundedPacks} ${getRussianPlural(roundedPacks, 'пачка', 'пачки', 'пачек')}`;
    }
    case 'BLOCKS': {
      return `${blocks} ${getRussianPlural(blocks, 'блок', 'блока', 'блоков')}`;
    }
    case 'CASES': {
      const casesRounded = Math.round(cases * 100) / 100;
      return `${casesRounded} ${getRussianPlural(Math.ceil(casesRounded), 'коробка', 'коробки', 'коробок')}`;
    }
    default:
      return `${roundedPacks} шт`;
  }
}

/**
 * Helper pluralization function for beautiful Russian B2B styling.
 */
export function getRussianPlural(n: number, one: string, two: string, five: string): string {
  let num = Math.abs(n);
  // In case of fractional numbers, use 'two' plural option (e.g. 1.5 коробки)
  if (!Number.isInteger(num)) return two;
  num %= 100;
  if (num >= 5 && num <= 20) {
    return five;
  }
  num %= 10;
  if (num === 1) {
    return one;
  }
  if (num >= 2 && num <= 4) {
    return two;
  }
  return five;
}

/**
 * Breakdown an entire pack total into clean, human-readable structural units.
 * Example: 560 packs -> 1 case, 6 blocks
 */
export interface UnitBreakdown {
  cases: number;
  blocks: number;
  packs: number;
  label: string;
}

export function breakdownPacks(packs: number): UnitBreakdown {
  const normPacks = normalizePacks(packs);
  const cases = Math.floor(normPacks / PACKS_PER_CASE);
  const remainderPacks = normPacks % PACKS_PER_CASE;
  const blocks = Math.floor(remainderPacks / PACKS_PER_BLOCK);

  const parts: string[] = [];
  if (cases > 0) parts.push(`${cases} ${getRussianPlural(cases, 'кор.', 'кор.', 'кор.')}`);
  if (blocks > 0) parts.push(`${blocks} ${getRussianPlural(blocks, 'бл.', 'бл.', 'бл.')}`);
  
  return {
    cases,
    blocks,
    packs: normPacks,
    label: parts.length > 0 ? parts.join(' и ') : '0 бл.'
  };
}
