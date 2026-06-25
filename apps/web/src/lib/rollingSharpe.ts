/**
 * Rolling Sharpe — the trailing annualized risk-adjusted return as it evolves
 * over time, rather than a single number for the whole sample. A static Sharpe
 * hides regime change; the rolling view shows when a name's risk-adjusted
 * performance was strong, when it decayed, and how stable the edge is.
 *
 * For each step we take the trailing `window` simple returns and reuse the same
 * annualized Sharpe (mean / σ · √periodsPerYear) the static board uses, so the
 * latest rolling point lines up with the SHARPE board. Pure for unit testing.
 */

import { toReturns } from './correlation';
import { computeRatios } from './sharpe';

export interface RollingSharpePoint {
  /** Timestamp of the candle at the end of the window. */
  time: number;
  /** Annualized Sharpe over the trailing window. */
  sharpe: number;
}

export interface RollingSharpe {
  points: RollingSharpePoint[];
  /** Most recent rolling Sharpe, or null when there are no points. */
  current: number | null;
  /** Mean of the rolling Sharpe series. */
  avg: number | null;
  min: number | null;
  max: number | null;
}

const EMPTY: RollingSharpe = { points: [], current: null, avg: null, min: null, max: null };

/**
 * Rolling annualized Sharpe across a close/time series. `closes` and `times` are
 * parallel (times[i] is the timestamp of closes[i]); a point is stamped with the
 * time of the last candle in its window. A flat window (σ = 0) contributes a
 * Sharpe of 0. Returns an empty result when the window can't be filled.
 */
export function rollingSharpe(
  closes: number[],
  times: number[],
  window: number,
  periodsPerYear = 365,
): RollingSharpe {
  const w = Math.floor(window);
  const len = Math.min(closes.length, times.length);
  if (w < 2 || len < w + 1) return EMPTY;

  const returns = toReturns(closes.slice(0, len));
  if (returns.length < w) return EMPTY;

  const points: RollingSharpePoint[] = [];
  for (let j = w - 1; j < returns.length; j++) {
    const slice = returns.slice(j - w + 1, j + 1);
    const s = computeRatios(slice, periodsPerYear).sharpe;
    // returns[j] is the move into candle j+1 — stamp the point there.
    points.push({ time: times[j + 1], sharpe: s ?? 0 });
  }
  if (points.length === 0) return EMPTY;

  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    sum += p.sharpe;
    if (p.sharpe < min) min = p.sharpe;
    if (p.sharpe > max) max = p.sharpe;
  }
  return {
    points,
    current: points[points.length - 1].sharpe,
    avg: sum / points.length,
    min,
    max,
  };
}
