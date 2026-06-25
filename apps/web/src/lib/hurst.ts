/**
 * Hurst exponent via rescaled-range (R/S) analysis — a regime fingerprint for a
 * price series. H ≈ 0.5 is a random walk; H > 0.5 is persistent (trends tend to
 * continue, momentum); H < 0.5 is anti-persistent (moves tend to reverse, mean
 * reversion).
 *
 * R/S analysis: split the return series into non-overlapping chunks of size n,
 * and for each chunk take the range of its cumulative mean-deviation divided by
 * its standard deviation (R/S). Averaged over chunks, (R/S)ₙ scales like n^H, so
 * regressing log(R/S) on log(n) across a ladder of window sizes gives H as the
 * slope. Reuses the shared OLS regression and population stats. Pure for testing.
 */

import { mean, stdev } from './distribution';
import { regress } from './scatter';

export type HurstRegime = 'trending' | 'meanrev' | 'random';

export interface HurstResult {
  /** Estimated Hurst exponent (regression slope of log R/S vs log n). */
  hurst: number;
  regime: HurstRegime;
  /** Goodness of fit of the log-log regression. */
  r2: number;
  /** The (log n, log R/S) ladder used, for plotting/inspection. */
  points: { n: number; logN: number; logRS: number }[];
  /** Number of returns analyzed. */
  n: number;
}

export interface HurstInput {
  symbol: string;
  closes: number[];
}

export interface HurstRow extends HurstResult {
  symbol: string;
}

export type HurstSort = 'hurst' | 'r2' | 'symbol';

function classify(h: number): HurstRegime {
  if (h > 0.55) return 'trending';
  if (h < 0.45) return 'meanrev';
  return 'random';
}

/** Mean rescaled range (R/S) over non-overlapping chunks of size n; null if none usable. */
function rescaledRange(returns: number[], n: number): number | null {
  const chunks = Math.floor(returns.length / n);
  if (chunks < 1) return null;
  let sum = 0;
  let count = 0;
  for (let c = 0; c < chunks; c++) {
    const slice = returns.slice(c * n, (c + 1) * n);
    const m = mean(slice);
    let cum = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of slice) {
      cum += x - m;
      if (cum < lo) lo = cum;
      if (cum > hi) hi = cum;
    }
    const R = hi - lo;
    const S = stdev(slice);
    if (S > 0 && R > 0) {
      sum += R / S;
      count += 1;
    }
  }
  return count > 0 ? sum / count : null;
}

/** Log returns from a close series, skipping non-positive prices. */
function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1];
    const b = closes[i];
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
}

/**
 * Estimate the Hurst exponent of a return series. Builds a doubling ladder of
 * window sizes from `minWindow` up to half the series and regresses log(R/S) on
 * log(n). Returns null when there isn't enough data for at least two windows.
 */
export function hurstExponent(returns: number[], minWindow = 8): HurstResult | null {
  const len = returns.length;
  const maxWindow = Math.floor(len / 2);
  if (minWindow < 2 || maxWindow < minWindow) return null;

  const xs: number[] = [];
  const ys: number[] = [];
  const points: { n: number; logN: number; logRS: number }[] = [];
  for (let n = minWindow; n <= maxWindow; n *= 2) {
    const rs = rescaledRange(returns, n);
    if (rs != null && rs > 0) {
      const logN = Math.log(n);
      const logRS = Math.log(rs);
      xs.push(logN);
      ys.push(logRS);
      points.push({ n, logN, logRS });
    }
  }
  if (xs.length < 2) return null;
  const reg = regress(xs, ys);
  if (!reg) return null;

  const hurst = reg.slope;
  return {
    hurst,
    regime: classify(hurst),
    r2: Number.isFinite(reg.r2) ? reg.r2 : 0,
    points,
    n: len,
  };
}

/** Hurst board across several close series (log returns), sorted (default H desc). */
export function hurstBoard(series: HurstInput[], sort: HurstSort = 'hurst', minWindow = 8): HurstRow[] {
  const rows: HurstRow[] = [];
  for (const s of series) {
    const h = hurstExponent(logReturns(s.closes), minWindow);
    if (h) rows.push({ symbol: s.symbol, ...h });
  }
  return sortHurst(rows, sort);
}

export function sortHurst(rows: HurstRow[], sort: HurstSort): HurstRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'r2':
        return b.r2 - a.r2;
      case 'hurst':
      default:
        return b.hurst - a.hurst;
    }
  });
  return out;
}
