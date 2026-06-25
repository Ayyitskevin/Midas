/**
 * Global minimum-variance portfolio optimizer. Where risk parity weights each
 * name inversely to its own volatility (and ignores how names move together),
 * the minimum-variance portfolio uses the full return covariance matrix Σ, so
 * it leans into diversification: a pair of highly correlated names gets trimmed,
 * and a genuine diversifier can be sized up. The closed-form long/short solution
 * is
 *
 *     w = Σ⁻¹·1 / (1ᵀ·Σ⁻¹·1)
 *
 * which is the lowest-variance fully-invested book (weights sum to 1 and may go
 * negative — a negative weight is a short leg). We build Σ from aligned daily
 * returns, invert it with Gauss-Jordan elimination (partial pivoting, scaled so
 * the singularity test is unit-free), and fall back to inverse-vol weights when
 * Σ can't be inverted (e.g. duplicate or perfectly-correlated names).
 *
 * Everything here is pure (no React/DOM) and reuses the shared simple-returns
 * and population-stdev helpers, so it is exhaustively unit-tested against
 * analytically-known cases.
 */

import { toReturns } from './correlation';
import { stdev } from './distribution';

export interface MinVarInput {
  symbol: string;
  closes: number[];
}

export interface MinVarRow {
  symbol: string;
  /** Daily return standard deviation (population). */
  vol: number;
  /** Minimum-variance weight; sums to 1 across rows, may be negative (short). */
  weight: number;
  /** Naive 1/N weight, for comparison. */
  equalWeight: number;
  /** Inverse-vol (risk-parity) weight, for comparison. */
  invVolWeight: number;
}

export interface MinVarResult {
  /** Priced rows, sorted by minimum-variance weight descending. */
  rows: MinVarRow[];
  /** Number of usable assets. */
  n: number;
  /** Number of aligned return observations used to build Σ. */
  obs: number;
  /** Daily volatility of the minimum-variance book. */
  portVol: number;
  /** Daily volatility of the equal-weight book, for comparison. */
  equalVol: number;
  /** Daily volatility of the inverse-vol book, for comparison. */
  invVolVol: number;
  /** True when Σ inverted and the weights are the true minimum-variance set. */
  ok: boolean;
  /** True when any minimum-variance weight is negative (implies a short leg). */
  hasShort: boolean;
}

const EMPTY: MinVarResult = {
  rows: [],
  n: 0,
  obs: 0,
  portVol: 0,
  equalVol: 0,
  invVolVol: 0,
  ok: false,
  hasShort: false,
};

/**
 * Invert a square matrix via Gauss-Jordan elimination with partial pivoting.
 * The matrix is first scaled by its largest absolute entry so the singularity
 * test (`|pivot| < 1e-12`) is independent of the data's units — daily-return
 * covariances are ~1e-4, which would otherwise make any absolute threshold
 * meaningless. Returns null when the matrix is singular (or empty).
 */
export function invertMatrix(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  if (n === 0) return null;
  let scale = 0;
  for (const row of matrix) {
    if (row.length !== n) return null;
    for (const x of row) {
      if (!Number.isFinite(x)) return null;
      const a = Math.abs(x);
      if (a > scale) scale = a;
    }
  }
  if (scale === 0) return null;

  // Augment the scaled matrix with the identity: [ M/scale | I ].
  const a: number[][] = matrix.map((row, i) => {
    const aug = row.map((x) => x / scale);
    for (let j = 0; j < n; j++) aug.push(i === j ? 1 : 0);
    return aug;
  });

  for (let col = 0; col < n; col++) {
    // Partial pivot: swap in the row with the largest magnitude in this column.
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = a[pivot];
      a[pivot] = a[col];
      a[col] = tmp;
    }
    // Normalize the pivot row, then eliminate the column from every other row.
    const pv = a[col][col];
    for (let j = 0; j < 2 * n; j++) a[col][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[col][j];
    }
  }

  // Right half is (M/scale)⁻¹ = scale·M⁻¹, so divide back out the scale.
  return a.map((row) => row.slice(n).map((x) => x / scale));
}

/**
 * Population covariance matrix of a set of equal-length return series (rows and
 * columns follow input order). Uses the 1/T (population) convention to match the
 * shared `stdev`; the minimum-variance weights are invariant to that choice.
 */
export function covarianceMatrix(returns: number[][]): number[][] {
  const n = returns.length;
  if (n === 0) return [];
  const T = returns[0].length;
  const means = returns.map((r) => {
    let s = 0;
    for (const x of r) s += x;
    return T > 0 ? s / T : 0;
  });
  const cov: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let t = 0; t < T; t++) s += (returns[i][t] - means[i]) * (returns[j][t] - means[j]);
      const c = T > 0 ? s / T : 0;
      cov[i][j] = c;
      cov[j][i] = c;
    }
  }
  return cov;
}

/**
 * Global minimum-variance weights from a covariance matrix:
 * w = Σ⁻¹·1 / (1ᵀ·Σ⁻¹·1). Returns null when Σ is singular or the normalizing
 * scalar 1ᵀΣ⁻¹1 is non-positive (degenerate). Weights sum to 1 by construction.
 */
export function gmvWeights(cov: number[][]): number[] | null {
  const inv = invertMatrix(cov);
  if (!inv) return null;
  // u = Σ⁻¹·1 is the vector of inverse-matrix row sums.
  const u = inv.map((row) => row.reduce((acc, x) => acc + x, 0));
  let denom = 0;
  for (const x of u) denom += x;
  if (!Number.isFinite(denom) || denom <= 1e-15) return null;
  return u.map((x) => x / denom);
}

/** Portfolio variance wᵀΣw (clamped at 0 against floating-point undershoot). */
export function portfolioVariance(cov: number[][], w: number[]): number {
  const n = cov.length;
  let v = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) v += w[i] * cov[i][j] * w[j];
  }
  return v < 0 ? 0 : v;
}

/**
 * Minimum-variance weights across a basket of price series. Symbols are aligned
 * to a common tail length, turned into daily returns, and any flat/too-short
 * series is dropped. When Σ inverts we report the true minimum-variance set;
 * otherwise we degrade to inverse-vol weights and flag `ok: false`.
 */
export function minVariance(series: MinVarInput[]): MinVarResult {
  // Need at least 3 closes (→ 2 returns) for a defined volatility.
  const long = series.filter((s) => s.closes.length >= 3);
  if (long.length === 0) return EMPTY;

  // Align every series to the most-recent common window so Σ is built from
  // overlapping observations.
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

  const equalW = new Array<number>(n).fill(1 / n);

  let invSum = 0;
  for (const k of kept) invSum += 1 / k.vol;
  const invVolW = kept.map((k) => 1 / k.vol / invSum);

  const gmv = gmvWeights(cov);
  const ok = gmv !== null;
  const w = gmv ?? invVolW;

  const portVol = Math.sqrt(portfolioVariance(cov, w));
  const equalVol = Math.sqrt(portfolioVariance(cov, equalW));
  const invVolVol = Math.sqrt(portfolioVariance(cov, invVolW));

  const rows: MinVarRow[] = kept.map((k, i) => ({
    symbol: k.symbol,
    vol: k.vol,
    weight: w[i],
    equalWeight: 1 / n,
    invVolWeight: invVolW[i],
  }));
  const hasShort = rows.some((r) => r.weight < 0);
  rows.sort((a, b) => b.weight - a.weight);

  return { rows, n, obs, portVol, equalVol, invVolVol, ok, hasShort };
}
