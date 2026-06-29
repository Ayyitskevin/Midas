import type { VenueDerivatives } from '@midas/shared';

/** Cross-venue funding/OI summary — the divergence (arb) signal plus aggregate OI. */
export interface VenueFundingStats {
  /** Highest funding rate across venues (fraction); null if none reported. */
  maxFunding: number | null;
  /** Lowest (or most negative) funding rate across venues (fraction); null if none. */
  minFunding: number | null;
  /** max − min funding — the cross-venue funding spread / arb signal; null with < 2 funding venues. */
  spread: number | null;
  /** Venue with the highest funding (most expensive to be long). */
  maxVenue: string | null;
  /** Venue with the lowest / most-negative funding. */
  minVenue: string | null;
  /** Total open-interest notional across venues that report it. */
  totalOi: number;
  /** Number of venues returned. */
  venues: number;
}

/**
 * Summarize a set of per-venue derivatives rows: the funding extremes and their
 * spread (the funding-arb signal — long the cheapest, short the dearest), and
 * the aggregate open interest. Pure; ignores venues with missing data.
 */
export function summarizeVenueDerivatives(rows: VenueDerivatives[]): VenueFundingStats {
  const funded = rows.filter(
    (r): r is VenueDerivatives & { fundingRate: number } =>
      r.fundingRate != null && Number.isFinite(r.fundingRate),
  );

  let maxFunding: number | null = null;
  let minFunding: number | null = null;
  let maxVenue: string | null = null;
  let minVenue: string | null = null;
  for (const r of funded) {
    if (maxFunding === null || r.fundingRate > maxFunding) {
      maxFunding = r.fundingRate;
      maxVenue = r.exchange;
    }
    if (minFunding === null || r.fundingRate < minFunding) {
      minFunding = r.fundingRate;
      minVenue = r.exchange;
    }
  }

  const spread =
    funded.length >= 2 && maxFunding !== null && minFunding !== null ? maxFunding - minFunding : null;

  let totalOi = 0;
  for (const r of rows) {
    if (r.openInterestValue != null && Number.isFinite(r.openInterestValue)) totalOi += r.openInterestValue;
  }

  return { maxFunding, minFunding, spread, maxVenue, minVenue, totalOi, venues: rows.length };
}
