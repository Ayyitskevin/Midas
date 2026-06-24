import type { FundingRow } from '@midas/shared';

/**
 * Annualized funding rate as a percent, assuming funding settles every
 * `intervalHours` (8h is the common perp cadence). null in → null out.
 */
export function annualizedFundingPct(rate: number | null, intervalHours = 8): number | null {
  if (rate == null) return null;
  return rate * (24 / intervalHours) * 365 * 100;
}

export type FundingSortKey = 'symbol' | 'funding' | 'oi';

/** Sort funding rows by a column; numeric nulls always sink to the bottom. */
export function sortFundingRows(
  rows: FundingRow[],
  key: FundingSortKey,
  dir: 'asc' | 'desc',
): FundingRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const num = (r: FundingRow): number | null => (key === 'funding' ? r.fundingRate : r.openInterestValue);
  return [...rows].sort((a, b) => {
    if (key === 'symbol') return sign * a.symbol.localeCompare(b.symbol);
    const av = num(a);
    const bv = num(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // nulls last regardless of direction
    if (bv == null) return -1;
    return sign * (av - bv);
  });
}
