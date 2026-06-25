/**
 * Tail ratio — a one-glance read on whether a name's *extreme* moves favour the
 * upside or the downside. It divides the magnitude of the right tail (the 95th
 * percentile return) by the magnitude of the left tail (the 5th percentile):
 *
 *     tail ratio = |p95| / |p5|
 *
 * A ratio of 1 means symmetric tails; above 1 the big up-days outrun the big
 * down-days (a fat right tail), below 1 the crashes are larger than the rips. It
 * looks only at the wings of the distribution, so it complements the variance-
 * and drawdown-based measures, which are dominated by the body.
 *
 * Reuses the shared interpolated quantile, simple returns and mean. Pure for
 * unit testing.
 */

import { toReturns } from './correlation';
import { mean, quantile } from './distribution';

export interface TailRow {
  symbol: string;
  /** |p95| / |p5|; null when the left tail is zero (no downside dispersion). */
  tailRatio: number | null;
  /** 95th-percentile return (right tail). */
  p95: number;
  /** 5th-percentile return (left tail). */
  p5: number;
  /** Mean period return, for context. */
  meanRet: number;
  /** Returns used. */
  n: number;
}

export type TailSort = 'tailRatio' | 'p95' | 'p5' | 'symbol';

export interface TailInput {
  symbol: string;
  closes: number[];
}

/**
 * Tail-ratio stats for one close series. Returns null with fewer than three
 * closes. When the 5th-percentile return is zero (no left-tail dispersion) the
 * ratio is undefined and reported as null.
 */
export function computeTail(closes: number[]): Omit<TailRow, 'symbol'> | null {
  if (closes.length < 3) return null;
  const returns = toReturns(closes);
  const p95 = quantile(returns, 0.95);
  const p5 = quantile(returns, 0.05);
  const denom = Math.abs(p5);
  const tailRatio = denom > 0 ? Math.abs(p95) / denom : null;
  return { tailRatio, p95, p5, meanRet: mean(returns), n: returns.length };
}

/** Tail-ratio board across a basket, sorted (default tail ratio descending). */
export function tailBoard(series: TailInput[], sort: TailSort = 'tailRatio'): TailRow[] {
  const rows: TailRow[] = [];
  for (const s of series) {
    const r = computeTail(s.closes);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortTail(rows, sort);
}

export function sortTail(rows: TailRow[], sort: TailSort): TailRow[] {
  // A null tail ratio means a degenerate (flat) distribution — uninformative —
  // so it sorts to the bottom under the ratio column.
  const lo = (v: number | null) => (v == null ? -Infinity : v);
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'p95':
        return b.p95 - a.p95;
      case 'p5':
        return a.p5 - b.p5; // most-negative left tail first
      case 'tailRatio':
      default:
        return lo(b.tailRatio) - lo(a.tailRatio);
    }
  });
  return out;
}
