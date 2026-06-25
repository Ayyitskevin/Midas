/**
 * Diversification Ratio (Choueifaty & Coignard) — one number for how much of the
 * individual names' risk actually cancels out in the book. It is the weighted
 * average of the single-asset volatilities divided by the portfolio's own
 * volatility:
 *
 *     DR = (Σ wᵢ σᵢ) / √(wᵀΣw)
 *
 * If everything moved together (correlation 1) the portfolio vol would equal the
 * weighted-average vol and DR = 1 — no diversification. The more the names zig
 * while others zag, the lower the portfolio vol falls below the average and the
 * higher DR climbs. DR² is the "number of effective bets": two perfectly
 * uncorrelated equal-risk names give DR = √2 and ≈ 2 independent bets.
 *
 * This panel scores the equal-weight watchlist book. Reuses the covariance
 * matrix and quadratic-form helpers built for the optimizers. Pure for testing.
 */

import { toReturns } from './correlation';
import { stdev } from './distribution';
import { covarianceMatrix, portfolioVariance } from './minVariance';

export interface DivInput {
  symbol: string;
  closes: number[];
}

export interface DivAsset {
  symbol: string;
  /** Daily return volatility. */
  vol: number;
  /** Weight in the analysed book (equal-weight). */
  weight: number;
}

export interface DivResult {
  /** Per-asset vol and weight, sorted by volatility descending. */
  assets: DivAsset[];
  n: number;
  obs: number;
  /** Weighted average of the single-asset vols, Σ wᵢ σᵢ (daily). */
  weightedAvgVol: number;
  /** Portfolio volatility, √(wᵀΣw) (daily). */
  portVol: number;
  /** Diversification ratio (≥ 1), or null when the book carries no risk. */
  divRatio: number | null;
  /** Number of effective independent bets, DR². */
  effectiveBets: number | null;
  ok: boolean;
}

const EMPTY: DivResult = {
  assets: [],
  n: 0,
  obs: 0,
  weightedAvgVol: 0,
  portVol: 0,
  divRatio: null,
  effectiveBets: null,
  ok: false,
};

/**
 * Diversification ratio for explicit weights, per-asset vols and a covariance
 * matrix: (Σ wᵢ σᵢ) / √(wᵀΣw). Returns null when the dimensions disagree or the
 * portfolio volatility is zero.
 */
export function divRatio(
  weights: number[],
  vols: number[],
  cov: number[][],
): { weightedAvgVol: number; portVol: number; ratio: number } | null {
  const n = weights.length;
  if (n === 0 || vols.length !== n || cov.length !== n) return null;
  let weightedAvgVol = 0;
  for (let i = 0; i < n; i++) weightedAvgVol += weights[i] * vols[i];
  const portVol = Math.sqrt(portfolioVariance(cov, weights));
  if (portVol <= 0) return null;
  return { weightedAvgVol, portVol, ratio: weightedAvgVol / portVol };
}

/**
 * Diversification ratio of the equal-weight watchlist book. Symbols are aligned
 * to a common tail window, turned into daily returns, and any flat/too-short
 * series is dropped. Returns the headline ratio, the effective number of bets
 * (DR²) and the per-asset vols/weights.
 */
export function diversification(series: DivInput[]): DivResult {
  const long = series.filter((s) => s.closes.length >= 3);
  if (long.length === 0) return EMPTY;

  const L = Math.min(...long.map((s) => s.closes.length));

  const kept: { symbol: string; rets: number[]; vol: number }[] = [];
  for (const s of long) {
    const tail = s.closes.slice(s.closes.length - L);
    const rets = toReturns(tail);
    const vol = stdev(rets);
    if (vol > 0) kept.push({ symbol: s.symbol, rets, vol });
  }
  const n = kept.length;
  if (n === 0) return EMPTY;

  const obs = kept[0].rets.length;
  const cov = covarianceMatrix(kept.map((k) => k.rets));
  const weights = new Array<number>(n).fill(1 / n);
  const vols = kept.map((k) => k.vol);

  const dr = divRatio(weights, vols, cov);
  const assets: DivAsset[] = kept
    .map((k) => ({ symbol: k.symbol, vol: k.vol, weight: 1 / n }))
    .sort((a, b) => b.vol - a.vol);

  if (!dr) {
    return { ...EMPTY, assets, n, obs };
  }
  return {
    assets,
    n,
    obs,
    weightedAvgVol: dr.weightedAvgVol,
    portVol: dr.portVol,
    divRatio: dr.ratio,
    effectiveBets: dr.ratio * dr.ratio,
    ok: true,
  };
}
