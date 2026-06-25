/**
 * Calmar ratio — annualized return divided by the worst peak-to-trough
 * drawdown over the period. Where Sharpe penalizes all volatility (up and
 * down), Calmar only cares about the deepest hole the strategy dug, so it
 * speaks to the pain an investor actually has to sit through. Higher is better;
 * a Calmar of 1 means a year's return roughly equals the worst drawdown.
 *
 * Reuses the shared simple returns, mean and drawdown stats so the numbers line
 * up with the Sharpe and drawdown boards. Pure for unit testing.
 */

import { toReturns } from './correlation';
import { mean } from './distribution';
import { drawdownStats } from './drawdown';

export interface CalmarRow {
  symbol: string;
  /** Annualized return ÷ max drawdown; null when there was no drawdown. */
  calmar: number | null;
  /** Annualized return (arithmetic mean × periods/yr), as a fraction. */
  annReturn: number;
  /** Worst drawdown over the period, as a positive fraction. */
  maxDD: number;
  /** Returns used. */
  n: number;
}

export type CalmarSort = 'calmar' | 'annReturn' | 'maxDD' | 'symbol';

export interface CalmarInput {
  symbol: string;
  closes: number[];
}

/**
 * Calmar stats for one close series. Returns null with fewer than three closes.
 * A series that never drew down (monotonic) has an undefined Calmar (null) since
 * the denominator is zero.
 */
export function computeCalmar(
  closes: number[],
  periodsPerYear: number,
): Omit<CalmarRow, 'symbol'> | null {
  if (closes.length < 3) return null;
  const returns = toReturns(closes);
  const annReturn = mean(returns) * periodsPerYear;
  const ddMax = drawdownStats(closes).maxDD; // ≤ 0
  const maxDD = ddMax < 0 ? -ddMax : 0; // positive magnitude, normalized off −0
  const calmar = maxDD > 0 ? annReturn / maxDD : null;
  return { calmar, annReturn, maxDD, n: returns.length };
}

/** Calmar board across a basket, sorted (default Calmar descending). */
export function calmarBoard(
  series: CalmarInput[],
  periodsPerYear: number,
  sort: CalmarSort = 'calmar',
): CalmarRow[] {
  const rows: CalmarRow[] = [];
  for (const s of series) {
    const r = computeCalmar(s.closes, periodsPerYear);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortCalmar(rows, sort);
}

export function sortCalmar(rows: CalmarRow[], sort: CalmarSort): CalmarRow[] {
  const lo = (v: number | null) => (v == null ? -Infinity : v);
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'annReturn':
        return b.annReturn - a.annReturn;
      case 'maxDD':
        return b.maxDD - a.maxDD; // deepest drawdown first
      case 'calmar':
      default:
        return lo(b.calmar) - lo(a.calmar);
    }
  });
  return out;
}
