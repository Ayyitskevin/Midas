/**
 * Derivative Oscillator (Constance Brown).
 *
 * A refined RSI momentum read: take a Wilder RSI, double-smooth it with two
 * EMAs, then plot its distance from its own simple moving average — the
 * MACD-histogram idea applied to a smoothed RSI:
 *
 *   rsi    = Wilder RSI(close, rsiLength)
 *   doLine = EMA(EMA(rsi, s1), s2)                 the double-smoothed RSI
 *   signal = SMA(doLine, sigLength)                a SIMPLE MA (not an EMA)
 *   DOSC   = doLine − signal                       the histogram
 *
 * DOSC oscillates around zero: above zero (and rising) is bullish momentum,
 * below zero bearish, and the zero-line and doLine/signal crossovers are the
 * triggers. The signal is a SIMPLE moving average of the *double-smoothed* RSI
 * — the part most clones get wrong (using EMA, or smoothing the raw RSI).
 *
 * Defaults are Brown's: RSI 14, smoothing 5 then 3, signal SMA 9. The RSI base
 * and EMA cascade reuse the app's shared rsi()/emaSeries helpers. Verified
 * against an independent worked example. Pure and synchronous.
 */

import { emaSeries } from './indicators';

export type DoscSide = 'pos' | 'neg';
export type DoscDir = 'up' | 'down';

export interface DoscStats {
  /** Derivative Oscillator histogram (doLine − signal) at the latest bar. */
  dosc: number;
  /** The double-smoothed RSI (DO line) at the latest bar. */
  doLine: number;
  /** Signal line (SMA of the DO line) at the latest bar. */
  signal: number;
  /** DOSC one bar back, for slope / direction. */
  prev: number;
  /** Histogram rising (dosc ≥ prev) or falling. */
  dir: DoscDir;
  /** DOSC above (pos) or below (neg) the zero line. */
  side: DoscSide;
  /** Number of closes supplied. */
  n: number;
}

export interface DoscRow extends DoscStats {
  symbol: string;
}

export type DoscSort = 'dosc' | 'slope' | 'symbol';

/** Wilder RSI of a close series, returned as a number[] from index `period` (mirrors indicators.ts rsi()). */
function wilderRsiSeries(closes: number[], period: number): number[] {
  if (closes.length <= period) return [];
  const out: number[] = [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= period;
  avgLoss /= period;
  const push = () => out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  push();
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const gain = ch >= 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    push();
  }
  return out;
}

/**
 * Compute the latest Derivative Oscillator for one symbol. Returns null with bad
 * params or too little history (needs ≥ rsiLength + s1 + s2 + sigLength closes so
 * the RSI feeds the EMA cascade and the SMA window).
 */
export function computeDosc(
  closes: number[],
  rsiLength = 14,
  s1 = 5,
  s2 = 3,
  sigLength = 9,
): DoscStats | null {
  if (rsiLength < 1 || s1 < 1 || s2 < 1 || sigLength < 1) return null;
  if (closes.length < rsiLength + s1 + s2 + sigLength) return null;

  const rsiArr = wilderRsiSeries(closes, rsiLength);
  if (rsiArr.length < sigLength) return null;

  const ema2 = emaSeries(emaSeries(rsiArr, s1), s2);
  const sma = (end: number) => {
    let s = 0;
    for (let j = end - sigLength + 1; j <= end; j++) s += ema2[j];
    return s / sigLength;
  };

  const last = ema2.length - 1;
  const doLine = ema2[last];
  const signal = sma(last);
  const dosc = doLine - signal;

  // Previous DOSC (one bar back) for the slope, when the SMA window still fits.
  const prev = last - 1 >= sigLength - 1 ? ema2[last - 1] - sma(last - 1) : dosc;

  return { dosc, doLine, signal, prev, dir: dosc >= prev ? 'up' : 'down', side: dosc >= 0 ? 'pos' : 'neg', n: closes.length };
}

/** Build a sorted per-symbol Derivative Oscillator board, skipping symbols with too little history. */
export function doscBoard(
  series: { symbol: string; closes: number[] }[],
  sort: DoscSort = 'dosc',
  rsiLength = 14,
  s1 = 5,
  s2 = 3,
  sigLength = 9,
): DoscRow[] {
  const rows: DoscRow[] = [];
  for (const s of series) {
    const stats = computeDosc(s.closes, rsiLength, s1, s2, sigLength);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortDosc(rows, sort);
}

export function sortDosc(rows: DoscRow[], sort: DoscSort): DoscRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'slope':
      out.sort((a, b) => b.dosc - b.prev - (a.dosc - a.prev));
      break;
    case 'dosc':
    default:
      out.sort((a, b) => b.dosc - a.dosc);
      break;
  }
  return out;
}
