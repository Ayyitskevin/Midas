/**
 * Adjusted Sharpe ratio (Pezier & White, 2006) — the Sharpe ratio penalized for
 * the shape of the return distribution it hides:
 *
 *     ASR = SR · [ 1 + (skew / 6)·SR − (excessKurtosis / 24)·SR² ]
 *
 * A plain Sharpe assumes returns are normal, so it flatters a name that earns its
 * smooth average by quietly accepting fat left tails (negative skew) and frequent
 * outliers (excess kurtosis). The adjustment docks the Sharpe for negative skew
 * and for fat tails, and rewards positive skew — so two names with the same
 * Sharpe separate by the quality of their return shape.
 *
 * Correctness note: the SR inside the bracket is the *periodic* Sharpe (mean / σ
 * at the return frequency), the same frequency as the skew/kurtosis — NOT the
 * annualized Sharpe, whose √periods scaling would blow up the SR² term. We apply
 * the (annualization-free) adjustment factor to the annualized Sharpe for
 * display, so the column lines up with the SHARPE board. Reuses the shared simple
 * returns plus mean / stdev / skewness / (excess) kurtosis. Pure for unit testing.
 */

import { toReturns } from './correlation';
import { mean, stdev, skewness, kurtosis } from './distribution';

export interface AdjSharpeRow {
  symbol: string;
  /** Annualized adjusted Sharpe = annualized Sharpe × the shape factor. */
  asr: number;
  /** Annualized plain Sharpe, for comparison. */
  sharpe: number;
  /** Skewness of the returns (negative = fat left tail). */
  skew: number;
  /** Excess kurtosis of the returns (>0 = fat tails). */
  exKurt: number;
  /** The dimensionless adjustment factor applied to the Sharpe. */
  factor: number;
  /** Returns used. */
  n: number;
}

export type AdjSharpeSort = 'asr' | 'sharpe' | 'skew' | 'exKurt' | 'symbol';

export interface AdjSharpeInput {
  symbol: string;
  closes: number[];
}

/**
 * Adjusted-Sharpe stats for one close series. Returns null with fewer than three
 * closes, or when the returns have zero volatility (Sharpe — and therefore the
 * adjustment — undefined).
 */
export function computeAdjustedSharpe(
  closes: number[],
  periodsPerYear: number,
): Omit<AdjSharpeRow, 'symbol'> | null {
  if (closes.length < 3) return null;
  const returns = toReturns(closes);
  const m = mean(returns);
  const sd = stdev(returns);
  if (sd === 0) return null; // no volatility — Sharpe undefined
  const srP = m / sd; // periodic Sharpe (annualization-free)
  const skew = skewness(returns);
  const exKurt = kurtosis(returns); // excess (already − 3)
  const factor = 1 + (skew / 6) * srP - (exKurt / 24) * srP * srP;
  const sharpe = srP * Math.sqrt(periodsPerYear);
  const asr = sharpe * factor;
  return { asr, sharpe, skew, exKurt, factor, n: returns.length };
}

/** Adjusted-Sharpe board across a basket, sorted (default ASR descending). */
export function adjustedSharpeBoard(
  series: AdjSharpeInput[],
  periodsPerYear: number,
  sort: AdjSharpeSort = 'asr',
): AdjSharpeRow[] {
  const rows: AdjSharpeRow[] = [];
  for (const s of series) {
    const r = computeAdjustedSharpe(s.closes, periodsPerYear);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortAdjustedSharpe(rows, sort);
}

export function sortAdjustedSharpe(rows: AdjSharpeRow[], sort: AdjSharpeSort): AdjSharpeRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'sharpe':
        return b.sharpe - a.sharpe;
      case 'skew':
        return b.skew - a.skew; // most positively skewed first
      case 'exKurt':
        return b.exKurt - a.exKurt; // fattest-tailed first
      case 'asr':
      default:
        return b.asr - a.asr; // best shape-adjusted Sharpe first
    }
  });
  return out;
}
