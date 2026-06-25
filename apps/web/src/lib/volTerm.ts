/**
 * Volatility term structure: annualized realized volatility measured over a set
 * of trailing lookbacks, and the shape of the curve (is near-term vol elevated
 * or compressed versus the long end?). Pure for unit testing.
 */

import { stdev } from './distribution';

export interface VolPoint {
  lookbackDays: number;
  vol: number; // annualized realized vol (fraction)
  n: number; // returns actually used
}

export type VolRegime = 'elevated' | 'compressed' | 'flat';

export interface VolTerm {
  points: VolPoint[]; // ascending by lookback
  shortVol: number | null; // shortest lookback
  longVol: number | null; // longest lookback
  ratio: number | null; // short / long
  regime: VolRegime;
}

/** Annualized realized volatility of a return series. */
export function realizedVol(returns: number[], periodsPerYear: number): number {
  return stdev(returns) * Math.sqrt(periodsPerYear);
}

/**
 * Realized vol at each lookback, using the trailing `lb` returns. A lookback is
 * only included when the full window is available, so a long-horizon point can't
 * masquerade as a shorter one on thin history.
 */
export function volTermStructure(
  returns: number[],
  lookbacks: number[],
  periodsPerYear: number,
): VolPoint[] {
  const out: VolPoint[] = [];
  for (const lb of lookbacks) {
    if (lb < 3 || returns.length < lb) continue;
    const slice = returns.slice(-lb);
    out.push({ lookbackDays: lb, vol: realizedVol(slice, periodsPerYear), n: slice.length });
  }
  return out;
}

/** Classify the curve by comparing the short end to the long end. */
export function termShape(points: VolPoint[]): VolTerm {
  if (points.length === 0) {
    return { points, shortVol: null, longVol: null, ratio: null, regime: 'flat' };
  }
  const sorted = [...points].sort((a, b) => a.lookbackDays - b.lookbackDays);
  const shortVol = sorted[0].vol;
  const longVol = sorted[sorted.length - 1].vol;
  const ratio = longVol > 0 ? shortVol / longVol : null;
  let regime: VolRegime = 'flat';
  if (ratio != null) regime = ratio > 1.05 ? 'elevated' : ratio < 0.95 ? 'compressed' : 'flat';
  return { points: sorted, shortVol, longVol, ratio, regime };
}

/** Convenience: term structure + shape in one call. */
export function volTerm(returns: number[], lookbacks: number[], periodsPerYear: number): VolTerm {
  return termShape(volTermStructure(returns, lookbacks, periodsPerYear));
}
