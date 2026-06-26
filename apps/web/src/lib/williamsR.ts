/**
 * Williams %R (Larry Williams).
 *
 * Where the close sits in its recent high-low range, on a 0 to −100 scale:
 *
 *   %R = (highestHigh(N) − close) / (highestHigh(N) − lowestLow(N)) · −100
 *
 * 0 is the very top of the range, −100 the very bottom. Above −20 is
 * overbought, below −80 oversold. A momentum oscillator close to Stochastic's
 * %K but inverted (0…−100) and unsmoothed — lighter than STOCH.
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */

/** Minimal OHLC bar (no open needed). */
export interface WrBar {
  high: number;
  low: number;
  close: number;
}

export const WR_OVERBOUGHT = -20;
export const WR_OVERSOLD = -80;

export type WrZone = 'overbought' | 'oversold' | 'neutral';

export interface WrRow {
  symbol: string;
  wr: number;
  zone: WrZone;
  n: number;
}

export type WrSort = 'wr' | 'symbol';

/**
 * Compute the latest Williams %R for one symbol over the last `period` bars.
 * A flat window (zero range) maps to the −50 midpoint rather than dividing by
 * zero; returns null with too little history.
 */
export function computeWilliamsR(bars: WrBar[], period = 14): number | null {
  if (period < 1 || bars.length < period) return null;
  const w = bars.slice(-period);
  let hh = -Infinity;
  let ll = Infinity;
  for (const b of w) {
    if (b.high > hh) hh = b.high;
    if (b.low < ll) ll = b.low;
  }
  const range = hh - ll;
  if (range === 0) return -50;
  const close = w[w.length - 1].close;
  return ((hh - close) / range) * -100;
}

/** Classify a Williams %R reading into a zone. */
export function williamsZone(wr: number): WrZone {
  if (wr >= WR_OVERBOUGHT) return 'overbought';
  if (wr <= WR_OVERSOLD) return 'oversold';
  return 'neutral';
}

/** Build a sorted per-symbol Williams %R board, skipping symbols with too little history. */
export function williamsBoard(
  series: { symbol: string; bars: WrBar[] }[],
  sort: WrSort = 'wr',
  period = 14,
): WrRow[] {
  const rows: WrRow[] = [];
  for (const s of series) {
    const wr = computeWilliamsR(s.bars, period);
    if (wr !== null) rows.push({ symbol: s.symbol, wr, zone: williamsZone(wr), n: s.bars.length });
  }
  return sortWr(rows, sort);
}

export function sortWr(rows: WrRow[], sort: WrSort): WrRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'wr':
    default:
      // Highest (closest to 0 = overbought / strongest) first.
      out.sort((a, b) => b.wr - a.wr);
      break;
  }
  return out;
}
