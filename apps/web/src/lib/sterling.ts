/**
 * Sterling ratio (Deane Sterling Jones) — a drawdown risk-adjusted return that,
 * unlike Calmar (which divides by the single worst drawdown), divides by the
 * *average* of the drawdown episodes and adds the metric's signature 10%
 * adjustment:
 *
 *     Sterling = annualized return / (average drawdown + 10%)
 *
 * Averaging across episodes keeps one freak plunge from dominating the score the
 * way it does for Calmar, while the +10% constant both keeps the ratio finite
 * (no divide-by-zero for a name that never drew down) and tempers it for very
 * low-drawdown names. We split the underwater curve into distinct peak-to-
 * recovery episodes and average their troughs.
 *
 * Reuses the shared simple returns, mean and drawdown series so the numbers line
 * up with the drawdown / Calmar / Ulcer / Pain boards. Pure for unit testing.
 */

import { toReturns } from './correlation';
import { mean } from './distribution';
import { drawdownSeries } from './drawdown';

/** The classic Sterling denominator adjustment (10%). */
export const STERLING_ADJ = 0.1;

export interface SterlingRow {
  symbol: string;
  /** annReturn / (avgDD + 10%). */
  sterling: number;
  /** Average drawdown-episode trough depth (positive fraction). */
  avgDD: number;
  /** Worst single drawdown over the period (positive fraction, context). */
  maxDD: number;
  /** Annualized return (arithmetic mean × periods/yr), as a fraction. */
  annReturn: number;
  /** Number of distinct drawdown episodes. */
  episodes: number;
  /** Returns used. */
  n: number;
}

export type SterlingSort = 'sterling' | 'avgDD' | 'annReturn' | 'symbol';

export interface SterlingInput {
  symbol: string;
  closes: number[];
}

/**
 * Trough depth of each drawdown episode — a maximal run of bars below the
 * running peak — as negative fractions (closeᵢ/peakᵢ − 1). Empty for a
 * monotonically rising or flat series.
 */
export function drawdownTroughs(closes: number[]): number[] {
  const dd = drawdownSeries(closes);
  const troughs: number[] = [];
  let inEpisode = false;
  let trough = 0;
  for (const d of dd) {
    if (d < 0) {
      if (!inEpisode) {
        inEpisode = true;
        trough = d;
      } else if (d < trough) {
        trough = d;
      }
    } else if (inEpisode) {
      troughs.push(trough);
      inEpisode = false;
    }
  }
  if (inEpisode) troughs.push(trough);
  return troughs;
}

/**
 * Sterling stats for one close series. Always defined (the +10% adjustment keeps
 * the denominator positive); returns null only with fewer than three closes.
 */
export function computeSterling(
  closes: number[],
  periodsPerYear: number,
): Omit<SterlingRow, 'symbol'> | null {
  if (closes.length < 3) return null;
  const returns = toReturns(closes);
  const annReturn = mean(returns) * periodsPerYear;

  const troughs = drawdownTroughs(closes); // negative depths
  const avgDD = troughs.length > 0 ? -mean(troughs) : 0; // positive magnitude

  const dd = drawdownSeries(closes);
  let worst = 0;
  for (const d of dd) if (d < worst) worst = d;
  const maxDD = worst < 0 ? -worst : 0;

  const sterling = annReturn / (avgDD + STERLING_ADJ);
  return { sterling, avgDD, maxDD, annReturn, episodes: troughs.length, n: returns.length };
}

/** Sterling board across a basket, sorted (default Sterling descending). */
export function sterlingBoard(
  series: SterlingInput[],
  periodsPerYear: number,
  sort: SterlingSort = 'sterling',
): SterlingRow[] {
  const rows: SterlingRow[] = [];
  for (const s of series) {
    const r = computeSterling(s.closes, periodsPerYear);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortSterling(rows, sort);
}

export function sortSterling(rows: SterlingRow[], sort: SterlingSort): SterlingRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'avgDD':
        return b.avgDD - a.avgDD; // most drawdown first
      case 'annReturn':
        return b.annReturn - a.annReturn;
      case 'sterling':
      default:
        return b.sterling - a.sterling; // best risk-adjusted first
    }
  });
  return out;
}
