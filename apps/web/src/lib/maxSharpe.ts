/**
 * Maximum-Sharpe (tangency) portfolio optimizer — the sibling of the
 * minimum-variance optimizer (OPT). Where min-variance ignores expected returns
 * and only minimizes variance, the tangency portfolio is the fully-invested
 * book with the highest risk-adjusted return (Sharpe ratio): the point where a
 * line from the risk-free rate is tangent to the efficient frontier. Its
 * closed form is
 *
 *     w = Σ⁻¹·(μ − rf·1) / (1ᵀ·Σ⁻¹·(μ − rf·1))
 *
 * where μ is the vector of mean returns and rf the per-period risk-free rate
 * (0 by default — crypto has no obvious risk-free leg). Weights sum to 1 and may
 * go negative (a short leg). It reuses the covariance matrix, Gauss-Jordan
 * inversion and portfolio-variance helpers built for the min-variance tool, so
 * only the expected-return layer is new here.
 *
 * Pure (no React/DOM) and unit-tested against analytically-known cases. When Σ
 * can't be inverted, or no positive-Sharpe tangent exists (1ᵀΣ⁻¹(μ−rf) ≤ 0, e.g.
 * a basket whose minimum-variance return is itself negative), we degrade to
 * equal weights and flag `ok: false`.
 */

import { toReturns } from './correlation';
import { mean, stdev } from './distribution';
import { invertMatrix, covarianceMatrix, portfolioVariance } from './minVariance';

export interface MaxSharpeInput {
  symbol: string;
  closes: number[];
}

export interface MaxSharpeRow {
  symbol: string;
  /** Mean daily return (the μ estimate). */
  meanRet: number;
  /** Daily return standard deviation (population). */
  vol: number;
  /** Per-asset daily Sharpe, (meanRet − rf) / vol. */
  sharpe: number;
  /** Tangency weight; sums to 1 across rows, may be negative (short). */
  weight: number;
  /** Naive 1/N weight, for comparison. */
  equalWeight: number;
}

export interface MaxSharpeResult {
  /** Priced rows, sorted by tangency weight descending. */
  rows: MaxSharpeRow[];
  /** Number of usable assets. */
  n: number;
  /** Number of aligned return observations used. */
  obs: number;
  /** Daily expected return of the tangency book, wᵀμ. */
  portReturn: number;
  /** Daily volatility of the tangency book. */
  portVol: number;
  /** Daily Sharpe of the tangency book, (portReturn − rf) / portVol. */
  portSharpe: number;
  /** Daily Sharpe of the equal-weight book, for comparison. */
  equalSharpe: number;
  /** Per-period risk-free rate used. */
  rf: number;
  /** True when Σ inverted and a positive-Sharpe tangency exists. */
  ok: boolean;
  /** True when any tangency weight is negative (implies a short leg). */
  hasShort: boolean;
}

const empty = (rf: number): MaxSharpeResult => ({
  rows: [],
  n: 0,
  obs: 0,
  portReturn: 0,
  portVol: 0,
  portSharpe: 0,
  equalSharpe: 0,
  rf,
  ok: false,
  hasShort: false,
});

/**
 * Tangency weights from a covariance matrix and a vector of excess returns
 * (μ − rf·1): w = Σ⁻¹·excess / (1ᵀ·Σ⁻¹·excess). Returns null when Σ is singular
 * or the normalizing scalar 1ᵀΣ⁻¹·excess is not strictly positive (no
 * positively-sloped tangent). Weights sum to 1 by construction.
 */
export function tangencyWeights(cov: number[][], excess: number[]): number[] | null {
  const inv = invertMatrix(cov);
  if (!inv) return null;
  // z = Σ⁻¹·excess
  const z = inv.map((row) => row.reduce((acc, x, j) => acc + x * excess[j], 0));
  let denom = 0;
  for (const v of z) denom += v;
  if (!Number.isFinite(denom) || denom <= 1e-12) return null;
  return z.map((v) => v / denom);
}

/**
 * Maximum-Sharpe (tangency) weights across a basket of price series. Symbols are
 * aligned to a common tail window, turned into daily returns, and any
 * flat/too-short series is dropped. When the tangency portfolio can't be formed
 * we degrade to equal weights and flag `ok: false`. `rf` is the per-period
 * risk-free rate (default 0).
 */
export function maxSharpe(series: MaxSharpeInput[], rf = 0): MaxSharpeResult {
  // Need at least 3 closes (→ 2 returns) for a defined volatility.
  const long = series.filter((s) => s.closes.length >= 3);
  if (long.length === 0) return empty(rf);

  const L = Math.min(...long.map((s) => s.closes.length));

  const kept: { symbol: string; rets: number[]; meanRet: number; vol: number }[] = [];
  for (const s of long) {
    const tail = s.closes.slice(s.closes.length - L);
    const rets = toReturns(tail);
    const vol = stdev(rets);
    if (vol > 0) kept.push({ symbol: s.symbol, rets, meanRet: mean(rets), vol });
  }
  const n = kept.length;
  if (n === 0) return empty(rf);

  const obs = kept[0].rets.length;
  const cov = covarianceMatrix(kept.map((k) => k.rets));
  const mu = kept.map((k) => k.meanRet);
  const excess = mu.map((m) => m - rf);

  const tan = tangencyWeights(cov, excess);
  const ok = tan !== null;
  const equalW = new Array<number>(n).fill(1 / n);
  const w = tan ?? equalW;

  const dot = (a: number[], b: number[]) => a.reduce((acc, x, i) => acc + x * b[i], 0);
  const portReturn = dot(w, mu);
  const portVol = Math.sqrt(portfolioVariance(cov, w));
  const portSharpe = portVol > 0 ? (portReturn - rf) / portVol : 0;

  const eqReturn = dot(equalW, mu);
  const eqVol = Math.sqrt(portfolioVariance(cov, equalW));
  const equalSharpe = eqVol > 0 ? (eqReturn - rf) / eqVol : 0;

  const rows: MaxSharpeRow[] = kept.map((k, i) => ({
    symbol: k.symbol,
    meanRet: k.meanRet,
    vol: k.vol,
    sharpe: (k.meanRet - rf) / k.vol,
    weight: w[i],
    equalWeight: 1 / n,
  }));
  const hasShort = rows.some((r) => r.weight < 0);
  rows.sort((a, b) => b.weight - a.weight);

  return { rows, n, obs, portReturn, portVol, portSharpe, equalSharpe, rf, ok, hasShort };
}
