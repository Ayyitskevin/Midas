/**
 * Rolling-Sharpe stability — how *consistent* a name's risk-adjusted edge is, not
 * just how high. We take the rolling-Sharpe series (the trailing annualized Sharpe
 * stepped through the sample) and reduce it to one ratio:
 *
 *     stability = mean(rolling Sharpe) / stdev(rolling Sharpe)
 *
 * It is the "Sharpe of the Sharpe series": a name whose rolling Sharpe sits
 * reliably above zero scores high, while one whose edge flickers — strong one
 * month, gone the next — scores low even if its average Sharpe is identical. High
 * and steady beats high and erratic. Reuses the rolling-Sharpe machinery (so the
 * underlying points line up with the RSHARPE board) and the shared mean & stdev.
 * Pure for unit testing.
 */

import { rollingSharpe } from './rollingSharpe';
import { mean, stdev } from './distribution';

export interface SharpeStabilityRow {
  symbol: string;
  /** mean ÷ stdev of the rolling-Sharpe series; null when it never varied or < 2 windows. */
  stability: number | null;
  /** Mean of the rolling-Sharpe series. */
  avgSharpe: number;
  /** Stdev of the rolling-Sharpe series (lower = steadier). */
  sdSharpe: number;
  /** Latest rolling Sharpe, for context. */
  current: number;
  /** Number of rolling windows. */
  n: number;
}

export type SharpeStabilitySort = 'stability' | 'avgSharpe' | 'sdSharpe' | 'symbol';

export interface SharpeStabilityInput {
  symbol: string;
  closes: number[];
}

/**
 * Rolling-Sharpe stability for one close series. Returns null when fewer than two
 * rolling windows fit (not enough history for the window). The stability ratio is
 * null when the rolling Sharpe never varied (zero dispersion — e.g. a perfectly
 * steady compounder or a flat series, which rolling Sharpe reports as a constant
 * 0), since the ratio's denominator is zero; the mean & stdev are still surfaced.
 */
export function computeSharpeStability(
  closes: number[],
  window: number,
  periodsPerYear = 365,
): Omit<SharpeStabilityRow, 'symbol'> | null {
  // rollingSharpe needs a parallel times array, but we only consume the Sharpe
  // values, so synthetic indices are fine here.
  const times = closes.map((_, i) => i);
  const rs = rollingSharpe(closes, times, window, periodsPerYear);
  if (rs.points.length < 2) return null; // need ≥ 2 windows to measure variability
  const sharpes = rs.points.map((p) => p.sharpe);
  const avgSharpe = mean(sharpes);
  const sdSharpe = stdev(sharpes);
  const stability = sdSharpe > 0 ? avgSharpe / sdSharpe : null;
  return { stability, avgSharpe, sdSharpe, current: sharpes[sharpes.length - 1], n: sharpes.length };
}

/** Rolling-Sharpe-stability board across a basket, sorted (default stability descending). */
export function sharpeStabilityBoard(
  series: SharpeStabilityInput[],
  window: number,
  periodsPerYear: number,
  sort: SharpeStabilitySort = 'stability',
): SharpeStabilityRow[] {
  const rows: SharpeStabilityRow[] = [];
  for (const s of series) {
    const r = computeSharpeStability(s.closes, window, periodsPerYear);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortSharpeStability(rows, sort);
}

export function sortSharpeStability(
  rows: SharpeStabilityRow[],
  sort: SharpeStabilitySort,
): SharpeStabilityRow[] {
  const lo = (v: number | null) => (v == null ? -Infinity : v); // null stability sinks last
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'avgSharpe':
        return b.avgSharpe - a.avgSharpe;
      case 'sdSharpe':
        return a.sdSharpe - b.sdSharpe; // steadiest (lowest dispersion) first
      case 'stability':
      default:
        return lo(b.stability) - lo(a.stability);
    }
  });
  return out;
}
