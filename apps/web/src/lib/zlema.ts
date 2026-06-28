/**
 * Zero-Lag EMA (ZLEMA) screener helpers.
 *
 * John Ehlers & Ric Way's Zero-Lag EMA removes most of an EMA's lag by feeding it
 * a de-lagged input: the current price plus the momentum it has shown over half
 * the period, then EMA-smoothed:
 *
 *   lag        = floor((period − 1) / 2)
 *   deLagged[i] = price[i] + (price[i] − price[i − lag])  =  2·price[i] − price[i − lag]
 *   ZLEMA      = EMA(deLagged, period)
 *
 * Default period 14 (lag 6). Adding the (price − price[lag]) term shifts the line
 * forward in time, cancelling the bulk of the EMA's delay while keeping its
 * smoothing — a fast, low-lag trend line.
 *
 * ZLEMA is a price-unit line, so the raw value is not comparable across symbols;
 * the board reports the scale-invariant slope of the line (slopePct) and the
 * price's percent distance from it (distPct) — the same convention as the Hull /
 * ALMA / McGinley / VIDYA boards. Reuses the repo's first-value-seeded `emaSeries`.
 *
 * Pure and synchronous.
 */

import { emaSeries } from './indicators';

/**
 * ZLEMA aligned to the input series: indices < lag are NaN (the de-lagged input
 * needs price[i − lag]).
 */
export function zlemaSeries(closes: number[], period = 14): number[] {
  const n = closes.length;
  const out = new Array<number>(n).fill(NaN);
  const lag = Math.floor((period - 1) / 2);
  if (period < 1 || n <= lag) return out;

  const deLagged: number[] = [];
  for (let i = lag; i < n; i++) deLagged.push(2 * closes[i] - closes[i - lag]);

  const ema = emaSeries(deLagged, period);
  for (let j = 0; j < ema.length; j++) out[lag + j] = ema[j];
  return out;
}

export type ZlemaDir = 'up' | 'down' | 'flat';

export interface ZlemaStats {
  /** Latest ZLEMA line value (price units — not for cross-symbol ranking). */
  zlema: number;
  /** Slope of the line: 100·(zlema − zlemaPrev) / zlemaPrev (scale-invariant). */
  slopePct: number;
  /** Price distance from the line: 100·(close − zlema) / zlema (scale-invariant). */
  distPct: number;
  /** Trend direction from the slope sign. */
  dir: ZlemaDir;
  /** Number of bars supplied. */
  n: number;
}

export interface ZlemaRow extends ZlemaStats {
  symbol: string;
}

export type ZlemaSort = 'slope' | 'dist' | 'symbol';

/**
 * Compute the latest ZLEMA reading for one symbol. Needs at least lag + period + 1
 * closes so the EMA has warmed and a prior bar exists; returns null on bad params
 * or too little history.
 */
export function computeZlema(closes: number[], period = 14): ZlemaStats | null {
  const n = closes.length;
  const lag = Math.floor((period - 1) / 2);
  if (period < 1 || n < lag + period + 1) return null;

  const series = zlemaSeries(closes, period);
  const zlema = series[n - 1];
  const zlemaPrev = series[n - 2];
  if (!Number.isFinite(zlema) || !Number.isFinite(zlemaPrev) || zlema === 0 || zlemaPrev === 0) return null;

  const close = closes[n - 1];
  const slopePct = (100 * (zlema - zlemaPrev)) / zlemaPrev;
  const distPct = (100 * (close - zlema)) / zlema;
  const dir: ZlemaDir = slopePct > 0 ? 'up' : slopePct < 0 ? 'down' : 'flat';

  return { zlema, slopePct, distPct, dir, n };
}

/** Build a sorted per-symbol ZLEMA board, skipping symbols with too little history. */
export function zlemaBoard(
  series: { symbol: string; closes: number[] }[],
  sort: ZlemaSort = 'slope',
  period = 14,
): ZlemaRow[] {
  const rows: ZlemaRow[] = [];
  for (const s of series) {
    const stats = computeZlema(s.closes, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortZlema(rows, sort);
}

export function sortZlema(rows: ZlemaRow[], sort: ZlemaSort): ZlemaRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'dist':
      out.sort((a, b) => b.distPct - a.distPct);
      break;
    case 'slope':
    default:
      out.sort((a, b) => b.slopePct - a.slopePct);
      break;
  }
  return out;
}
