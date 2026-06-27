/**
 * Pretty Good Oscillator (Mark Johnson).
 *
 * Measures how far price has stretched from its mean, expressed in units of
 * average true range — so the reading is comparable across symbols regardless
 * of price or volatility:
 *
 *   PGO = (close − SMA(close, N)) / EMA(TrueRange, N)
 *
 * The numerator is the distance from the N-bar simple moving average; the
 * denominator is an N-bar EMA of the true range (the LazyBear form, not a
 * Wilder ATR). Above zero means price is above its mean (uptrend bias), below
 * zero below it; ±3 are the momentum-breakout extremes (a stretch of three
 * average ranges from the mean). Default look-back N = 89 (Johnson's original).
 *
 * Reuses the app's shared seeded emaSeries for the EMA of true range. Pure and
 * synchronous so it can be unit-tested with hand-computed bars.
 */

import { emaSeries } from './indicators';

export type PgoSide = 'pos' | 'neg';
export type PgoDir = 'up' | 'down';
export type PgoZone = 'hi' | 'lo' | 'mid';

export interface PgoBar {
  high: number;
  low: number;
  close: number;
}

export interface PgoStats {
  /** Pretty Good Oscillator at the latest bar (ATR units from the mean). */
  pgo: number;
  /** PGO one bar back, for slope / direction. */
  prev: number;
  /** PGO rising (pgo ≥ prev) or falling. */
  dir: PgoDir;
  /** Price above (pos) or below (neg) its mean. */
  side: PgoSide;
  /** ≥ +3 stretched up, ≤ −3 stretched down, otherwise mid. */
  zone: PgoZone;
  /** Number of bars supplied. */
  n: number;
}

export interface PgoRow extends PgoStats {
  symbol: string;
}

export type PgoSort = 'pgo' | 'abs' | 'symbol';

const EXTREME = 3;

/** True range of bar i, given the prior close (undefined for the first bar). */
function trueRange(bar: PgoBar, prevClose: number | undefined): number {
  const hl = bar.high - bar.low;
  if (prevClose === undefined) return hl;
  return Math.max(hl, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
}

/**
 * Compute the latest Pretty Good Oscillator for one symbol. Returns null with
 * bad params or too little history (needs ≥ period bars for the moving average).
 */
export function computePgo(bars: PgoBar[], period = 89): PgoStats | null {
  if (period < 1) return null;
  const n = bars.length;
  if (n < period) return null;

  const closes = bars.map((b) => b.close);
  const tr = bars.map((b, i) => trueRange(b, i > 0 ? bars[i - 1].close : undefined));
  const atr = emaSeries(tr, period);

  // PGO at index i = (close[i] − SMA(close, period)[i]) / atr[i], defined for i ≥ period − 1.
  const pgoAt = (i: number): number => {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    const sma = sum / period;
    return atr[i] !== 0 ? (closes[i] - sma) / atr[i] : 0;
  };

  const last = n - 1;
  const pgo = pgoAt(last);
  const prev = last - 1 >= period - 1 ? pgoAt(last - 1) : pgo;
  const zone: PgoZone = pgo >= EXTREME ? 'hi' : pgo <= -EXTREME ? 'lo' : 'mid';
  return { pgo, prev, dir: pgo >= prev ? 'up' : 'down', side: pgo >= 0 ? 'pos' : 'neg', zone, n };
}

/** Build a sorted per-symbol PGO board, skipping symbols with too little history. */
export function pgoBoard(
  series: { symbol: string; bars: PgoBar[] }[],
  sort: PgoSort = 'pgo',
  period = 89,
): PgoRow[] {
  const rows: PgoRow[] = [];
  for (const s of series) {
    const stats = computePgo(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortPgo(rows, sort);
}

export function sortPgo(rows: PgoRow[], sort: PgoSort): PgoRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'abs':
      // Most stretched (either direction) first.
      out.sort((a, b) => Math.abs(b.pgo) - Math.abs(a.pgo));
      break;
    case 'pgo':
    default:
      out.sort((a, b) => b.pgo - a.pgo);
      break;
  }
  return out;
}
