/**
 * Donchian channel breakout (the Turtle channel).
 *
 * Builds the channel from the **prior** N bars (excluding the current one), so
 * the latest close is measured against the range it might be breaking out of:
 *
 *   upper = highest high over the prior N bars
 *   lower = lowest low over the prior N bars
 *   pos   = (close − lower) / (upper − lower) · 100
 *
 * `pos` exceeds 100 on a new N-bar-high breakout and drops below 0 on a new
 * N-bar low — the same convention as the Keltner board (KELT). The pure
 * price-extreme complement to the ATR (KELT) and stdev (BB) volatility bands.
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */

/** Minimal OHLC bar (no open needed). */
export interface DonBar {
  high: number;
  low: number;
  close: number;
}

export type DonBreak = 'up' | 'down' | 'none';

export interface DonStats {
  /** Position of the close in the prior-N channel, 0 = lower, 100 = upper (can exceed on breakouts). */
  pos: number;
  /** Channel width (upper − lower) as a % of the midline. */
  width: number;
  /** Breakout state when the close is outside the prior-N channel. */
  breakout: DonBreak;
  /** Upper channel (prior-N highest high). */
  upper: number;
  /** Channel midline. */
  mid: number;
  /** Lower channel (prior-N lowest low). */
  lower: number;
  /** Number of bars supplied. */
  n: number;
}

export interface DonRow extends DonStats {
  symbol: string;
}

export type DonSort = 'pos' | 'width' | 'symbol';

/**
 * Compute the latest Donchian breakout reading for one symbol. The channel is
 * the prior `period` bars, so the current bar can break out of it; needs more
 * than `period` bars and returns null otherwise.
 */
export function computeDonchian(bars: DonBar[], period = 20): DonStats | null {
  const n = bars.length;
  if (period < 1 || n < period + 1) return null;

  // Channel over the N bars immediately before the current one.
  let upper = -Infinity;
  let lower = Infinity;
  for (let i = n - 1 - period; i <= n - 2; i++) {
    if (bars[i].high > upper) upper = bars[i].high;
    if (bars[i].low < lower) lower = bars[i].low;
  }

  const close = bars[n - 1].close;
  const range = upper - lower;
  const pos = range > 0 ? ((close - lower) / range) * 100 : 50;
  const breakout: DonBreak = close > upper ? 'up' : close < lower ? 'down' : 'none';
  const mid = (upper + lower) / 2;
  const width = mid > 0 ? (range / mid) * 100 : 0;

  return { pos, width, breakout, upper, mid, lower, n };
}

/** Build a sorted per-symbol Donchian board, skipping symbols with too little history. */
export function donchianBoard(
  series: { symbol: string; bars: DonBar[] }[],
  sort: DonSort = 'pos',
  period = 20,
): DonRow[] {
  const rows: DonRow[] = [];
  for (const s of series) {
    const stats = computeDonchian(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortDon(rows, sort);
}

export function sortDon(rows: DonRow[], sort: DonSort): DonRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'width':
      out.sort((a, b) => b.width - a.width);
      break;
    case 'pos':
    default:
      out.sort((a, b) => b.pos - a.pos);
      break;
  }
  return out;
}
