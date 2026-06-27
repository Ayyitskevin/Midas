/**
 * Balance of Power (Igor Livshin).
 *
 * Per bar, where the close finished within the bar's range relative to the open
 * — i.e. who won the candle:
 *
 *   BOP_bar = (close − open) / (high − low)     (−1 sellers … +1 buyers; 0 if flat)
 *   BOP     = SMA(BOP_bar, N)                    (smoothed over N bars)
 *
 * Positive means buyers closed price up from the open through the session;
 * negative means sellers pushed it down. A simple buyer/seller-pressure gauge
 * distinct from Elder-Ray (which measures distance from a trend EMA).
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */

/** OHLC bar (open is required for BOP). */
export interface BopBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

export type BopSide = 'buyers' | 'sellers';

export interface BopStats {
  /** Smoothed Balance of Power (SMA of the per-bar BOP). */
  bop: number;
  /** The latest bar's raw BOP. */
  raw: number;
  /** Who's in control (sign of the smoothed BOP). */
  side: BopSide;
  /** Number of bars supplied. */
  n: number;
}

export interface BopRow extends BopStats {
  symbol: string;
}

export type BopSort = 'bop' | 'raw' | 'symbol';

/** Per-bar BOP = (close − open) / (high − low); 0 when the bar has no range. */
export function barBop(bar: BopBar): number {
  const range = bar.high - bar.low;
  return range === 0 ? 0 : (bar.close - bar.open) / range;
}

/**
 * Compute the latest Balance of Power for one symbol over the last `period`
 * bars. Returns null with too little history.
 */
export function computeBop(bars: BopBar[], period = 14): BopStats | null {
  if (period < 1 || bars.length < period) return null;
  const w = bars.slice(-period);
  let sum = 0;
  for (const b of w) sum += barBop(b);
  const bop = sum / period;
  const raw = barBop(w[w.length - 1]);
  return { bop, raw, side: bop >= 0 ? 'buyers' : 'sellers', n: bars.length };
}

/** Build a sorted per-symbol Balance of Power board, skipping symbols with too little history. */
export function bopBoard(
  series: { symbol: string; bars: BopBar[] }[],
  sort: BopSort = 'bop',
  period = 14,
): BopRow[] {
  const rows: BopRow[] = [];
  for (const s of series) {
    const stats = computeBop(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortBop(rows, sort);
}

export function sortBop(rows: BopRow[], sort: BopSort): BopRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'raw':
      out.sort((a, b) => b.raw - a.raw);
      break;
    case 'bop':
    default:
      out.sort((a, b) => b.bop - a.bop);
      break;
  }
  return out;
}
