/**
 * Rolling beta / correlation of an asset versus a benchmark: the static beta
 * (see ./beta) recomputed over a sliding window of returns so you can see how
 * the relationship drifts through time. Pure for unit testing.
 */

import { computeBeta } from './beta';

export interface RollingBetaPoint {
  /** Index in the aligned return series (the window's last point). */
  index: number;
  beta: number;
  correlation: number;
}

/**
 * Beta & correlation over each trailing `window` of returns. Emits a point for
 * every window from the first complete one onward; a degenerate window (flat
 * benchmark) is skipped.
 */
export function rollingBeta(
  assetReturns: number[],
  benchReturns: number[],
  window: number,
): RollingBetaPoint[] {
  const out: RollingBetaPoint[] = [];
  if (window < 2) return out;
  const n = Math.min(assetReturns.length, benchReturns.length);
  for (let i = window - 1; i < n; i++) {
    const a = assetReturns.slice(i - window + 1, i + 1);
    const b = benchReturns.slice(i - window + 1, i + 1);
    const stat = computeBeta(a, b);
    if (stat) out.push({ index: i, beta: stat.beta, correlation: stat.correlation });
  }
  return out;
}

/** Mean of a numeric field across the rolling points (0 when empty). */
export function meanOf(points: RollingBetaPoint[], pick: (p: RollingBetaPoint) => number): number {
  if (points.length === 0) return 0;
  let s = 0;
  for (const p of points) s += pick(p);
  return s / points.length;
}
