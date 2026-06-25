/**
 * Return-shape board — the third and fourth moments of a symbol's daily returns,
 * the part of risk that volatility alone misses. Skewness says which way the
 * surprises lean (negative = crash-prone left tail, positive = lottery-like
 * right tail); excess kurtosis says how fat the tails are versus a normal bell
 * (high = frequent extreme days). Together they flag names whose risk hides in
 * the tails rather than the standard deviation.
 *
 * Reuses the shared skewness / kurtosis / stdev so the numbers match the VaR
 * panel. Pure and side-effect free for unit testing.
 */

import { toReturns } from './correlation';
import { skewness, kurtosis, stdev } from './distribution';

export interface ShapeRow {
  symbol: string;
  /** Sample skewness of daily returns. */
  skew: number;
  /** Excess kurtosis (0 = normal tails). */
  kurtosis: number;
  /** Per-day return standard deviation (fraction). */
  vol: number;
  /** Returns used. */
  n: number;
}

export type ShapeSort = 'kurtosis' | 'skew' | 'vol' | 'symbol';

export interface ShapeInput {
  symbol: string;
  closes: number[];
}

/** Return-shape moments for one close series, or null with fewer than 3 returns. */
export function computeShape(closes: number[]): Omit<ShapeRow, 'symbol'> | null {
  const returns = toReturns(closes);
  if (returns.length < 3) return null;
  return { skew: skewness(returns), kurtosis: kurtosis(returns), vol: stdev(returns), n: returns.length };
}

/** Return-shape board across a basket, sorted (default by excess kurtosis desc). */
export function shapeBoard(series: ShapeInput[], sort: ShapeSort = 'kurtosis'): ShapeRow[] {
  const rows: ShapeRow[] = [];
  for (const s of series) {
    const r = computeShape(s.closes);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortShape(rows, sort);
}

export function sortShape(rows: ShapeRow[], sort: ShapeSort): ShapeRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'skew':
        return b.skew - a.skew;
      case 'vol':
        return b.vol - a.vol;
      case 'kurtosis':
      default:
        return b.kurtosis - a.kurtosis;
    }
  });
  return out;
}
