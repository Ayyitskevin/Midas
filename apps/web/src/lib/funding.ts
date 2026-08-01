import type { FundingRow } from '@midas/shared';

/**
 * Annualized funding rate as a percent. Pass the venue's actual settlement
 * interval: funding cadence varies by venue (1h on Hyperliquid-style venues,
 * 4h on some perps, 8h commonly) and the APR scales with it — an 8h assumption
 * can be off by 2-8x. Pass null when the interval is unknown → null out (honest
 * beats helpful). An omitted argument keeps the legacy 8h assumption for the
 * older single-venue callers that predate per-symbol intervals. null rate in →
 * null out.
 */
export function annualizedFundingPct(rate: number | null, intervalHours?: number | null): number | null {
  if (rate == null || intervalHours === null) return null;
  const hours = intervalHours ?? 8;
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return rate * (24 / hours) * 365 * 100;
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
