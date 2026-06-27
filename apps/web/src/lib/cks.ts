/**
 * Chande Kroll Stop screener helpers.
 *
 * Tushar Chande & Stanley Kroll's stop system ("The New Technical Trader")
 * builds two ATR-based trailing stops in two stages. With ATR period `p`,
 * multiplier `x`, and a second look-back `q`:
 *
 *   Stage 1 (preliminary, per bar):
 *     highStop = highestHigh(p) − x·ATR(p)
 *     lowStop  = lowestLow(p)  + x·ATR(p)
 *   Stage 2 (final, per bar):
 *     stopShort = highest(highStop, q)   (upper band / resistance, short-side stop)
 *     stopLong  = lowest(lowStop, q)     (lower band / support, long-side stop)
 *
 * Price above the upper band is an uptrend break, below the lower band a
 * downtrend break, in between is range. ATR is Wilder's (the same RMA the
 * Supertrend board uses), and `trueRanges` is shared with the range board.
 * The widely-used (TradingView) defaults are p = 10, x = 1, q = 9; the original
 * book used a larger multiplier (≈3).
 */
import { trueRanges, type RangeBar } from './range';

export type CksBar = RangeBar;
export type CksRegime = 'up' | 'down' | 'mid';

export interface CksStats {
  /** Upper band / short-side stop (resistance). */
  stopShort: number;
  /** Lower band / long-side stop (support). */
  stopLong: number;
  /** Regime from close vs the two stops. */
  regime: CksRegime;
  /** Distance of close above the lower (support) stop, as a % of price. */
  supportPct: number;
  /** Distance of close below the upper (resistance) stop, as a % of price. */
  resistPct: number;
  /** Close's position within the [stopLong, stopShort] channel, in % (<0 below, >100 above). */
  pos: number;
  /** Number of bars supplied. */
  n: number;
}

export interface CksRow extends CksStats {
  symbol: string;
}

export type CksSort = 'pos' | 'support' | 'resist' | 'symbol';

/** Wilder (RMA) ATR over the true-range series — seeded with an SMA at index period−1. */
function wilderAtr(tr: number[], period: number): number[] {
  const n = tr.length;
  const atr = new Array<number>(n).fill(NaN);
  if (n < period) return atr;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += tr[i];
  atr[period - 1] = seed / period;
  for (let i = period; i < n; i++) atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  return atr;
}

/**
 * Compute the latest Chande Kroll Stop for one symbol. Needs at least
 * `p + q − 1` bars so the preliminary stops span the full q window; returns
 * null on bad params or too little history.
 */
export function computeCks(bars: CksBar[], p = 10, x = 1, q = 9): CksStats | null {
  if (p < 1 || q < 1 || x < 0) return null;
  const n = bars.length;
  if (n < p + q - 1) return null;

  const tr = trueRanges(bars);
  const atr = wilderAtr(tr, p);

  // Preliminary stops, defined from bar p−1 where ATR and the p-bar extremes exist.
  const highStop = new Array<number>(n).fill(NaN);
  const lowStop = new Array<number>(n).fill(NaN);
  for (let i = p - 1; i < n; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - p + 1; j <= i; j++) {
      if (bars[j].high > hh) hh = bars[j].high;
      if (bars[j].low < ll) ll = bars[j].low;
    }
    highStop[i] = hh - x * atr[i];
    lowStop[i] = ll + x * atr[i];
  }

  // Final stops at the latest bar: highest highStop / lowest lowStop over q bars.
  const last = n - 1;
  let stopShort = -Infinity;
  let stopLong = Infinity;
  for (let j = last - q + 1; j <= last; j++) {
    if (highStop[j] > stopShort) stopShort = highStop[j];
    if (lowStop[j] < stopLong) stopLong = lowStop[j];
  }

  const close = bars[last].close;
  const regime: CksRegime = close > stopShort ? 'up' : close < stopLong ? 'down' : 'mid';
  const span = stopShort - stopLong;
  const pos = span > 0 ? (100 * (close - stopLong)) / span : 50;
  const supportPct = close > 0 ? ((close - stopLong) / close) * 100 : 0;
  const resistPct = close > 0 ? ((stopShort - close) / close) * 100 : 0;
  return { stopShort, stopLong, regime, supportPct, resistPct, pos, n };
}

/** Build a sorted per-symbol Chande Kroll Stop board, skipping thin history. */
export function cksBoard(
  series: { symbol: string; bars: CksBar[] }[],
  sort: CksSort = 'pos',
  p = 10,
  x = 1,
  q = 9,
): CksRow[] {
  const rows: CksRow[] = [];
  for (const s of series) {
    const stats = computeCks(s.bars, p, x, q);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortCks(rows, sort);
}

export function sortCks(rows: CksRow[], sort: CksSort): CksRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'support':
      out.sort((a, b) => b.supportPct - a.supportPct);
      break;
    case 'resist':
      out.sort((a, b) => b.resistPct - a.resistPct);
      break;
    case 'pos':
    default:
      // High pos (up-breaks) first, low pos (down-breaks) last.
      out.sort((a, b) => b.pos - a.pos);
      break;
  }
  return out;
}
