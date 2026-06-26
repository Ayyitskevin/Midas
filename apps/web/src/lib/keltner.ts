/**
 * Keltner channels.
 *
 * An EMA midline wrapped by ATR-scaled bands:
 *   middle = EMA(close, period)
 *   upper  = middle + mult·ATR,  lower = middle − mult·ATR
 *
 * Per symbol we report where the close sits in the channel (0 = lower → 100 =
 * upper), the channel width relative to price, and a breakout flag when price
 * closes outside the bands. ATR-based, so it's the volatility-band complement
 * to Bollinger's stdev bands (BB).
 *
 * Reuses the shared `ema()` (so the midline matches the chart's EMA overlay)
 * and the tested `trueRanges()` for a Wilder ATR. Pure and synchronous for
 * exact unit testing.
 */
import type { Candle } from '@midas/shared';
import { ema } from './indicators';
import { trueRanges } from './range';

export type KeltBreak = 'up' | 'down' | 'none';

export interface KeltStats {
  /** Position of the close in the channel, 0 = lower band, 100 = upper. */
  pos: number;
  /** Channel width (upper − lower) as a % of the midline. */
  width: number;
  /** Breakout state when the close is outside the channel. */
  breakout: KeltBreak;
  /** Upper band. */
  upper: number;
  /** Middle band (EMA). */
  middle: number;
  /** Lower band. */
  lower: number;
  /** Number of candles supplied. */
  n: number;
}

export interface KeltRow extends KeltStats {
  symbol: string;
}

export type KeltSort = 'pos' | 'width' | 'symbol';

/**
 * Compute the latest Keltner channel for one symbol. Needs more than `period`
 * candles (for both the EMA and the Wilder ATR); returns null otherwise or on
 * a non-positive midline.
 */
export function computeKeltner(candles: Candle[], period = 20, mult = 2): KeltStats | null {
  const n = candles.length;
  if (period < 1 || n < period + 1) return null;

  const line = ema(candles, period);
  if (line.length === 0) return null;
  const middle = line[line.length - 1].value;
  if (middle <= 0) return null;

  // Wilder ATR over the true-range series.
  const tr = trueRanges(candles);
  let atr = 0;
  for (let i = 0; i < period; i++) atr += tr[i];
  atr /= period;
  for (let i = period; i < n; i++) atr = (atr * (period - 1) + tr[i]) / period;

  const upper = middle + mult * atr;
  const lower = middle - mult * atr;
  const width = upper - lower;
  const close = candles[n - 1].close;
  const pos = width > 0 ? ((close - lower) / width) * 100 : 50;
  const breakout: KeltBreak = close > upper ? 'up' : close < lower ? 'down' : 'none';

  return { pos, width: (width / middle) * 100, breakout, upper, middle, lower, n };
}

/** Build a sorted per-symbol Keltner board, skipping symbols with too little history. */
export function keltnerBoard(
  series: { symbol: string; candles: Candle[] }[],
  sort: KeltSort = 'pos',
  period = 20,
  mult = 2,
): KeltRow[] {
  const rows: KeltRow[] = [];
  for (const s of series) {
    const stats = computeKeltner(s.candles, period, mult);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortKeltner(rows, sort);
}

export function sortKeltner(rows: KeltRow[], sort: KeltSort): KeltRow[] {
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
