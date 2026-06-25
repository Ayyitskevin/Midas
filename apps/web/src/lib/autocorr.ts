/**
 * Return autocorrelation — does a name's move today tell you anything about its
 * move tomorrow? The lag-k autocorrelation is the Pearson correlation between the
 * return series and a copy of itself shifted by k bars. A positive lag-1 reading
 * means returns persist (a green day tends to be followed by another — momentum);
 * a negative one means they reverse (mean reversion); near zero is a coin flip
 * (efficient / random walk). Looking at the first few lags shows whether any edge
 * decays quickly or carries over several bars.
 *
 * Reuses the shared simple returns and Pearson correlation (which already returns
 * 0 for a constant series and clamps to ±1). Pure for unit testing.
 */

import { toReturns, pearson } from './correlation';

export type AcfVerdict = 'momentum' | 'reverting' | 'random';

export interface AcfRow {
  symbol: string;
  /** Lag-1 autocorrelation of returns. */
  lag1: number;
  /** Lag-2 autocorrelation. */
  lag2: number;
  /** Lag-3 autocorrelation. */
  lag3: number;
  /** Read on the lag-1 sign/strength. */
  verdict: AcfVerdict;
  /** Returns used. */
  n: number;
}

export type AcfSort = 'lag1' | 'lag2' | 'lag3' | 'symbol';

export interface AcfInput {
  symbol: string;
  closes: number[];
}

/** Lag-1 magnitude under which a name is treated as a random walk. */
export const ACF_THRESHOLD = 0.1;

/**
 * Lag-`lag` autocorrelation of a return series: pearson(rₜ, rₜ₋lag). Returns 0
 * when there aren't at least two overlapping pairs.
 */
export function autocorr(returns: number[], lag: number): number {
  if (lag < 1 || returns.length - lag < 2) return 0;
  const a = returns.slice(lag);
  const b = returns.slice(0, returns.length - lag);
  return pearson(a, b);
}

/**
 * Autocorrelation stats for one close series: the lag-1/2/3 ACF and a momentum /
 * reverting / random verdict from the lag-1 sign and the ±ACF_THRESHOLD band.
 * Returns null without enough history for a lag-3 read (≥ 5 returns).
 */
export function computeAcf(closes: number[]): Omit<AcfRow, 'symbol'> | null {
  const returns = toReturns(closes);
  if (returns.length < 5) return null;
  const lag1 = autocorr(returns, 1);
  const lag2 = autocorr(returns, 2);
  const lag3 = autocorr(returns, 3);
  const verdict: AcfVerdict =
    lag1 > ACF_THRESHOLD ? 'momentum' : lag1 < -ACF_THRESHOLD ? 'reverting' : 'random';
  return { lag1, lag2, lag3, verdict, n: returns.length };
}

/** Autocorrelation board across a basket, sorted (default lag-1 descending). */
export function acfBoard(series: AcfInput[], sort: AcfSort = 'lag1'): AcfRow[] {
  const rows: AcfRow[] = [];
  for (const s of series) {
    const r = computeAcf(s.closes);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortAcf(rows, sort);
}

export function sortAcf(rows: AcfRow[], sort: AcfSort): AcfRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'lag2':
        return b.lag2 - a.lag2;
      case 'lag3':
        return b.lag3 - a.lag3;
      case 'lag1':
      default:
        return b.lag1 - a.lag1; // most momentum (positive) first
    }
  });
  return out;
}
