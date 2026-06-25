/**
 * Multi-timeframe consensus — collapse a symbol's trend across several
 * timeframes (e.g. 1H / 1D / 1W / 1M) into one read. When every timeframe agrees
 * the trend is "in gear" and worth respecting; when they conflict the symbol is
 * chopping between frames and signals are lower-conviction. Each frame's trend
 * comes from the shared signals engine; this rolls them up. Pure for testing.
 */

import type { Trend } from './signals';

export type MtfVerdict = 'bullish' | 'bearish' | 'mixed' | 'none';

export interface MtfConsensus {
  /** Frames trending up. */
  up: number;
  /** Frames trending down. */
  down: number;
  /** Frames with a usable trend (up + down). */
  total: number;
  /** Majority read across frames. */
  verdict: MtfVerdict;
  /** Share of the deciding side, 0–100 (100 = fully aligned). */
  alignedPct: number;
}

/**
 * Roll per-timeframe trends into a consensus. Null trends (a frame without
 * enough history) are ignored. The verdict is the simple majority; a tie is
 * "mixed" and no usable frames is "none".
 */
export function mtfConsensus(trends: (Trend | null)[]): MtfConsensus {
  let up = 0;
  let down = 0;
  for (const t of trends) {
    if (t === 'up') up += 1;
    else if (t === 'down') down += 1;
  }
  const total = up + down;
  let verdict: MtfVerdict = 'none';
  if (total > 0) verdict = up > down ? 'bullish' : down > up ? 'bearish' : 'mixed';
  const alignedPct = total > 0 ? (Math.max(up, down) / total) * 100 : 0;
  return { up, down, total, verdict, alignedPct };
}
