/**
 * Range-expansion / NR7 analytics.
 *
 * For each symbol we measure how today's trading range compares to its recent
 * norm. "True range" (Wilder) is used throughout so the measure captures gaps
 * across the daily roll, not just the intrabar high−low:
 *
 *   TR[0] = high − low
 *   TR[i] = max(high−low, |high − prevClose|, |low − prevClose|)
 *
 * From the true-range series we derive:
 *   - rangePct     today's true range as a % of price
 *   - avgRangePct  the trailing-window average true range, same % basis
 *   - expansion    rangePct ÷ avgRangePct — >1 means today is expanding, <1
 *                  means contracting (coiling)
 *   - nrRank       rank of today's range among the last `lookback` bars
 *                  (1 = narrowest). nrRank === 1 over a 7-bar window is the
 *                  classic NR7 setup that often precedes a breakout.
 *
 * Everything is pure and synchronous so it can be unit-tested with exact,
 * hand-computed candles.
 */

/** Minimal OHLC needed for range analytics. */
export interface RangeBar {
  high: number;
  low: number;
  close: number;
}

export interface RangeStats {
  /** Today's true range as a percentage of the latest close. */
  rangePct: number;
  /** Trailing-window average true range, same percentage basis. */
  avgRangePct: number;
  /** rangePct ÷ avgRangePct. >1 = expanding, <1 = coiling. */
  expansion: number;
  /** Rank of today's true range among the last `lookback` bars (1 = narrowest). */
  nrRank: number;
  /** Effective lookback window actually used (min of requested and available). */
  lookback: number;
  /** True when today is the narrowest range in the window (e.g. NR7). */
  isNR: boolean;
  /** True when today is the widest range in the window (range expansion). */
  isWide: boolean;
  /** Number of bars used. */
  n: number;
}

export interface RangeRow extends RangeStats {
  symbol: string;
}

export type RangeSort = 'expansion' | 'rangePct' | 'avgRangePct' | 'nrRank' | 'symbol';

const MIN_BARS = 2;
/** Floor on the average true range so the expansion ratio never divides by zero. */
const MIN_RANGE = 1e-9;

/** True-range series for a list of bars. TR[0] falls back to the intrabar range. */
export function trueRanges(bars: RangeBar[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const hl = b.high - b.low;
    if (i === 0) {
      out.push(hl);
    } else {
      const pc = bars[i - 1].close;
      out.push(Math.max(hl, Math.abs(b.high - pc), Math.abs(b.low - pc)));
    }
  }
  return out;
}

/**
 * Compute range-expansion / NR stats for one symbol. The baseline average
 * excludes today so `expansion` answers "is today bigger than the days
 * before it". Returns null when there are too few bars or a non-positive
 * close.
 */
export function computeRange(bars: RangeBar[], window = 14, lookback = 7): RangeStats | null {
  if (bars.length < MIN_BARS) return null;
  const n = bars.length;
  const close = bars[n - 1].close;
  if (close <= 0) return null;

  const tr = trueRanges(bars);
  const todayTR = tr[n - 1];
  const rangePct = (todayTR / close) * 100;

  // Baseline: mean true range over the `window` bars immediately before today.
  const prior = tr.slice(Math.max(0, n - 1 - window), n - 1); // always ≥1 element since n≥2
  const avgTR = prior.reduce((a, b) => a + b, 0) / prior.length;
  const avgRangePct = (avgTR / close) * 100;
  const expansion = todayTR / Math.max(avgTR, MIN_RANGE);

  // Rank today's range among the last `lookback` bars (today included).
  const lb = Math.min(lookback, n);
  const windowTR = tr.slice(n - lb);
  let strictlyLess = 0;
  let strictlyMore = 0;
  for (let i = 0; i < windowTR.length - 1; i++) {
    if (windowTR[i] < todayTR) strictlyLess += 1;
    else if (windowTR[i] > todayTR) strictlyMore += 1;
  }
  const nrRank = strictlyLess + 1;
  // Require at least one strictly-different bar so a perfectly flat window
  // trips neither flag.
  const isNR = strictlyLess === 0 && strictlyMore > 0;
  const isWide = strictlyMore === 0 && strictlyLess > 0;

  return { rangePct, avgRangePct, expansion, nrRank, lookback: lb, isNR, isWide, n };
}

/** Build a sorted per-symbol range board, skipping symbols with too little history. */
export function rangeBoard(
  series: { symbol: string; bars: RangeBar[] }[],
  sort: RangeSort = 'expansion',
  window = 14,
  lookback = 7,
): RangeRow[] {
  const rows: RangeRow[] = [];
  for (const s of series) {
    const stats = computeRange(s.bars, window, lookback);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortRange(rows, sort);
}

export function sortRange(rows: RangeRow[], sort: RangeSort): RangeRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'nrRank':
      // Narrowest first; break ties toward the more compressed name.
      out.sort((a, b) => a.nrRank - b.nrRank || a.expansion - b.expansion);
      break;
    case 'rangePct':
      out.sort((a, b) => b.rangePct - a.rangePct);
      break;
    case 'avgRangePct':
      out.sort((a, b) => b.avgRangePct - a.avgRangePct);
      break;
    case 'expansion':
    default:
      out.sort((a, b) => b.expansion - a.expansion);
      break;
  }
  return out;
}
