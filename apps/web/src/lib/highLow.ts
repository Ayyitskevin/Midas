/**
 * High/low proximity analytics.
 *
 * For each symbol we locate the latest close within its N-bar range — the
 * highest high (Hmax) and lowest low (Lmin) over a lookback window:
 *
 *   pos      = (close − Lmin) / (Hmax − Lmin) × 100   (0 = at the low, 100 = at the high)
 *   fromHigh = (close / Hmax − 1) × 100               (≤ 0, distance below the high)
 *   fromLow  = (close / Lmin − 1) × 100               (≥ 0, distance above the low)
 *
 * Plus fresh-high / fresh-low flags when the latest bar itself printed the
 * window extreme. Useful for spotting names pressing a breakout vs basing
 * near support.
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed
 * candles.
 */

/** Minimal OHLC needed for high/low analytics. */
export interface HiLoBar {
  high: number;
  low: number;
  close: number;
}

export interface HiLoStats {
  /** Position of the close within the range, 0..100. */
  pos: number;
  /** Percent from the window high (≤ 0). */
  fromHigh: number;
  /** Percent from the window low (≥ 0). */
  fromLow: number;
  /** Highest high over the window. */
  high: number;
  /** Lowest low over the window. */
  low: number;
  /** True when the latest bar printed the window high. */
  freshHigh: boolean;
  /** True when the latest bar printed the window low. */
  freshLow: boolean;
  /** Number of bars in the window. */
  n: number;
}

export interface HiLoRow extends HiLoStats {
  symbol: string;
}

export type HiLoSort = 'pos' | 'fromHigh' | 'fromLow' | 'symbol';

const MIN_BARS = 2;

/**
 * Compute high/low proximity for one symbol over the last `window` bars (all
 * bars when omitted). Returns null with too little history, a degenerate flat
 * range, or a non-positive low.
 */
export function computeHiLo(bars: HiLoBar[], window?: number): HiLoStats | null {
  if (bars.length < MIN_BARS) return null;
  const w = window && window > 0 && window < bars.length ? bars.slice(-window) : bars;
  if (w.length < MIN_BARS) return null;

  let hmax = -Infinity;
  let lmin = Infinity;
  for (const b of w) {
    if (b.high > hmax) hmax = b.high;
    if (b.low < lmin) lmin = b.low;
  }
  if (!(hmax > lmin) || lmin <= 0) return null;

  const last = w[w.length - 1];
  const c = last.close;
  return {
    pos: ((c - lmin) / (hmax - lmin)) * 100,
    fromHigh: (c / hmax - 1) * 100,
    fromLow: (c / lmin - 1) * 100,
    high: hmax,
    low: lmin,
    freshHigh: last.high >= hmax,
    freshLow: last.low <= lmin,
    n: w.length,
  };
}

/** Build a sorted per-symbol high/low board, skipping symbols with too little history. */
export function hiLoBoard(
  series: { symbol: string; bars: HiLoBar[] }[],
  sort: HiLoSort = 'pos',
  window?: number,
): HiLoRow[] {
  const rows: HiLoRow[] = [];
  for (const s of series) {
    const stats = computeHiLo(s.bars, window);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortHiLo(rows, sort);
}

export function sortHiLo(rows: HiLoRow[], sort: HiLoSort): HiLoRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'fromHigh':
      // Closest below the high first (value nearest 0).
      out.sort((a, b) => b.fromHigh - a.fromHigh);
      break;
    case 'fromLow':
      // Furthest above the low first.
      out.sort((a, b) => b.fromLow - a.fromLow);
      break;
    case 'pos':
    default:
      out.sort((a, b) => b.pos - a.pos);
      break;
  }
  return out;
}
