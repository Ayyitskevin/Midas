/**
 * Average pairwise correlation over time — a market-regime gauge for a basket.
 * When correlation across names rises toward 1 everything is moving together
 * (a risk-off, macro-driven tape where diversification quietly disappears);
 * when it falls, names disperse and idiosyncratic selection matters again.
 *
 * For each step we take a trailing window of returns and average the Pearson
 * correlation of every distinct pair, producing a single time series. Reuses the
 * shared Pearson (which returns 0 for a flat series and clamps to ±1). Pure for
 * unit testing.
 */

import { pearson } from './correlation';

export interface AvgCorrPoint {
  /** Timestamp at the end of the window. */
  time: number;
  /** Mean of all pairwise correlations over the window. */
  avg: number;
  /** Number of pairs averaged. */
  pairs: number;
}

export interface AvgCorrelation {
  points: AvgCorrPoint[];
  /** Most recent average correlation, or null when there are no points. */
  current: number | null;
  /** Mean of the series. */
  mean: number | null;
  min: number | null;
  max: number | null;
}

const EMPTY: AvgCorrelation = { points: [], current: null, mean: null, min: null, max: null };

/**
 * Rolling average pairwise correlation across aligned return series. Each entry
 * of `seriesReturns` is one symbol's returns; `times[i]` stamps column i. Needs
 * at least two symbols and a window that fits the common length, else an empty
 * result.
 */
export function avgCorrelation(
  seriesReturns: number[][],
  times: number[],
  window: number,
): AvgCorrelation {
  const m = seriesReturns.length;
  const w = Math.floor(window);
  if (m < 2 || w < 2) return EMPTY;
  const len = Math.min(times.length, ...seriesReturns.map((s) => s.length));
  if (len < w) return EMPTY;

  const points: AvgCorrPoint[] = [];
  for (let j = w - 1; j < len; j++) {
    const lo = j - w + 1;
    let sum = 0;
    let count = 0;
    for (let a = 0; a < m; a++) {
      const sa = seriesReturns[a].slice(lo, j + 1);
      for (let b = a + 1; b < m; b++) {
        const r = pearson(sa, seriesReturns[b].slice(lo, j + 1));
        if (Number.isFinite(r)) {
          sum += r;
          count += 1;
        }
      }
    }
    if (count > 0) points.push({ time: times[j], avg: sum / count, pairs: count });
  }
  if (points.length === 0) return EMPTY;

  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    sum += p.avg;
    if (p.avg < min) min = p.avg;
    if (p.avg > max) max = p.avg;
  }
  return {
    points,
    current: points[points.length - 1].avg,
    mean: sum / points.length,
    min,
    max,
  };
}
