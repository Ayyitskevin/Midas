/**
 * Beta of an asset against a benchmark (here BTC), from period returns.
 * Beta = cov(asset, bench) / var(bench); correlation reuses the shared Pearson
 * and R² is its square. Pure and side-effect free for unit testing.
 */

import { toReturns, pearson } from './correlation';

export interface ClosesSeries {
  symbol: string;
  closes: number[];
}

export interface BetaStat {
  beta: number;
  correlation: number;
  r2: number;
}

export interface BetaRow extends BetaStat {
  symbol: string;
  /** Per-period return standard deviation (fraction). */
  vol: number;
}

export type BetaSort = 'beta' | 'correlation' | 'r2' | 'vol' | 'symbol';

/** Population standard deviation of a series (0 for fewer than two points). */
export function stdev(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  let m = 0;
  for (const x of xs) m += x;
  m /= n;
  let v = 0;
  for (const x of xs) {
    const d = x - m;
    v += d * d;
  }
  return Math.sqrt(v / n);
}

/** Beta / correlation / R² of asset returns vs benchmark returns; null if degenerate. */
export function computeBeta(assetReturns: number[], benchReturns: number[]): BetaStat | null {
  const n = Math.min(assetReturns.length, benchReturns.length);
  if (n < 2) return null;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += assetReturns[i];
    mb += benchReturns[i];
  }
  ma /= n;
  mb /= n;
  let cov = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (assetReturns[i] - ma) * (benchReturns[i] - mb);
    vb += (benchReturns[i] - mb) ** 2;
  }
  if (vb === 0) return null; // benchmark is constant — beta undefined
  const correlation = pearson(assetReturns.slice(0, n), benchReturns.slice(0, n));
  return { beta: cov / vb, correlation, r2: correlation * correlation };
}

/**
 * Build a beta board: each series' beta/correlation vs the benchmark, computed
 * on returns over the common (most-recent) overlap. The benchmark itself is
 * omitted from the rows. Returns [] if the benchmark series is missing.
 */
export function betaBoard(
  series: ClosesSeries[],
  benchmark: string,
  sort: BetaSort = 'beta',
): BetaRow[] {
  const valid = series.filter((s) => s.closes.length >= 3);
  const bench = valid.find((s) => s.symbol === benchmark);
  if (!bench) return [];
  const k = Math.min(...valid.map((s) => s.closes.length));
  const benchRet = toReturns(bench.closes.slice(-k));

  const rows: BetaRow[] = [];
  for (const s of valid) {
    if (s.symbol === benchmark) continue;
    const ret = toReturns(s.closes.slice(-k));
    const stat = computeBeta(ret, benchRet);
    if (!stat) continue;
    rows.push({ symbol: s.symbol, ...stat, vol: stdev(ret) });
  }
  return sortBeta(rows, sort);
}

export function sortBeta(rows: BetaRow[], sort: BetaSort): BetaRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'correlation':
        return b.correlation - a.correlation;
      case 'r2':
        return b.r2 - a.r2;
      case 'vol':
        return b.vol - a.vol;
      case 'beta':
      default:
        return b.beta - a.beta;
    }
  });
  return out;
}
