/**
 * Treynor ratio — annualized return per unit of *systematic* (market) risk:
 *
 *     Treynor = annualized return / beta-to-benchmark
 *
 * Where Sharpe divides excess return by *total* volatility and the Information
 * ratio divides active return by *tracking error*, Treynor divides by *beta* —
 * the slice of risk that comes from co-moving with the market (here BTC). Two
 * names with the same Sharpe can have very different Treynors: the one that
 * earned its return with less market exposure (lower beta) scores higher, which
 * is what a diversified holder — who only cares about the systematic risk a name
 * adds to a BTC-driven book — actually pays for. Together with Sharpe and the
 * Information ratio it completes the classic risk-adjusted-return trio.
 *
 * Risk-free is taken as zero (consistent with the rest of the ratio suite), so
 * the numerator is the asset's own annualized return. Beta reuses the shared
 * cov/var computation; the board mirrors the beta / information-ratio boards
 * (align every series to the common recent overlap, omit the benchmark). Pure
 * for unit testing.
 *
 * Caveat baked in: as beta → 0 the ratio explodes and stops meaning anything, so
 * a (near-)market-neutral name yields a null Treynor rather than a giant number.
 * Negative betas are kept as-is — a positive return on a negative beta really is
 * a negative Treynor, which is the metric's well-known quirk, not a bug.
 */

import { toReturns } from './correlation';
import { mean } from './distribution';
import { computeBeta } from './beta';

/** Below this |beta|, the ratio is numerically meaningless → null. */
const MIN_ABS_BETA = 1e-8;

export interface TreynorStat {
  /** Annualized asset return (arithmetic mean × periods/yr), as a fraction. */
  annReturn: number;
  /** Beta of the asset vs the benchmark. */
  beta: number;
  /** annReturn ÷ beta; null when |beta| is ~0 (ratio undefined). */
  treynor: number | null;
}

export interface TreynorRow extends TreynorStat {
  symbol: string;
  /** Returns used. */
  n: number;
}

export type TreynorSort = 'treynor' | 'annReturn' | 'beta' | 'symbol';

export interface TreynorInput {
  symbol: string;
  closes: number[];
}

/**
 * Treynor stats for one asset's returns vs the benchmark's. Returns null when
 * beta is undefined (constant benchmark or fewer than two overlapping points);
 * the Treynor itself is null when |beta| is ~0.
 */
export function computeTreynor(
  assetReturns: number[],
  benchReturns: number[],
  periodsPerYear: number,
): TreynorStat | null {
  const stat = computeBeta(assetReturns, benchReturns);
  if (!stat) return null;
  const n = Math.min(assetReturns.length, benchReturns.length);
  const annReturn = mean(assetReturns.slice(0, n)) * periodsPerYear;
  const beta = stat.beta;
  const treynor = Math.abs(beta) >= MIN_ABS_BETA ? annReturn / beta : null;
  return { annReturn, beta, treynor };
}

/**
 * Build a Treynor board: each name's annualized return ÷ its beta to the
 * benchmark, computed on returns over the common (most-recent) overlap. The
 * benchmark itself is omitted. Returns [] if the benchmark series is missing.
 */
export function treynorBoard(
  series: TreynorInput[],
  benchmark: string,
  periodsPerYear: number,
  sort: TreynorSort = 'treynor',
): TreynorRow[] {
  const valid = series.filter((s) => s.closes.length >= 3);
  const bench = valid.find((s) => s.symbol === benchmark);
  if (!bench) return [];
  const k = Math.min(...valid.map((s) => s.closes.length));
  const benchRet = toReturns(bench.closes.slice(-k));

  const rows: TreynorRow[] = [];
  for (const s of valid) {
    if (s.symbol === benchmark) continue;
    const ret = toReturns(s.closes.slice(-k));
    const stat = computeTreynor(ret, benchRet, periodsPerYear);
    if (!stat) continue;
    rows.push({ symbol: s.symbol, ...stat, n: ret.length });
  }
  return sortTreynor(rows, sort);
}

export function sortTreynor(rows: TreynorRow[], sort: TreynorSort): TreynorRow[] {
  const lo = (v: number | null) => (v == null ? -Infinity : v); // null Treynor sinks last
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'annReturn':
        return b.annReturn - a.annReturn;
      case 'beta':
        return b.beta - a.beta;
      case 'treynor':
      default:
        return lo(b.treynor) - lo(a.treynor); // best systematic-risk-adjusted first
    }
  });
  return out;
}
