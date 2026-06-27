/**
 * Stochastic Momentum Index (William Blau).
 *
 * A refined, less-noisy stochastic: instead of where close sits within the
 * range, it measures how far close is from the range *midpoint*, double-smooths
 * that and the range, and rescales to ±100:
 *
 *   mid      = (highestHigh + lowestLow) / 2          over the last lengthK bars
 *   relRange = close − mid                            distance from the midpoint
 *   hlRange  = highestHigh − lowestLow                the range
 *   ds       = EMA(EMA(relRange, s1), s2)             double-smoothed distance
 *   dhl      = EMA(EMA(hlRange,  s1), s2)             double-smoothed range
 *   SMI      = 200 · ds / dhl                         ≡ 100 · ds / (dhl/2)
 *   signal   = EMA(SMI, signalPeriod)
 *
 * The ×200 (not ×100) is exact: the numerator is a half-range quantity and the
 * denominator a full range, so it rescales SMI to span [−100, 100]. Above +40
 * is overbought, below −40 oversold; SMI/signal and zero-line crossovers are the
 * triggers. Defaults match the TradingView build: lengthK 10, smoothing 3 & 3,
 * signal 3 — verified against an independent worked example. Pure and synchronous.
 */

import { emaSeries } from './indicators';

export type SmiZone = 'ob' | 'os' | 'mid';
export type SmiDir = 'up' | 'down';

export interface SmiBar {
  high: number;
  low: number;
  close: number;
}

export interface SmiStats {
  /** Stochastic Momentum Index at the latest bar ([-100, 100]). */
  smi: number;
  /** Signal line (EMA of SMI) at the latest bar. */
  signal: number;
  /** SMI − signal (the histogram). */
  hist: number;
  /** SMI above (up) or below (down) its signal line. */
  dir: SmiDir;
  /** ≥ 40 overbought, ≤ −40 oversold, otherwise mid. */
  zone: SmiZone;
  /** Number of bars supplied. */
  n: number;
}

export interface SmiRow extends SmiStats {
  symbol: string;
}

export type SmiSort = 'smi' | 'hist' | 'symbol';

/**
 * Compute the latest Stochastic Momentum Index for one symbol. Returns null with
 * bad params or too little history (needs ≥ lengthK + smooth1 + smooth2 +
 * signalPeriod bars for the window and EMA cascade to warm up).
 */
export function computeSmi(
  bars: SmiBar[],
  lengthK = 10,
  smooth1 = 3,
  smooth2 = 3,
  signalPeriod = 3,
): SmiStats | null {
  if (lengthK < 1 || smooth1 < 1 || smooth2 < 1 || signalPeriod < 1) return null;
  const n = bars.length;
  if (n < lengthK + smooth1 + smooth2 + signalPeriod) return null;

  const relRange: number[] = [];
  const hlRange: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - lengthK + 1);
    let hh = bars[start].high;
    let ll = bars[start].low;
    for (let j = start + 1; j <= i; j++) {
      if (bars[j].high > hh) hh = bars[j].high;
      if (bars[j].low < ll) ll = bars[j].low;
    }
    relRange.push(bars[i].close - (hh + ll) / 2);
    hlRange.push(hh - ll);
  }

  const ds = emaSeries(emaSeries(relRange, smooth1), smooth2);
  const dhl = emaSeries(emaSeries(hlRange, smooth1), smooth2);
  const smiArr = ds.map((v, i) => (dhl[i] !== 0 ? (200 * v) / dhl[i] : 0));
  const sigArr = emaSeries(smiArr, signalPeriod);

  const last = n - 1;
  const smi = smiArr[last];
  const signal = sigArr[last];
  const hist = smi - signal;
  const zone: SmiZone = smi >= 40 ? 'ob' : smi <= -40 ? 'os' : 'mid';
  return { smi, signal, hist, dir: smi >= signal ? 'up' : 'down', zone, n };
}

/** Build a sorted per-symbol SMI board, skipping symbols with too little history. */
export function smiBoard(
  series: { symbol: string; bars: SmiBar[] }[],
  sort: SmiSort = 'smi',
  lengthK = 10,
  smooth1 = 3,
  smooth2 = 3,
  signalPeriod = 3,
): SmiRow[] {
  const rows: SmiRow[] = [];
  for (const s of series) {
    const stats = computeSmi(s.bars, lengthK, smooth1, smooth2, signalPeriod);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortSmi(rows, sort);
}

export function sortSmi(rows: SmiRow[], sort: SmiSort): SmiRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'hist':
      out.sort((a, b) => b.hist - a.hist);
      break;
    case 'smi':
    default:
      out.sort((a, b) => b.smi - a.smi);
      break;
  }
  return out;
}
