/**
 * Perp basis / premium math — pure and offline. The "basis" is how far a
 * perpetual's mark price trades from its spot index; the premium is that gap as
 * a percentage, and the funding rate annualizes into the carry an arb pays or
 * earns to hold the position.
 */

/** 8-hour funding → 3 per day → 1095 per (365-day) year; the common cadence's settlement count. */
export const DEFAULT_FUNDINGS_PER_YEAR = 1095;

export interface BasisInput {
  markPrice: number | null;
  indexPrice: number | null;
  fundingRate: number | null;
  /** Funding settlements per year; takes precedence over `fundingIntervalHours` when set. */
  fundingsPerYear?: number;
  /**
   * Hours between funding settlements (1 = hourly, 4/8 = the common cadences);
   * null or omitted when unknown — the APR is then null rather than annualized
   * on a fabricated 8h assumption (the cadence scales the APR 2-8x).
   */
  fundingIntervalHours?: number | null;
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
  /** Funding rate annualized to a percentage; null when the funding cadence is unknown. */
  fundingAprPct: number | null;
}

export function computeBasis(input: BasisInput): BasisStats {
  const mark = input.markPrice != null && input.markPrice > 0 ? input.markPrice : null;
  const index = input.indexPrice != null && input.indexPrice > 0 ? input.indexPrice : null;
  const fundingRate = input.fundingRate ?? null;
  // Annualize only from a known cadence — never assume 8h.
  const fundingsPerYear =
    input.fundingsPerYear ??
    (input.fundingIntervalHours != null && input.fundingIntervalHours > 0
      ? (24 * 365) / input.fundingIntervalHours
      : null);

  const valid = mark != null && index != null;
  const basis = valid ? mark - index : null;
  const premiumPct = valid ? (mark / index - 1) * 100 : null;
  const fundingAprPct =
    fundingRate != null && fundingsPerYear != null ? fundingRate * fundingsPerYear * 100 : null;

  return { valid, mark, index, basis, premiumPct, fundingRate, fundingAprPct };
}
