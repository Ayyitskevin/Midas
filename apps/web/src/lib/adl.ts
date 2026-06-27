/**
 * Accumulation/Distribution Line (Marc Chaikin).
 *
 * A cumulative volume-flow line: each bar adds money-flow volume, weighted by
 * where the close sat in the bar's range:
 *
 *   MFM = ((close − low) − (high − close)) / (high − low)   (−1 … +1; 0 if flat)
 *   MFV = MFM · volume
 *   ADL = running cumulative sum of MFV
 *
 * The raw ADL level isn't comparable across symbols (it depends on volume scale
 * and history length), so the board reports the line's behaviour over the last
 * N bars: its normalized slope (net flow ÷ volume, −100..+100), the trend, and
 * whether the ADL just made a new N-bar high (accumulation breakout) or low
 * (distribution breakdown) — the cumulative-line signal a bounded oscillator
 * can't give. Distinct from OBV (which adds whole volume by close direction).
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */

/** OHLCV bar. */
export interface AdlBar {
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type AdlTrend = 'up' | 'down';
export type AdlExtreme = 'high' | 'low' | 'none';

export interface AdlStats {
  /** Latest cumulative A/D line value. */
  adl: number;
  /** Net flow over the last N bars as a % of volume (−100..+100). */
  flowPct: number;
  /** ADL rose (accumulation) or fell (distribution) over the window. */
  trend: AdlTrend;
  /** ADL at a fresh N-bar high / low. */
  extreme: AdlExtreme;
  /** Number of bars supplied. */
  n: number;
}

export interface AdlRow extends AdlStats {
  symbol: string;
}

export type AdlSort = 'flow' | 'symbol';

/** Money-flow multiplier: where the close sat in the bar's range (−1..+1; 0 if no range). */
export function moneyFlowMultiplier(bar: AdlBar): number {
  const range = bar.high - bar.low;
  return range === 0 ? 0 : (2 * bar.close - bar.high - bar.low) / range;
}

/**
 * Compute the latest A/D line reading for one symbol. Needs `period + 1` bars
 * (to measure the line's change over the window); returns null otherwise.
 */
export function computeAdl(bars: AdlBar[], period = 20): AdlStats | null {
  const n = bars.length;
  if (period < 1 || n < period + 1) return null;

  // Cumulative A/D line over all bars.
  const line: number[] = [];
  let cum = 0;
  for (const b of bars) {
    cum += moneyFlowMultiplier(b) * b.volume;
    line.push(cum);
  }

  const adl = line[n - 1];
  const startIdx = n - 1 - period; // ADL `period` bars ago
  const windowMfv = adl - line[startIdx];

  let windowVol = 0;
  for (let i = n - period; i < n; i++) windowVol += bars[i].volume;

  // New N-bar high / low of the ADL across the window [startIdx .. n-1].
  let maxPrev = -Infinity;
  let minPrev = Infinity;
  for (let i = startIdx; i < n - 1; i++) {
    if (line[i] > maxPrev) maxPrev = line[i];
    if (line[i] < minPrev) minPrev = line[i];
  }
  const extreme: AdlExtreme = adl > maxPrev ? 'high' : adl < minPrev ? 'low' : 'none';

  return {
    adl,
    flowPct: windowVol > 0 ? (windowMfv / windowVol) * 100 : 0,
    trend: windowMfv >= 0 ? 'up' : 'down',
    extreme,
    n,
  };
}

/** Build a sorted per-symbol A/D line board, skipping symbols with too little history. */
export function adlBoard(
  series: { symbol: string; bars: AdlBar[] }[],
  sort: AdlSort = 'flow',
  period = 20,
): AdlRow[] {
  const rows: AdlRow[] = [];
  for (const s of series) {
    const stats = computeAdl(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortAdl(rows, sort);
}

export function sortAdl(rows: AdlRow[], sort: AdlSort): AdlRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'flow':
    default:
      out.sort((a, b) => b.flowPct - a.flowPct);
      break;
  }
  return out;
}
