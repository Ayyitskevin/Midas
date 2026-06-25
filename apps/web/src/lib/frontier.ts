/**
 * Markowitz efficient frontier — the visual capstone that ties the
 * minimum-variance (OPT) and maximum-Sharpe (MSR) optimizers together. For an
 * unconstrained, fully-invested book the set of minimum-variance portfolios at
 * each target return traces a hyperbola in (volatility, return) space. Using the
 * classic scalars built from the inverse covariance matrix,
 *
 *     A = 1ᵀΣ⁻¹1,  B = 1ᵀΣ⁻¹μ,  C = μᵀΣ⁻¹μ,  D = A·C − B²,
 *
 * the frontier volatility at a target return m is
 *
 *     σ(m) = √((A·m² − 2·B·m + C) / D),
 *
 * the global minimum-variance portfolio sits at (√(1/A), B/A), and — with a zero
 * risk-free rate — the tangency (max-Sharpe) portfolio sits at (√C/B, C/B) with
 * Sharpe √C. We reuse the covariance matrix and Gauss-Jordan inversion built for
 * OPT, so only the frontier algebra is new here.
 *
 * Pure (no React/DOM) and unit-tested against analytically-known cases.
 */

import { toReturns } from './correlation';
import { mean, stdev } from './distribution';
import { invertMatrix, covarianceMatrix, portfolioVariance } from './minVariance';

export interface FrontierInput {
  symbol: string;
  closes: number[];
}

/** A point in (daily volatility, daily return) space. */
export interface FrontierPoint {
  ret: number;
  vol: number;
}

export interface AssetPoint extends FrontierPoint {
  symbol: string;
}

export interface FrontierResult {
  /** Sampled frontier hyperbola, ascending by return (empty when degenerate). */
  curve: FrontierPoint[];
  /** Individual assets (mean return, own volatility). */
  assets: AssetPoint[];
  /** Global minimum-variance portfolio, or null when Σ is singular. */
  gmv: FrontierPoint | null;
  /** Tangency (max-Sharpe, rf=0) portfolio, or null when undefined (B ≤ 0). */
  tangency: FrontierPoint | null;
  /** Equal-weight book, or null when no usable assets. */
  equal: FrontierPoint | null;
  /** Daily Sharpe of the tangency portfolio (√C), 0 when undefined. */
  maxSharpe: number;
  /** Number of usable assets. */
  n: number;
  /** Number of aligned return observations used. */
  obs: number;
  /** True when the frontier is non-degenerate (Σ invertible and D > 0). */
  ok: boolean;
}

export interface FrontierStats {
  A: number;
  B: number;
  C: number;
  D: number;
}

const EPS = 1e-12;

const empty = (): FrontierResult => ({
  curve: [],
  assets: [],
  gmv: null,
  tangency: null,
  equal: null,
  maxSharpe: 0,
  n: 0,
  obs: 0,
  ok: false,
});

/**
 * The frontier scalars A, B, C, D from a covariance matrix and mean-return
 * vector. Returns null when Σ can't be inverted.
 */
export function frontierStats(cov: number[][], mu: number[]): FrontierStats | null {
  const inv = invertMatrix(cov);
  if (!inv) return null;
  // Σ⁻¹·1 (row sums) and Σ⁻¹·μ.
  const invOnes = inv.map((row) => row.reduce((acc, x) => acc + x, 0));
  const invMu = inv.map((row) => row.reduce((acc, x, j) => acc + x * mu[j], 0));
  let A = 0;
  let B = 0;
  let C = 0;
  for (let i = 0; i < mu.length; i++) {
    A += invOnes[i];
    B += invMu[i];
    C += mu[i] * invMu[i];
  }
  return { A, B, C, D: A * C - B * B };
}

/** Frontier volatility at a target return m: √((A·m² − 2·B·m + C) / D). */
export function frontierVol(st: FrontierStats, m: number): number {
  if (st.D <= 0) return 0;
  const v2 = (st.A * m * m - 2 * st.B * m + st.C) / st.D;
  return v2 > 0 ? Math.sqrt(v2) : 0;
}

/**
 * Build the efficient frontier for a basket of price series. Symbols are aligned
 * to a common tail window, turned into daily returns, and any flat/too-short
 * series is dropped. The curve is sampled symmetrically around the GMV return so
 * both the efficient (upper) and inefficient (lower) branches are drawn; markers
 * for the GMV, tangency and equal-weight books plus each asset are returned in
 * the same daily (vol, return) units. `samples` controls curve resolution.
 */
export function frontier(series: FrontierInput[], samples = 61): FrontierResult {
  const long = series.filter((s) => s.closes.length >= 3);
  if (long.length === 0) return empty();

  const L = Math.min(...long.map((s) => s.closes.length));

  const kept: { symbol: string; rets: number[]; mu: number; vol: number }[] = [];
  for (const s of long) {
    const tail = s.closes.slice(s.closes.length - L);
    const rets = toReturns(tail);
    const vol = stdev(rets);
    if (vol > 0) kept.push({ symbol: s.symbol, rets, mu: mean(rets), vol });
  }
  const n = kept.length;
  if (n === 0) return empty();

  const obs = kept[0].rets.length;
  const assets: AssetPoint[] = kept.map((k) => ({ symbol: k.symbol, ret: k.mu, vol: k.vol }));

  const cov = covarianceMatrix(kept.map((k) => k.rets));
  const mu = kept.map((k) => k.mu);

  // Equal-weight book (always defined for n ≥ 1).
  const equalW = new Array<number>(n).fill(1 / n);
  const equal: FrontierPoint = {
    ret: mean(mu),
    vol: Math.sqrt(portfolioVariance(cov, equalW)),
  };

  const st = frontierStats(cov, mu);
  if (!st || st.A <= EPS) {
    return { ...empty(), assets, equal, n, obs };
  }

  const gmvRet = st.B / st.A;
  const gmv: FrontierPoint = { ret: gmvRet, vol: Math.sqrt(1 / st.A) };

  // Tangency / max-Sharpe (rf = 0) needs a positive-return direction (B > 0) and
  // a genuinely non-degenerate frontier (D > 0).
  let tangency: FrontierPoint | null = null;
  let maxSharpe = 0;
  if (st.D > EPS && st.B > EPS && st.C > 0) {
    tangency = { ret: st.C / st.B, vol: Math.sqrt(st.C) / st.B };
    maxSharpe = Math.sqrt(st.C);
  }

  // A degenerate frontier (all assets share a mean) collapses to a point.
  if (st.D <= EPS) {
    return { curve: [], assets, gmv, tangency: null, equal, maxSharpe: 0, n, obs, ok: false };
  }

  // Sample the hyperbola symmetrically around the GMV return so both branches
  // show, padded to comfortably include the assets and the tangency.
  let reach = 0;
  for (const a of assets) reach = Math.max(reach, Math.abs(a.ret - gmvRet));
  if (tangency) reach = Math.max(reach, Math.abs(tangency.ret - gmvRet));
  if (reach <= 0) reach = Math.abs(gmvRet) || 0.01;
  const R = reach * 1.2 + 1e-9;

  const steps = Math.max(2, samples);
  const curve: FrontierPoint[] = [];
  for (let i = 0; i < steps; i++) {
    const m = gmvRet - R + (2 * R * i) / (steps - 1);
    curve.push({ ret: m, vol: frontierVol(st, m) });
  }

  return { curve, assets, gmv, tangency, equal, maxSharpe, n, obs, ok: true };
}
