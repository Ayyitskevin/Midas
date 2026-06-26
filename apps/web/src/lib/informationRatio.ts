/**
 * Information ratio vs a benchmark (here BTC) — how much *excess* return a name
 * earns over the benchmark per unit of benchmark-relative risk. Working on the
 * series of return differences (asset − benchmark):
 *
 *     IR = mean(active) / stdev(active)        (per period)
 *
 * the numerator is the active return (does it beat BTC on average?) and the
 * denominator is the tracking error (how erratically does it diverge?). A high IR
 * means consistent, low-noise outperformance; a negative one means it
 * consistently lags. Both legs are annualized for display (active × periods/yr,
 * tracking error × √periods/yr), so the reported IR is the annualized figure.
 *
 * Reuses the shared simple returns, mean and population stdev. Pure for unit
 * testing.
 */

import { toReturns } from './correlation';
import { mean, stdev } from './distribution';

export interface ClosesSeries {
  symbol: string;
  closes: number[];
}

export interface InfoStat {
  /** Annualized active return, mean(asset − bench) × periods/yr. */
  activeReturn: number;
  /** Annualized tracking error, stdev(asset − bench) × √periods/yr. */
  trackingError: number;
  /** Annualized information ratio; null when the tracking error is zero. */
  infoRatio: number | null;
}

export interface InfoRow extends InfoStat {
  symbol: string;
  /** Active return observations used. */
  n: number;
}

export type InfoSort = 'infoRatio' | 'activeReturn' | 'trackingError' | 'symbol';

/**
 * Information-ratio stats of asset returns vs benchmark returns at
 * `periodsPerYear`. Returns null with fewer than two overlapping points; the
 * ratio itself is null when the asset tracks the benchmark exactly (zero
 * tracking error).
 */
export function computeInfoRatio(
  assetReturns: number[],
  benchReturns: number[],
  periodsPerYear: number,
): InfoStat | null {
  const n = Math.min(assetReturns.length, benchReturns.length);
  if (n < 2) return null;
  const active: number[] = [];
  for (let i = 0; i < n; i++) active.push(assetReturns[i] - benchReturns[i]);
  const te = stdev(active);
  const activeReturn = mean(active) * periodsPerYear;
  const trackingError = te * Math.sqrt(periodsPerYear);
  const infoRatio = te > 0 ? (mean(active) / te) * Math.sqrt(periodsPerYear) : null;
  return { activeReturn, trackingError, infoRatio };
}

/**
 * Build an information-ratio board: each series' IR vs the benchmark, computed on
 * returns over the common (most-recent) overlap. The benchmark itself is omitted.
 * Returns [] if the benchmark series is missing.
 */
export function infoBoard(
  series: ClosesSeries[],
  benchmark: string,
  periodsPerYear: number,
  sort: InfoSort = 'infoRatio',
): InfoRow[] {
  const valid = series.filter((s) => s.closes.length >= 3);
  const bench = valid.find((s) => s.symbol === benchmark);
  if (!bench) return [];
  const k = Math.min(...valid.map((s) => s.closes.length));
  const benchRet = toReturns(bench.closes.slice(-k));

  const rows: InfoRow[] = [];
  for (const s of valid) {
    if (s.symbol === benchmark) continue;
    const ret = toReturns(s.closes.slice(-k));
    const stat = computeInfoRatio(ret, benchRet, periodsPerYear);
    if (!stat) continue;
    rows.push({ symbol: s.symbol, ...stat, n: Math.min(ret.length, benchRet.length) });
  }
  return sortInfo(rows, sort);
}

export function sortInfo(rows: InfoRow[], sort: InfoSort): InfoRow[] {
  // A null IR (zero tracking error — moves exactly with BTC) is uninformative;
  // sort it to the bottom.
  const lo = (v: number | null) => (v == null ? -Infinity : v);
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'activeReturn':
        return b.activeReturn - a.activeReturn;
      case 'trackingError':
        return b.trackingError - a.trackingError;
      case 'infoRatio':
      default:
        return lo(b.infoRatio) - lo(a.infoRatio);
    }
  });
  return out;
}
