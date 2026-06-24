import type { ScreenerRow } from '@midas/shared';

/** Advance/decline summary across a screened market set. */
export interface Breadth {
  advancers: number;
  decliners: number;
  unchanged: number;
  total: number;
  /** Fraction of the set that is up on the day, 0–1 (0 when empty). */
  advancingPct: number;
  /** Mean 24h change across the set, in percent (0 when empty). */
  avgChange: number;
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

/** Count advancers / decliners / unchanged and the average 24h change. */
export function computeBreadth(rows: ScreenerRow[]): Breadth {
  let advancers = 0;
  let decliners = 0;
  let unchanged = 0;
  let sum = 0;
  for (const r of rows) {
    const c = Number.isFinite(r.changePercent) ? r.changePercent : 0;
    if (c > 0) advancers += 1;
    else if (c < 0) decliners += 1;
    else unchanged += 1;
    sum += c;
  }
  const total = rows.length;
  return {
    advancers,
    decliners,
    unchanged,
    total,
    advancingPct: total > 0 ? advancers / total : 0,
    avgChange: total > 0 ? sum / total : 0,
  };
}

/**
 * Fold a screened market set into the overview dashboard: the top movers by
 * 24h change (up and down), the most active by volume, and overall breadth.
 * Pure — the module fetches the set and renders the result.
 */
export function buildOverview(rows: ScreenerRow[], topN = 8): MarketOverview {
  const byChangeDesc = [...rows].sort((a, b) => b.changePercent - a.changePercent);
  const byChangeAsc = [...rows].sort((a, b) => a.changePercent - b.changePercent);
  const byVolDesc = [...rows].sort((a, b) => vol(b) - vol(a));
  return {
    breadth: computeBreadth(rows),
    gainers: byChangeDesc.slice(0, topN),
    losers: byChangeAsc.slice(0, topN),
    mostActive: byVolDesc.slice(0, topN),
  };
}
