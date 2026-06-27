/**
 * Wave Trend Oscillator (LazyBear, TradingView).
 *
 * A CCI-style oscillator on the typical price, double-smoothed so it reads like
 * a clean reversal wave:
 *
 *   ap  = (high + low + close) / 3                  typical price
 *   esa = EMA(ap, n1)                               its trend
 *   d   = EMA(|ap − esa|, n1)                       its mean deviation
 *   ci  = (ap − esa) / (0.015 · d)                  CCI-style normalisation
 *   wt1 = EMA(ci, n2)                               the WaveTrend line
 *   wt2 = SMA(wt1, 4)                               the signal line
 *
 * WT oscillates around zero (mostly within ≈ ±60). LazyBear marks overbought at
 * +53 / +60 and oversold at −53 / −60; wt1 crossing wt2 (and the zero line) are
 * the triggers. The 0.015 constant is Lambert's CCI scaling factor — the same
 * one used in the chart's CCI. Defaults: n1 = 10, n2 = 21, signal = 4. Verified
 * against an independent worked example. Pure and synchronous.
 */

import { emaSeries } from './indicators';

export type WtZone = 'ob' | 'os' | 'mid';
export type WtDir = 'up' | 'down';

export interface WaveTrendBar {
  high: number;
  low: number;
  close: number;
}

export interface WaveTrendStats {
  /** WaveTrend line (wt1) at the latest bar. */
  wt1: number;
  /** Signal line (wt2 = 4-SMA of wt1) at the latest bar. */
  wt2: number;
  /** wt1 − wt2 (the histogram). */
  hist: number;
  /** wt1 above (up) or below (down) its signal line. */
  dir: WtDir;
  /** ≥ 53 overbought, ≤ −53 oversold, otherwise mid. */
  zone: WtZone;
  /** Number of bars supplied. */
  n: number;
}

export interface WaveTrendRow extends WaveTrendStats {
  symbol: string;
}

export type WaveTrendSort = 'wt' | 'hist' | 'symbol';

/** CCI scaling factor (Lambert), shared with the chart's CCI. */
const K = 0.015;

/**
 * Compute the latest Wave Trend Oscillator for one symbol. Returns null with bad
 * params or too little history (needs ≥ n1 + n2 + signalPeriod bars for the
 * EMA→EMA→SMA cascade to warm up).
 */
export function computeWaveTrend(
  bars: WaveTrendBar[],
  n1 = 10,
  n2 = 21,
  signalPeriod = 4,
): WaveTrendStats | null {
  if (n1 < 1 || n2 < 1 || signalPeriod < 1) return null;
  const n = bars.length;
  if (n < n1 + n2 + signalPeriod) return null;

  const ap = bars.map((b) => (b.high + b.low + b.close) / 3);
  const esa = emaSeries(ap, n1);
  const d = emaSeries(
    ap.map((v, i) => Math.abs(v - esa[i])),
    n1,
  );
  const ci = ap.map((v, i) => (d[i] !== 0 ? (v - esa[i]) / (K * d[i]) : 0));
  const wt1Arr = emaSeries(ci, n2);

  const last = n - 1;
  const wt1 = wt1Arr[last];
  let sum = 0;
  for (let j = last - signalPeriod + 1; j <= last; j++) sum += wt1Arr[j];
  const wt2 = sum / signalPeriod;
  const hist = wt1 - wt2;
  const zone: WtZone = wt1 >= 53 ? 'ob' : wt1 <= -53 ? 'os' : 'mid';
  return { wt1, wt2, hist, dir: wt1 >= wt2 ? 'up' : 'down', zone, n };
}

/** Build a sorted per-symbol WaveTrend board, skipping symbols with too little history. */
export function waveTrendBoard(
  series: { symbol: string; bars: WaveTrendBar[] }[],
  sort: WaveTrendSort = 'wt',
  n1 = 10,
  n2 = 21,
  signalPeriod = 4,
): WaveTrendRow[] {
  const rows: WaveTrendRow[] = [];
  for (const s of series) {
    const stats = computeWaveTrend(s.bars, n1, n2, signalPeriod);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortWaveTrend(rows, sort);
}

export function sortWaveTrend(rows: WaveTrendRow[], sort: WaveTrendSort): WaveTrendRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'hist':
      out.sort((a, b) => b.hist - a.hist);
      break;
    case 'wt':
    default:
      out.sort((a, b) => b.wt1 - a.wt1);
      break;
  }
  return out;
}
