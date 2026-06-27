/**
 * Chaikin Money Flow (Marc Chaikin).
 *
 * The bounded, windowed sibling of the A/D line — net money-flow volume over
 * total volume across the last N bars:
 *
 *   MFM = ((close − low) − (high − close)) / (high − low)   (−1 … +1; 0 if flat)
 *   CMF = Σ(MFM · volume, N) / Σ(volume, N)
 *
 * Stays in −1..+1: positive means buying pressure dominated the window
 * (accumulation), negative means selling (distribution). Sustained readings
 * beyond ±0.25 are considered strong. An oscillator, where the A/D line is a
 * cumulative line; reuses the shared money-flow multiplier.
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */
import { moneyFlowMultiplier, type AdlBar } from './adl';

/** OHLCV bar (same shape the A/D line uses). */
export type CmfBar = AdlBar;

/** |CMF| at or beyond this is "strong" accumulation / distribution. */
export const CMF_STRONG = 0.25;

export type CmfSide = 'buyers' | 'sellers';

export interface CmfStats {
  /** Chaikin Money Flow (−1..+1). */
  cmf: number;
  /** Sign of the flow. */
  side: CmfSide;
  /** |CMF| ≥ CMF_STRONG. */
  strong: boolean;
  /** Number of bars supplied. */
  n: number;
}

export interface CmfRow extends CmfStats {
  symbol: string;
}

export type CmfSort = 'cmf' | 'symbol';

/**
 * Compute the latest Chaikin Money Flow for one symbol over the last `period`
 * bars. A zero-volume window maps to 0; returns null with too little history.
 */
export function computeCmf(bars: CmfBar[], period = 20): CmfStats | null {
  if (period < 1 || bars.length < period) return null;
  const w = bars.slice(-period);
  let mfv = 0;
  let vol = 0;
  for (const b of w) {
    mfv += moneyFlowMultiplier(b) * b.volume;
    vol += b.volume;
  }
  const cmf = vol > 0 ? mfv / vol : 0;
  return { cmf, side: cmf >= 0 ? 'buyers' : 'sellers', strong: Math.abs(cmf) >= CMF_STRONG, n: bars.length };
}

/** Build a sorted per-symbol Chaikin Money Flow board, skipping symbols with too little history. */
export function cmfBoard(
  series: { symbol: string; bars: CmfBar[] }[],
  sort: CmfSort = 'cmf',
  period = 20,
): CmfRow[] {
  const rows: CmfRow[] = [];
  for (const s of series) {
    const stats = computeCmf(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortCmf(rows, sort);
}

export function sortCmf(rows: CmfRow[], sort: CmfSort): CmfRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'cmf':
    default:
      out.sort((a, b) => b.cmf - a.cmf);
      break;
  }
  return out;
}
