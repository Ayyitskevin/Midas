/**
 * Supertrend — an ATR-based trend-following indicator.
 *
 * Bands sit a multiple of ATR around the median price (HL2):
 *   upper = HL2 + mult·ATR,  lower = HL2 − mult·ATR
 *
 * The final bands ratchet (the lower band only rises while price holds above
 * it, the upper band only falls while price holds below it), and the trend
 * flips up when price closes above the prior upper band, down when it closes
 * below the prior lower band. Supertrend is the active band — a trailing stop
 * below price in an up-trend, above price in a down-trend.
 *
 * Reuses the tested true-range helper for ATR. Pure and synchronous so it can
 * be unit-tested with exact, hand-computed candles.
 */
import { trueRanges, type RangeBar } from './range';

/** Minimal OHLC needed for Supertrend. */
export type SuperBar = RangeBar;

export type SuperFlip = 'bull' | 'bear' | 'none';

export interface SuperStats {
  /** +1 up-trend, −1 down-trend. */
  direction: number;
  /** Supertrend (trailing-stop) level. */
  supertrend: number;
  /** Distance from price to the stop, as a % of price (signed by trend). */
  distPct: number;
  /** Direction change on the latest bar, if any. */
  flip: SuperFlip;
  /** Number of bars supplied. */
  n: number;
}

export interface SuperRow extends SuperStats {
  symbol: string;
}

export type SuperSort = 'distPct' | 'symbol';

/** Classify a direction change between two consecutive bars. */
export function superFlip(prevDir: number, dir: number): SuperFlip {
  if (prevDir === dir) return 'none';
  return dir === 1 ? 'bull' : 'bear';
}

/**
 * Compute Supertrend for one symbol. Needs at least period + 2 bars; returns
 * null otherwise. The initial trend is seeded from the first window's drift so
 * monotonic series classify immediately.
 */
export function computeSupertrend(bars: SuperBar[], period = 10, mult = 3): SuperStats | null {
  const n = bars.length;
  if (period < 1 || n < period + 2) return null;

  const tr = trueRanges(bars);
  const atr = new Array<number>(n).fill(0);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += tr[i];
  atr[period - 1] = seed / period;
  for (let i = period; i < n; i++) atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;

  let prevUp = 0;
  let prevDn = 0;
  let prevTrend = bars[period - 1].close >= bars[0].close ? 1 : -1;
  const dirs: number[] = [];
  let lastSt = 0;
  for (let i = period - 1; i < n; i++) {
    const hl2 = (bars[i].high + bars[i].low) / 2;
    let up = hl2 - mult * atr[i];
    let dn = hl2 + mult * atr[i];
    let trend = prevTrend;
    if (i > period - 1) {
      const pc = bars[i - 1].close;
      up = pc > prevUp ? Math.max(up, prevUp) : up;
      dn = pc < prevDn ? Math.min(dn, prevDn) : dn;
      if (prevTrend === -1 && bars[i].close > prevDn) trend = 1;
      else if (prevTrend === 1 && bars[i].close < prevUp) trend = -1;
      else trend = prevTrend;
    }
    lastSt = trend === 1 ? up : dn;
    dirs.push(trend);
    prevUp = up;
    prevDn = dn;
    prevTrend = trend;
  }

  const close = bars[n - 1].close;
  const direction = dirs[dirs.length - 1];
  const prevDir = dirs.length >= 2 ? dirs[dirs.length - 2] : direction;
  return {
    direction,
    supertrend: lastSt,
    distPct: close > 0 ? ((close - lastSt) / close) * 100 : 0,
    flip: superFlip(prevDir, direction),
    n,
  };
}

/** Build a sorted per-symbol Supertrend board, skipping symbols with too little history. */
export function superBoard(
  series: { symbol: string; bars: SuperBar[] }[],
  sort: SuperSort = 'distPct',
  period = 10,
  mult = 3,
): SuperRow[] {
  const rows: SuperRow[] = [];
  for (const s of series) {
    const stats = computeSupertrend(s.bars, period, mult);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortSuper(rows, sort);
}

export function sortSuper(rows: SuperRow[], sort: SuperSort): SuperRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'distPct':
    default:
      // Strongest up-trends (largest cushion above the stop) first.
      out.sort((a, b) => b.distPct - a.distPct);
      break;
  }
  return out;
}
