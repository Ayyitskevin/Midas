/**
 * Pain Index & Pain Ratio (Thomas Becker / Zephyr) — a time-weighted measure of
 * drawdown suffering. Where max drawdown marks only the single worst point and
 * the Ulcer Index takes the *root-mean-square* of the underwater curve, the Pain
 * Index is simply its arithmetic mean: the average depth below the running peak
 * across the whole window. A book that spends a long time only slightly
 * underwater can carry the same Pain Index as one that plunges briefly. The Pain
 * Ratio divides annualized return by that average pain, the drawdown-area
 * cousin of Sharpe / Martin / Calmar.
 *
 * By construction Pain Index ≤ Ulcer Index ≤ max drawdown (mean ≤ RMS ≤ max).
 * Reuses the shared simple returns, mean and drawdown series so the numbers line
 * up with the drawdown / Ulcer / Calmar boards. Pure for unit testing.
 */

import { toReturns } from './correlation';
import { mean } from './distribution';
import { drawdownSeries, drawdownStats } from './drawdown';

export interface PainRow {
  symbol: string;
  /** Pain Index — mean depth of the peak-relative drawdowns, positive fraction. */
  painIndex: number;
  /** Worst single drawdown over the period, positive fraction (context). */
  maxDD: number;
  /** Annualized return (arithmetic mean × periods/yr), as a fraction. */
  annReturn: number;
  /** Pain ratio = annReturn ÷ Pain Index; null when there was no drawdown. */
  painRatio: number | null;
  /** Returns used. */
  n: number;
}

export type PainSort = 'painRatio' | 'painIndex' | 'annReturn' | 'symbol';

export interface PainInput {
  symbol: string;
  closes: number[];
}

/**
 * Pain Index of a close series: the mean of the absolute peak-relative drawdowns
 * dᵢ = closeᵢ/peakᵢ − 1 (≤ 0). Zero for an empty or monotonically rising series;
 * always ≤ the max-drawdown magnitude.
 */
export function painIndex(closes: number[]): number {
  const dd = drawdownSeries(closes);
  if (dd.length === 0) return 0;
  let sum = 0;
  for (const d of dd) sum += -d; // |dᵢ|
  return sum / dd.length;
}

/**
 * Pain stats for one close series. Returns null with fewer than three closes. A
 * series that never drew down has a zero Pain Index and a null Pain Ratio.
 */
export function computePain(
  closes: number[],
  periodsPerYear: number,
): Omit<PainRow, 'symbol'> | null {
  if (closes.length < 3) return null;
  const returns = toReturns(closes);
  const annReturn = mean(returns) * periodsPerYear;
  const pain = painIndex(closes);
  const ddMax = drawdownStats(closes).maxDD; // ≤ 0
  const maxDD = ddMax < 0 ? -ddMax : 0; // positive magnitude, normalized off −0
  const painRatio = pain > 0 ? annReturn / pain : null;
  return { painIndex: pain, maxDD, annReturn, painRatio, n: returns.length };
}

/** Pain board across a basket, sorted (default Pain ratio descending). */
export function painBoard(
  series: PainInput[],
  periodsPerYear: number,
  sort: PainSort = 'painRatio',
): PainRow[] {
  const rows: PainRow[] = [];
  for (const s of series) {
    const r = computePain(s.closes, periodsPerYear);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortPain(rows, sort);
}

export function sortPain(rows: PainRow[], sort: PainSort): PainRow[] {
  const lo = (v: number | null) => (v == null ? -Infinity : v);
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'painIndex':
        return b.painIndex - a.painIndex; // most pain first
      case 'annReturn':
        return b.annReturn - a.annReturn;
      case 'painRatio':
      default:
        return lo(b.painRatio) - lo(a.painRatio); // best risk-adjusted first
    }
  });
  return out;
}
