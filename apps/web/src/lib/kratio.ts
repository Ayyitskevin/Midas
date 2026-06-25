/**
 * K-ratio (Lars Kestner) — how *steady* a price's climb is, rather than how big.
 * It fits a straight line to the cumulative log-price against time and takes the
 * slope divided by that slope's standard error:
 *
 *     K = slope(log close vs t) / SE(slope)
 *
 * which is exactly the trend's t-statistic — how many standard errors the uptrend
 * sits above flat. A name that grinds up a tight line scores far higher than one
 * that reaches the same place through wild swings, even at identical total
 * return. It rewards persistence and penalizes jaggedness, a complement to the
 * return- and drawdown-based ratios.
 *
 * Reuses the shared OLS regression for the slope/fit; the slope's standard error
 * (s / √Sxx with s² = SSE/(n−2)) is computed here from the residuals. Pure for
 * unit testing.
 */

import { regress } from './scatter';

export interface KRow {
  symbol: string;
  /** Trend t-stat: slope ÷ SE(slope). Null for a degenerate/perfect-line fit. */
  kratio: number | null;
  /** Slope of log(close) vs bar index — the per-bar log-trend. */
  slope: number;
  /** R² of the log-price trend fit (0–1). */
  rsq: number;
  /** Points used. */
  n: number;
}

export type KSort = 'kratio' | 'slope' | 'symbol';

export interface KInput {
  symbol: string;
  closes: number[];
}

/**
 * K-ratio for one close series. Regresses log(close) on the bar index and
 * divides the slope by its standard error. Returns null with fewer than three
 * positive closes (need n−2 ≥ 1 degrees of freedom) or when the fit is
 * numerically perfect (zero residual error → undefined t-stat).
 */
export function computeKRatio(closes: number[]): Omit<KRow, 'symbol'> | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    if (c > 0) {
      xs.push(i);
      ys.push(Math.log(c));
    }
  }
  const n = xs.length;
  if (n < 3) return null;

  const reg = regress(xs, ys);
  if (!reg) return null;
  const { slope, intercept, r2 } = reg;

  // Residual sum of squares and Sxx for the slope's standard error.
  let mx = 0;
  for (const x of xs) mx += x;
  mx /= n;
  let sse = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const e = ys[i] - (intercept + slope * xs[i]);
    sse += e * e;
    const dx = xs[i] - mx;
    sxx += dx * dx;
  }
  if (sxx <= 0) return null;
  const seSlope = Math.sqrt(sse / (n - 2) / sxx);
  // A numerically-perfect line has ~zero residual error → the t-stat blows up;
  // treat it as undefined rather than reporting an fp-dependent giant number.
  const kratio = seSlope > 1e-9 ? slope / seSlope : null;
  return { kratio, slope, rsq: r2, n };
}

/** K-ratio board across a basket, sorted (default K-ratio descending). */
export function kratioBoard(series: KInput[], sort: KSort = 'kratio'): KRow[] {
  const rows: KRow[] = [];
  for (const s of series) {
    const r = computeKRatio(s.closes);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortKratio(rows, sort);
}

export function sortKratio(rows: KRow[], sort: KSort): KRow[] {
  const lo = (v: number | null) => (v == null ? -Infinity : v);
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'slope':
        return b.slope - a.slope;
      case 'kratio':
      default:
        return lo(b.kratio) - lo(a.kratio); // steadiest climbers first
    }
  });
  return out;
}
