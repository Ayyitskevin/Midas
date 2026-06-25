/**
 * Stretch screener — how far each symbol has pulled away from its own moving
 * average, the raw material of a mean-reversion scan. For a trailing window we
 * take the simple moving average and its standard deviation, then express the
 * latest price as a z-score (distance from the MA in σ) and as Bollinger %B
 * (position within the MA ± kσ bands, 0 at the lower band, 1 at the upper).
 * Stretched-high names are flagged overbought, stretched-low oversold.
 *
 * Reuses the shared mean / population stdev so the numbers line up with the
 * terminal's other stats. Pure and side-effect free for unit testing.
 */

import { mean, stdev } from './distribution';

export interface StretchInput {
  symbol: string;
  closes: number[];
}

export type StretchLabel = 'overbought' | 'oversold' | 'neutral';

export interface StretchRow {
  symbol: string;
  /** Latest close. */
  last: number;
  /** Simple moving average over the window. */
  ma: number;
  /** (last − ma) / σ. */
  zscore: number;
  /** Bollinger %B with the given band multiplier (k); 0 = lower band, 1 = upper. */
  percentB: number;
  /** Percent distance of the last price from the MA. */
  distancePct: number;
  /** overbought when %B ≥ 1, oversold when %B ≤ 0, else neutral. */
  label: StretchLabel;
  /** Window length actually used. */
  n: number;
}

export type StretchSort = 'zscore' | 'percentB' | 'distance' | 'symbol';

/**
 * Stretch stats for a single close series over the trailing `window`, with band
 * multiplier `k` (default 2). Returns null when the window can't be filled.
 * A flat window (σ = 0) reports z = 0 and %B = 0.5 (price sitting on the MA).
 */
export function computeStretch(closes: number[], window: number, k = 2): StretchRow | null {
  const w = Math.floor(window);
  if (w < 2 || closes.length < w || k <= 0) return null;
  const slice = closes.slice(-w);
  const ma = mean(slice);
  const sd = stdev(slice);
  const last = slice[slice.length - 1];
  const zscore = sd > 0 ? (last - ma) / sd : 0;
  const percentB = sd > 0 ? (zscore + k) / (2 * k) : 0.5;
  const distancePct = ma !== 0 ? (last / ma - 1) * 100 : 0;
  const label: StretchLabel = percentB >= 1 ? 'overbought' : percentB <= 0 ? 'oversold' : 'neutral';
  return { symbol: '', last, ma, zscore, percentB, distancePct, label, n: w };
}

/** Stretch board across several series, sorted (defaults to z-score descending). */
export function stretchBoard(
  series: StretchInput[],
  window: number,
  sort: StretchSort = 'zscore',
  k = 2,
): StretchRow[] {
  const rows: StretchRow[] = [];
  for (const s of series) {
    const row = computeStretch(s.closes, window, k);
    if (row) rows.push({ ...row, symbol: s.symbol });
  }
  return sortStretch(rows, sort);
}

export function sortStretch(rows: StretchRow[], sort: StretchSort): StretchRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'percentB':
        return b.percentB - a.percentB;
      case 'distance':
        return b.distancePct - a.distancePct;
      case 'zscore':
      default:
        return b.zscore - a.zscore;
    }
  });
  return out;
}
