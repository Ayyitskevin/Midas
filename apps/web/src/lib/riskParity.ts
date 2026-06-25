/**
 * Risk-parity (inverse-volatility) weighting — size each holding so it
 * contributes the same risk, rather than the same dollars. A naive equal-weight
 * book lets the most volatile name dominate the swings; weighting inversely to
 * volatility (wᵢ ∝ 1/σᵢ) equalizes each asset's risk contribution under the
 * simplifying assumption of equal cross-correlations. The output is a set of
 * target weights you can carry into the rebalance calculator.
 *
 * Reuses the shared simple returns and population stdev. Pure for unit testing.
 */

import { toReturns } from './correlation';
import { stdev } from './distribution';

export interface ParityInput {
  symbol: string;
  closes: number[];
}

export interface ParityRow {
  symbol: string;
  /** Daily return standard deviation. */
  vol: number;
  /** Inverse-vol weight, fraction in [0, 1]. */
  weight: number;
  /** Naive 1/N weight, for comparison. */
  equalWeight: number;
  /** Risk contribution share, percent (≈ equal across rows by construction). */
  riskContribPct: number;
}

export interface ParityResult {
  /** Priced rows, sorted by weight descending. */
  rows: ParityRow[];
  /** Number of usable assets. */
  n: number;
}

/**
 * Inverse-volatility weights across a basket. Symbols without a positive
 * return volatility (too short, or flat) are dropped. With no usable assets the
 * result is empty.
 */
export function riskParity(series: ParityInput[]): ParityResult {
  const vols: { symbol: string; vol: number }[] = [];
  for (const s of series) {
    const r = toReturns(s.closes);
    if (r.length < 2) continue;
    const v = stdev(r);
    if (v > 0) vols.push({ symbol: s.symbol, vol: v });
  }

  const n = vols.length;
  if (n === 0) return { rows: [], n: 0 };

  let invSum = 0;
  for (const v of vols) invSum += 1 / v.vol;

  const rows: ParityRow[] = vols.map((v) => {
    const weight = 1 / v.vol / invSum;
    return {
      symbol: v.symbol,
      vol: v.vol,
      weight,
      equalWeight: 1 / n,
      // wᵢ·σᵢ normalized — equal for all rows when weights are inverse-vol.
      riskContribPct: 0,
    };
  });
  let rcSum = 0;
  for (const r of rows) rcSum += r.weight * r.vol;
  for (const r of rows) r.riskContribPct = rcSum > 0 ? ((r.weight * r.vol) / rcSum) * 100 : 0;

  rows.sort((a, b) => b.weight - a.weight);
  return { rows, n };
}
