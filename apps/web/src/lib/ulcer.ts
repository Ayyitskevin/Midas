/**
 * Ulcer Index — a drawdown-pain metric that captures both the depth AND the
 * duration of declines, where max drawdown only captures the single worst point.
 * It is the root-mean-square of the peak-relative drawdowns over the window: a
 * book that spends months underwater scores worse than one that dips once and
 * recovers, even at the same trough. The companion Martin ratio (a.k.a. Ulcer
 * Performance Index) divides annualized return by the Ulcer Index, so it rewards
 * return per unit of sit-through pain — the drawdown-flavored cousin of Sharpe.
 *
 * Reuses the shared simple returns, mean and drawdown series so the numbers line
 * up with the drawdown / Calmar boards. Pure for unit testing.
 */

import { toReturns } from './correlation';
import { mean } from './distribution';
import { drawdownSeries, drawdownStats } from './drawdown';

export interface UlcerRow {
  symbol: string;
  /** Ulcer Index — RMS of peak-relative drawdowns, as a positive fraction. */
  ulcer: number;
  /** Worst single drawdown over the period, as a positive fraction (context). */
  maxDD: number;
  /** Annualized return (arithmetic mean × periods/yr), as a fraction. */
  annReturn: number;
  /** Martin ratio = annReturn ÷ Ulcer Index; null when there was no drawdown. */
  martin: number | null;
  /** Returns used. */
  n: number;
}

export type UlcerSort = 'martin' | 'ulcer' | 'annReturn' | 'symbol';

export interface UlcerInput {
  symbol: string;
  closes: number[];
}

/**
 * Ulcer Index of a close series: √(mean(dᵢ²)) over the peak-relative drawdowns
 * dᵢ = closeᵢ/peakᵢ − 1 (≤ 0). Zero for an empty or monotonically rising series.
 * Always ≤ the magnitude of the max drawdown.
 */
export function ulcerIndex(closes: number[]): number {
  const dd = drawdownSeries(closes);
  if (dd.length === 0) return 0;
  let sumSq = 0;
  for (const d of dd) sumSq += d * d;
  return Math.sqrt(sumSq / dd.length);
}

/**
 * Ulcer stats for one close series. Returns null with fewer than three closes.
 * A series that never drew down has a zero Ulcer Index and an undefined (null)
 * Martin ratio, since the denominator is zero.
 */
export function computeUlcer(
  closes: number[],
  periodsPerYear: number,
): Omit<UlcerRow, 'symbol'> | null {
  if (closes.length < 3) return null;
  const returns = toReturns(closes);
  const annReturn = mean(returns) * periodsPerYear;
  const ulcer = ulcerIndex(closes);
  const ddMax = drawdownStats(closes).maxDD; // ≤ 0
  const maxDD = ddMax < 0 ? -ddMax : 0; // positive magnitude, normalized off −0
  const martin = ulcer > 0 ? annReturn / ulcer : null;
  return { ulcer, maxDD, annReturn, martin, n: returns.length };
}

/** Ulcer board across a basket, sorted (default Martin ratio descending). */
export function ulcerBoard(
  series: UlcerInput[],
  periodsPerYear: number,
  sort: UlcerSort = 'martin',
): UlcerRow[] {
  const rows: UlcerRow[] = [];
  for (const s of series) {
    const r = computeUlcer(s.closes, periodsPerYear);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortUlcer(rows, sort);
}

export function sortUlcer(rows: UlcerRow[], sort: UlcerSort): UlcerRow[] {
  const lo = (v: number | null) => (v == null ? -Infinity : v);
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'ulcer':
        return b.ulcer - a.ulcer; // most pain first
      case 'annReturn':
        return b.annReturn - a.annReturn;
      case 'martin':
      default:
        return lo(b.martin) - lo(a.martin); // best risk-adjusted first
    }
  });
  return out;
}
