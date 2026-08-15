import type { ScreenerRow } from '@midas/shared';

/** Advance/decline summary across a screened market set. */
export interface Breadth {
  advancers: number;
  decliners: number;
  unchanged: number;
  /**
   * Rows whose 24h change the venue did not report.
   *
   * Distinct from `unchanged`: a symbol that did not move is a measurement, a
   * symbol with no reported change is the absence of one. Folding the second
   * into the first would present missing data as a flat market.
   */
  unknown: number;
  total: number;
  /** Fraction of the MEASURED set that is up on the day, 0–1 (0 when none). */
  advancingPct: number;
  /** Mean 24h change across the MEASURED set, in percent; null when none. */
  avgChange: number | null;
}

/** The market-overview dashboard view derived from one screened set. */
export interface MarketOverview {
  breadth: Breadth;
  gainers: ScreenerRow[];
  losers: ScreenerRow[];
  mostActive: ScreenerRow[];
}

/** Notional (quote) volume, falling back to base volume, then 0. */
const vol = (r: ScreenerRow): number => r.quoteVolume ?? r.volume ?? 0;

/**
 * Count advancers / decliners / unchanged and the average 24h change.
 *
 * Rows with no reported change are counted separately and excluded from both
 * the ratio and the mean — they are not evidence of a flat symbol, and
 * averaging them in as 0 would drag the mean toward zero for free.
 */
export function computeBreadth(rows: ScreenerRow[]): Breadth {
  let advancers = 0;
  let decliners = 0;
  let unchanged = 0;
  let unknown = 0;
  let sum = 0;
  for (const r of rows) {
    const c = r.changePercent;
    if (c === null || !Number.isFinite(c)) {
      unknown += 1;
      continue;
    }
    if (c > 0) advancers += 1;
    else if (c < 0) decliners += 1;
    else unchanged += 1;
    sum += c;
  }
  const measured = advancers + decliners + unchanged;
  return {
    advancers,
    decliners,
    unchanged,
    unknown,
    total: rows.length,
    advancingPct: measured > 0 ? advancers / measured : 0,
    avgChange: measured > 0 ? sum / measured : null,
  };
}

/**
 * Fold a screened market set into the overview dashboard: the top movers by
 * 24h change (up and down), the most active by volume, and overall breadth.
 * Pure — the module fetches the set and renders the result.
 *
 * Rows with an unknown change are excluded from both mover lists rather than
 * sorted as if they were flat: a top-gainers board is a ranking claim, and an
 * unmeasured symbol cannot support one in either direction.
 */
export function buildOverview(rows: ScreenerRow[], topN = 8): MarketOverview {
  const measured = rows.filter((r): r is ScreenerRow & { changePercent: number } => r.changePercent !== null);
  const byChangeDesc = [...measured].sort((a, b) => b.changePercent - a.changePercent);
  const byChangeAsc = [...measured].sort((a, b) => a.changePercent - b.changePercent);
  const byVolDesc = [...rows].sort((a, b) => vol(b) - vol(a));
  return {
    breadth: computeBreadth(rows),
    gainers: byChangeDesc.slice(0, topN),
    losers: byChangeAsc.slice(0, topN),
    mostActive: byVolDesc.slice(0, topN),
  };
}
