/**
 * Aroon — trend by time-since-extreme (Chande).
 *
 * Over the last `period` bars, Aroon measures how recently each name printed
 * its highest high and lowest low:
 *
 *   Aroon-Up   = 100 · (period − barsSinceHighestHigh) / period
 *   Aroon-Down = 100 · (period − barsSinceLowestLow)  / period
 *   Oscillator = Aroon-Up − Aroon-Down   (−100..100)
 *
 * A reading near 100 means the extreme is fresh (strong trend that way); the
 * oscillator's sign is the trend bias. Unlike HILO (price distance), Aroon
 * measures the *age* of the extreme.
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */

/** Minimal high/low bar. */
export interface AroonBar {
  high: number;
  low: number;
}

export interface AroonStats {
  /** Aroon-Up, 0..100. */
  up: number;
  /** Aroon-Down, 0..100. */
  down: number;
  /** Aroon oscillator (up − down), −100..100. */
  osc: number;
  /** Lookback period used. */
  period: number;
  /** Number of bars supplied. */
  n: number;
}

export interface AroonRow extends AroonStats {
  symbol: string;
}

export type AroonSort = 'osc' | 'up' | 'down' | 'symbol';

/**
 * Compute Aroon for one symbol over the last `period` bars (a window of
 * period+1 bars including the current). Ties resolve to the most recent
 * extreme. Returns null with too little history.
 */
export function computeAroon(bars: AroonBar[], period = 25): AroonStats | null {
  if (period < 1 || bars.length < period + 1) return null;
  const w = bars.slice(-(period + 1)); // indices 0..period, current bar last
  let idxHigh = 0;
  let idxLow = 0;
  for (let i = 0; i < w.length; i++) {
    if (w[i].high >= w[idxHigh].high) idxHigh = i; // >= → most recent high
    if (w[i].low <= w[idxLow].low) idxLow = i; // <= → most recent low
  }
  const up = (idxHigh / period) * 100; // idxHigh = period − barsSinceHigh
  const down = (idxLow / period) * 100;
  return { up, down, osc: up - down, period, n: bars.length };
}

/** Build a sorted per-symbol Aroon board, skipping symbols with too little history. */
export function aroonBoard(
  series: { symbol: string; bars: AroonBar[] }[],
  sort: AroonSort = 'osc',
  period = 25,
): AroonRow[] {
  const rows: AroonRow[] = [];
  for (const s of series) {
    const stats = computeAroon(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortAroon(rows, sort);
}

export function sortAroon(rows: AroonRow[], sort: AroonSort): AroonRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'up':
      out.sort((a, b) => b.up - a.up);
      break;
    case 'down':
      out.sort((a, b) => b.down - a.down);
      break;
    case 'osc':
    default:
      // Strongest up-trend bias first.
      out.sort((a, b) => b.osc - a.osc);
      break;
  }
  return out;
}
