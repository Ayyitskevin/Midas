/**
 * Pairs / stat-arb math on a ratio (or spread) series: a rolling mean ± σ band,
 * the z-score of the latest value, and an Ornstein-Uhlenbeck mean-reversion
 * half-life from an AR(1) fit. Pure and side-effect free for unit testing.
 */

export interface RollingStat {
  mean: number; // NaN through the warm-up
  std: number;
  z: number; // (x − mean) / std
}

export type PairSignal = 'rich' | 'cheap' | 'neutral';

export interface PairStats {
  /** Per-point rolling stats, aligned to the input (warm-up = NaN). */
  stats: RollingStat[];
  ratio: number; // latest value
  mean: number; // latest rolling mean
  std: number;
  z: number; // latest z-score
  halfLife: number | null; // OU half-life in periods; null if not mean-reverting
  signal: PairSignal;
}

/** Rolling mean / std / z over a trailing window (population std). */
export function rollingStats(xs: number[], window: number): RollingStat[] {
  const out: RollingStat[] = xs.map(() => ({ mean: NaN, std: NaN, z: NaN }));
  if (window < 2) return out;
  for (let i = window - 1; i < xs.length; i++) {
    let m = 0;
    for (let j = i - window + 1; j <= i; j++) m += xs[j];
    m /= window;
    let v = 0;
    for (let j = i - window + 1; j <= i; j++) v += (xs[j] - m) ** 2;
    const sd = Math.sqrt(v / window);
    out[i] = { mean: m, std: sd, z: sd > 0 ? (xs[i] - m) / sd : 0 };
  }
  return out;
}

/**
 * Ornstein-Uhlenbeck mean-reversion half-life via an AR(1) fit of the change on
 * the lagged level: Δx_t = α + β·x_{t-1} + ε. Half-life = −ln2 / ln(1+β), valid
 * only when −1 < β < 0 (mean-reverting); null otherwise.
 */
export function halfLife(xs: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const lag: number[] = [];
  const dx: number[] = [];
  for (let i = 1; i < n; i++) {
    lag.push(xs[i - 1]);
    dx.push(xs[i] - xs[i - 1]);
  }
  const k = lag.length;
  let ml = 0;
  let md = 0;
  for (let i = 0; i < k; i++) {
    ml += lag[i];
    md += dx[i];
  }
  ml /= k;
  md /= k;
  let cov = 0;
  let varl = 0;
  for (let i = 0; i < k; i++) {
    const dl = lag[i] - ml;
    cov += dl * (dx[i] - md);
    varl += dl * dl;
  }
  if (varl === 0) return null;
  const beta = cov / varl;
  if (!(beta < 0 && beta > -1)) return null;
  const hl = -Math.log(2) / Math.log(1 + beta);
  return Number.isFinite(hl) && hl > 0 ? hl : null;
}

/** Full pairs reading: rolling band, latest z, half-life and a rich/cheap signal. */
export function pairStats(xs: number[], window: number, entryZ = 2): PairStats {
  const stats = rollingStats(xs, window);
  const last = stats[stats.length - 1] ?? { mean: NaN, std: NaN, z: NaN };
  const z = last.z;
  let signal: PairSignal = 'neutral';
  if (Number.isFinite(z)) {
    if (z >= entryZ) signal = 'rich';
    else if (z <= -entryZ) signal = 'cheap';
  }
  return {
    stats,
    ratio: xs.length ? xs[xs.length - 1] : NaN,
    mean: last.mean,
    std: last.std,
    z,
    halfLife: halfLife(xs),
    signal,
  };
}
