/**
 * Perp basis / premium math — pure and offline. The "basis" is how far a
 * perpetual's mark price trades from its spot index; the premium is that gap as
 * a percentage, and the funding rate annualizes into the carry an arb pays or
 * earns to hold the position.
 */

/** 8-hour funding → 3 per day → 1095 per (365-day) year. */
export const DEFAULT_FUNDINGS_PER_YEAR = 1095;

export interface BasisInput {
  markPrice: number | null;
  indexPrice: number | null;
  fundingRate: number | null;
  /** Funding intervals per year; defaults to 8h funding. */
  fundingsPerYear?: number;
}

export interface BasisStats {
  /** True when mark and index are both present and positive. */
  valid: boolean;
  mark: number | null;
  index: number | null;
  /** mark − index, in quote units. */
  basis: number | null;
  /** (mark / index − 1) × 100. */
  premiumPct: number | null;
  fundingRate: number | null;
  /** Funding rate annualized to a percentage. */
  fundingAprPct: number | null;
}

export function computeBasis(input: BasisInput): BasisStats {
  const mark = input.markPrice != null && input.markPrice > 0 ? input.markPrice : null;
  const index = input.indexPrice != null && input.indexPrice > 0 ? input.indexPrice : null;
  const fundingRate = input.fundingRate ?? null;
  const fundingsPerYear = input.fundingsPerYear ?? DEFAULT_FUNDINGS_PER_YEAR;

  const valid = mark != null && index != null;
  const basis = valid ? mark - index : null;
  const premiumPct = valid ? (mark / index - 1) * 100 : null;
  const fundingAprPct = fundingRate != null ? fundingRate * fundingsPerYear * 100 : null;

  return { valid, mark, index, basis, premiumPct, fundingRate, fundingAprPct };
}
