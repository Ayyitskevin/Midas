/**
 * Choppiness Index (E.W. Dreiss).
 *
 * Measures whether a market is trending or chopping sideways over the last
 * `period` bars:
 *
 *   CHOP = 100 · log10( Σ trueRange(period) / (maxHigh − minLow) ) / log10(period)
 *
 * The sum of each bar's true range vs the net high−low span tells the story:
 * when price zig-zags, the ranges pile up far beyond the span → CHOP high
 * (choppy); when price travels in a straight line, Σ range ≈ span → CHOP low
 * (trending). The result is bounded to 0..100; conventionally < 38.2 is
 * trending and > 61.8 is ranging/chop.
 *
 * Reuses the tested true-range helper so gaps across the daily roll count.
 * Pure and synchronous for exact unit testing.
 */
import { trueRanges, type RangeBar } from './range';

/** Minimal OHLC needed for the Choppiness Index. */
export type ChopBar = RangeBar;

/** Trending below this; canonical Fibonacci threshold. */
export const CHOP_TREND = 38.2;
/** Choppy/ranging above this. */
export const CHOP_RANGE = 61.8;

export interface ChopStats {
  /** Choppiness Index, 0..100. */
  chop: number;
  /** Sum of true ranges over the window. */
  sumTR: number;
  /** Net high−low span over the window. */
  span: number;
  /** Lookback period actually used. */
  period: number;
  /** Total bars supplied. */
  n: number;
}

export interface ChopRow extends ChopStats {
  symbol: string;
}

export type ChopSort = 'chop' | 'symbol';

/**
 * Compute the Choppiness Index for one symbol over the last `period` bars.
 * Needs period+1 bars (so every windowed true range has a prior close).
 * Returns null with too little history or a degenerate (zero-span) window.
 */
export function computeChop(bars: ChopBar[], period = 14): ChopStats | null {
  if (period < 2 || bars.length < period + 1) return null;
  const tr = trueRanges(bars);
  const win = bars.slice(-period);
  const trWin = tr.slice(-period);

  let hmax = -Infinity;
  let lmin = Infinity;
  for (const b of win) {
    if (b.high > hmax) hmax = b.high;
    if (b.low < lmin) lmin = b.low;
  }
  let sumTR = 0;
  for (const t of trWin) sumTR += t;

  const span = hmax - lmin;
  if (!(span > 0) || sumTR <= 0) return null;

  const raw = (100 * Math.log10(sumTR / span)) / Math.log10(period);
  const chop = Math.max(0, Math.min(100, raw));
  return { chop, sumTR, span, period, n: bars.length };
}

/** Classify a Choppiness reading into a regime label. */
export function chopRegime(chop: number): 'trend' | 'chop' | 'mixed' {
  if (chop < CHOP_TREND) return 'trend';
  if (chop > CHOP_RANGE) return 'chop';
  return 'mixed';
}

/** Build a sorted per-symbol Choppiness board, skipping symbols with too little history. */
export function chopBoard(
  series: { symbol: string; bars: ChopBar[] }[],
  sort: ChopSort = 'chop',
  period = 14,
): ChopRow[] {
  const rows: ChopRow[] = [];
  for (const s of series) {
    const stats = computeChop(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortChop(rows, sort);
}

export function sortChop(rows: ChopRow[], sort: ChopSort): ChopRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'chop':
    default:
      // Ascending: cleanest trends (lowest CHOP) first.
      out.sort((a, b) => a.chop - b.chop);
      break;
  }
  return out;
}
