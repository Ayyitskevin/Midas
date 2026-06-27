/**
 * Elder-Ray (Alexander Elder).
 *
 * Measures how far buyers and sellers push price away from a trend EMA:
 *
 *   Bull Power = high − EMA(close, N)   // how far buyers lift the high above the trend
 *   Bear Power = low  − EMA(close, N)   // how far sellers drive the low below it
 *
 * Read with the EMA's slope as a trend filter: in an up-trend a brief negative
 * Bear Power is a dip to buy; in a down-trend a brief positive Bull Power is a
 * bounce to sell. A buyer/seller-pressure board, distinct from the oscillator
 * family — it locates price relative to the trend, not within a range.
 *
 * Powers are reported in price units and as a % of the EMA (so the board is
 * comparable across symbols). Reuses the shared `emaSeries()` (first-value
 * seed) so the trend EMA matches the chart's. Pure and synchronous for exact
 * unit testing.
 */
import { emaSeries } from './indicators';

/** Minimal OHLC bar. */
export interface ElderBar {
  high: number;
  low: number;
  close: number;
}

export type ElderTrend = 'up' | 'down';

export interface ElderStats {
  /** Bull power (high − EMA), price units. */
  bull: number;
  /** Bear power (low − EMA), price units. */
  bear: number;
  /** Bull power as a % of the EMA. */
  bullPct: number;
  /** Bear power as a % of the EMA. */
  bearPct: number;
  /** EMA slope (rising = up-trend). */
  trend: ElderTrend;
  /** Number of bars supplied. */
  n: number;
}

export interface ElderRow extends ElderStats {
  symbol: string;
}

export type ElderSort = 'bull' | 'bear' | 'symbol';

/**
 * Compute the latest Elder-Ray reading for one symbol. Needs more than
 * `period` bars (for EMA warm-up and a prior bar for the slope); returns null
 * otherwise.
 */
export function computeElder(bars: ElderBar[], period = 13): ElderStats | null {
  const n = bars.length;
  if (period < 1 || n < period + 1) return null;

  const emaArr = emaSeries(
    bars.map((b) => b.close),
    period,
  );
  const ema = emaArr[n - 1];
  const emaPrev = emaArr[n - 2];
  const last = bars[n - 1];

  const bull = last.high - ema;
  const bear = last.low - ema;
  return {
    bull,
    bear,
    bullPct: ema !== 0 ? (bull / ema) * 100 : 0,
    bearPct: ema !== 0 ? (bear / ema) * 100 : 0,
    trend: ema >= emaPrev ? 'up' : 'down',
    n,
  };
}

/** Build a sorted per-symbol Elder-Ray board, skipping symbols with too little history. */
export function elderBoard(
  series: { symbol: string; bars: ElderBar[] }[],
  sort: ElderSort = 'bull',
  period = 13,
): ElderRow[] {
  const rows: ElderRow[] = [];
  for (const s of series) {
    const stats = computeElder(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortElder(rows, sort);
}

export function sortElder(rows: ElderRow[], sort: ElderSort): ElderRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'bear':
      out.sort((a, b) => b.bearPct - a.bearPct);
      break;
    case 'bull':
    default:
      out.sort((a, b) => b.bullPct - a.bullPct);
      break;
  }
  return out;
}
