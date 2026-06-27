/**
 * Random Walk Index (E. Michael Poulos, 1991).
 *
 * Measures how far price has travelled relative to the distance a random walk
 * of the same volatility would be expected to cover. For every look-back
 * k = 2..period the displacement is compared to the random-walk yardstick
 * ATR(k)·√k:
 *
 *   RWIhigh(k) = (high[today]   − low[k bars ago])  / (ATR(k)·√k)
 *   RWIlow(k)  = (high[k ago]   − low[today])       / (ATR(k)·√k)
 *
 * The reported RWIhigh / RWIlow are the maxima of those ratios across all k.
 * A value ≥ 1 means price has out-run a random walk — a genuine trend; values
 * below 1 read as directionless noise. RWIhigh quantifies up-trend strength,
 * RWIlow down-trend strength; the larger of the two names the regime.
 *
 * The signed `rwi` collapses both into one sortable number: +RWIhigh when the
 * up side dominates, −RWIlow when the down side does, so a board sorted by it
 * runs strongest up-trends → noise → strongest down-trends.
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */

export type RwiDir = 'up' | 'down';

export interface RwiBar {
  high: number;
  low: number;
  close: number;
}

export interface RwiStats {
  /** Max RWIhigh(k) over k = 2..period — up-trend strength. */
  rwiHigh: number;
  /** Max RWIlow(k) over k = 2..period — down-trend strength. */
  rwiLow: number;
  /** Signed strength: +rwiHigh if the up side wins, −rwiLow if the down side wins. */
  rwi: number;
  /** Which side dominates. */
  dir: RwiDir;
  /** True when the dominant side ≥ 1 (out-ran a random walk → trending). */
  trending: boolean;
  /** Number of bars supplied. */
  n: number;
}

export interface RwiRow extends RwiStats {
  symbol: string;
}

export type RwiSort = 'rwi' | 'high' | 'low' | 'trend' | 'symbol';

/** True range of bar i, given the prior bar's close (undefined for the first bar). */
function trueRange(bar: RwiBar, prevClose: number | undefined): number {
  const hl = bar.high - bar.low;
  if (prevClose === undefined) return hl;
  return Math.max(hl, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
}

/**
 * Compute the latest Random Walk Index for one symbol. Returns null with too
 * little history (needs ≥ period + 1 bars so the deepest look-back and its ATR
 * both have a prior close to lean on).
 */
export function computeRwi(bars: RwiBar[], period = 14): RwiStats | null {
  if (period < 2 || bars.length < period + 1) return null;

  // True range for every bar (first bar falls back to its high−low).
  const tr: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    tr.push(trueRange(bars[i], i > 0 ? bars[i - 1].close : undefined));
  }

  const last = bars.length - 1;
  let rwiHigh = -Infinity;
  let rwiLow = -Infinity;

  for (let k = 2; k <= period; k++) {
    // Average true range over the last k bars: tr[last-k+1 .. last].
    let sum = 0;
    for (let i = last - k + 1; i <= last; i++) sum += tr[i];
    const atr = sum / k;
    if (atr <= 0) continue; // flat window — no random-walk yardstick

    const denom = atr * Math.sqrt(k);
    const hi = (bars[last].high - bars[last - k].low) / denom;
    const lo = (bars[last - k].high - bars[last].low) / denom;
    if (hi > rwiHigh) rwiHigh = hi;
    if (lo > rwiLow) rwiLow = lo;
  }

  if (!Number.isFinite(rwiHigh) || !Number.isFinite(rwiLow)) return null;

  const dir: RwiDir = rwiHigh >= rwiLow ? 'up' : 'down';
  const rwi = dir === 'up' ? rwiHigh : -rwiLow;
  const trending = Math.max(rwiHigh, rwiLow) >= 1;
  return { rwiHigh, rwiLow, rwi, dir, trending, n: bars.length };
}

/** Build a sorted per-symbol RWI board, skipping symbols with too little history. */
export function rwiBoard(
  series: { symbol: string; bars: RwiBar[] }[],
  sort: RwiSort = 'rwi',
  period = 14,
): RwiRow[] {
  const rows: RwiRow[] = [];
  for (const s of series) {
    const stats = computeRwi(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortRwi(rows, sort);
}

export function sortRwi(rows: RwiRow[], sort: RwiSort): RwiRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'high':
      out.sort((a, b) => b.rwiHigh - a.rwiHigh);
      break;
    case 'low':
      out.sort((a, b) => b.rwiLow - a.rwiLow);
      break;
    case 'trend':
      // Strongest trend of either side first, regardless of direction.
      out.sort((a, b) => Math.max(b.rwiHigh, b.rwiLow) - Math.max(a.rwiHigh, a.rwiLow));
      break;
    case 'rwi':
    default:
      out.sort((a, b) => b.rwi - a.rwi);
      break;
  }
  return out;
}
