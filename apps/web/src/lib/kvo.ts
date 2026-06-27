/**
 * Klinger Volume Oscillator (Stephen Klinger).
 *
 * Ties volume flow to price trend through a signed "volume force", then takes
 * the difference of two EMAs of it:
 *
 *   trend = +1 if (high+low+close) > the prior bar's, else −1
 *   dm    = high − low                                    (daily measurement)
 *   cm    = running sum of dm while trend holds; on a trend flip it resets to
 *           dm[prev] + dm                                 (cumulative measurement)
 *   vf    = volume · |2·(dm/cm − 1)| · trend · 100        (volume force)
 *   KVO   = EMA(vf, 34) − EMA(vf, 55)
 *   signal = EMA(KVO, 13)
 *
 * Because cm accumulates dm, the ratio dm/cm is bounded to [0,1], so the force
 * |2·(dm/cm − 1)| runs monotonically from 2 (a small bar versus its built-up
 * range) down to 0 — Klinger's published form. (The widely-copied LazyBear Pine
 * uses |2·(dm/cm) − 1|, a missing-paren variant that wrongly zeroes mid-range;
 * we ship the original, verified against an independent worked example.)
 *
 * KVO oscillates around zero in volume units; above zero / above its signal is
 * net accumulation, below is distribution, and the zero-line and signal-line
 * crossovers are the triggers. Since the raw value scales with a symbol's
 * volume, the board also reports a volume-normalised value (÷ average volume)
 * so symbols sort against each other. Pure and synchronous.
 */

import { emaSeries } from './indicators';

export type KvoSide = 'pos' | 'neg';
export type KvoDir = 'up' | 'down';

export interface KvoBar {
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface KvoStats {
  /** Raw Klinger Volume Oscillator at the latest bar (volume units). */
  kvo: number;
  /** Signal line (13-EMA of KVO) at the latest bar. */
  signal: number;
  /** KVO − signal. */
  hist: number;
  /** KVO ÷ average volume — comparable across symbols. */
  kvoNorm: number;
  /** hist ÷ average volume. */
  histNorm: number;
  /** KVO above (up) or below (down) its signal line. */
  dir: KvoDir;
  /** KVO above (pos) or below (neg) the zero line. */
  side: KvoSide;
  /** Number of bars supplied. */
  n: number;
}

export interface KvoRow extends KvoStats {
  symbol: string;
}

export type KvoSort = 'kvo' | 'hist' | 'symbol';

/**
 * Compute the latest Klinger Volume Oscillator for one symbol. Returns null with
 * bad params or too little history (needs ≥ slow + signalPeriod bars for the EMA
 * cascade to warm up).
 */
export function computeKvo(
  bars: KvoBar[],
  fast = 34,
  slow = 55,
  signalPeriod = 13,
): KvoStats | null {
  if (fast < 1 || slow < 1 || signalPeriod < 1 || fast >= slow) return null;
  if (bars.length < slow + signalPeriod) return null;

  const n = bars.length;
  const vf = new Array<number>(n);
  let prevTrend = 1;
  let prevDm = 0;
  let prevCm = 0;
  let prevHlc = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const hlc = b.high + b.low + b.close;
    const trend = i === 0 ? 1 : hlc > prevHlc ? 1 : -1;
    const dm = b.high - b.low;
    const cm = i === 0 ? dm : trend === prevTrend ? prevCm + dm : prevDm + dm;
    vf[i] = cm !== 0 ? b.volume * Math.abs(2 * (dm / cm - 1)) * trend * 100 : 0;
    prevTrend = trend;
    prevDm = dm;
    prevCm = cm;
    prevHlc = hlc;
  }

  const emaFast = emaSeries(vf, fast);
  const emaSlow = emaSeries(vf, slow);
  const kvoArr = vf.map((_, i) => emaFast[i] - emaSlow[i]);
  const sigArr = emaSeries(kvoArr, signalPeriod);

  const last = n - 1;
  const kvo = kvoArr[last];
  const signal = sigArr[last];
  const hist = kvo - signal;

  let vsum = 0;
  for (const b of bars) vsum += b.volume;
  const avgVol = vsum / n;
  const kvoNorm = avgVol > 0 ? kvo / avgVol : 0;
  const histNorm = avgVol > 0 ? hist / avgVol : 0;

  return {
    kvo,
    signal,
    hist,
    kvoNorm,
    histNorm,
    dir: kvo >= signal ? 'up' : 'down',
    side: kvo >= 0 ? 'pos' : 'neg',
    n,
  };
}

/** Build a sorted per-symbol KVO board, skipping symbols with too little history. */
export function kvoBoard(
  series: { symbol: string; bars: KvoBar[] }[],
  sort: KvoSort = 'kvo',
  fast = 34,
  slow = 55,
  signalPeriod = 13,
): KvoRow[] {
  const rows: KvoRow[] = [];
  for (const s of series) {
    const stats = computeKvo(s.bars, fast, slow, signalPeriod);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortKvo(rows, sort);
}

export function sortKvo(rows: KvoRow[], sort: KvoSort): KvoRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'hist':
      out.sort((a, b) => b.histNorm - a.histNorm);
      break;
    case 'kvo':
    default:
      // Volume-normalised so symbols compare; most bullish first.
      out.sort((a, b) => b.kvoNorm - a.kvoNorm);
      break;
  }
  return out;
}
