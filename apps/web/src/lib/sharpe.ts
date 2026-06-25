/**
 * Risk-adjusted return math: Sharpe and Sortino ratios (annualized) plus
 * annualized return and volatility, from a series of period returns. A risk-free
 * rate of 0 is assumed (fine for crypto). Pure for unit testing.
 */

import { toReturns } from './correlation';

export interface RiskRatios {
  sharpe: number | null; // mean / σ, annualized
  sortino: number | null; // mean / downside-σ, annualized
  annReturn: number; // arithmetic mean return × periods/yr
  annVol: number; // σ × √(periods/yr)
}

export interface SharpeRow extends RiskRatios {
  symbol: string;
}

export type SharpeSort = 'sharpe' | 'sortino' | 'annReturn' | 'annVol' | 'symbol';

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Population standard deviation. */
export function stdev(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  let v = 0;
  for (const x of xs) v += (x - m) ** 2;
  return Math.sqrt(v / n);
}

/** Downside deviation: RMS of returns below `target` (others count as 0). */
export function downsideDeviation(xs: number[], target = 0): number {
  if (xs.length === 0) return 0;
  let v = 0;
  for (const x of xs) {
    const d = Math.min(0, x - target);
    v += d * d;
  }
  return Math.sqrt(v / xs.length);
}

/** Sharpe / Sortino (annualized by √periodsPerYear) plus annualized return & vol. */
export function computeRatios(returns: number[], periodsPerYear: number): RiskRatios {
  const m = mean(returns);
  const sd = stdev(returns);
  const dd = downsideDeviation(returns, 0);
  const k = Math.sqrt(periodsPerYear);
  return {
    sharpe: sd > 0 ? (m / sd) * k : null,
    sortino: dd > 0 ? (m / dd) * k : null,
    annReturn: m * periodsPerYear,
    annVol: sd * k,
  };
}

export interface ClosesSeries {
  symbol: string;
  closes: number[];
}

/** Build a risk-adjusted board from close series (≥3 closes needed per symbol). */
export function sharpeBoard(
  series: ClosesSeries[],
  periodsPerYear: number,
  sort: SharpeSort = 'sharpe',
): SharpeRow[] {
  const rows: SharpeRow[] = [];
  for (const s of series) {
    if (s.closes.length < 3) continue;
    rows.push({ symbol: s.symbol, ...computeRatios(toReturns(s.closes), periodsPerYear) });
  }
  return sortSharpe(rows, sort);
}

export function sortSharpe(rows: SharpeRow[], sort: SharpeSort): SharpeRow[] {
  const nullLast = (v: number | null) => (v == null ? -Infinity : v);
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'sortino':
        return nullLast(b.sortino) - nullLast(a.sortino);
      case 'annReturn':
        return b.annReturn - a.annReturn;
      case 'annVol':
        return b.annVol - a.annVol;
      case 'sharpe':
      default:
        return nullLast(b.sharpe) - nullLast(a.sharpe);
    }
  });
  return out;
}
