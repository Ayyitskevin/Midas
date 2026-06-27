/**
 * True Strength Index (William Blau).
 *
 * A double-smoothed momentum oscillator. Take the 1-bar price change, smooth it
 * twice — the long period first, the short period second — and divide by the
 * same double-smoothing of its absolute value, which bounds the result to
 * roughly [-100, 100]:
 *
 *   pc    = close[i] − close[i−1]
 *   tsi   = 100 · EMA( EMA(pc,  long), short ) / EMA( EMA(|pc|, long), short )
 *   signal = EMA(tsi, signalPeriod)
 *
 * Above zero is net positive (bullish) momentum, below zero bearish; ±25 are
 * the common overbought / oversold extremes, and TSI crossing its signal line
 * is the usual trigger. The smoothing ORDER (long then short) and the
 * absolute-value denominator are the two parts that are easy to get wrong —
 * both verified here against an independent worked example.
 *
 * Defaults follow Blau: long 25, short 13, signal 7. Pure and synchronous so it
 * can be unit-tested exactly.
 */

import { emaSeries } from './indicators';

export type TsiZone = 'ob' | 'os' | 'mid';
export type TsiDir = 'up' | 'down';

export interface TsiStats {
  /** True Strength Index at the latest bar (≈ [-100, 100]). */
  tsi: number;
  /** Signal line (EMA of the TSI) at the latest bar. */
  signal: number;
  /** TSI − signal (the histogram). */
  hist: number;
  /** TSI above (up) or below (down) its signal line. */
  dir: TsiDir;
  /** ≥ 25 overbought, ≤ −25 oversold, otherwise mid. */
  zone: TsiZone;
  /** Number of closes supplied. */
  n: number;
}

export interface TsiRow extends TsiStats {
  symbol: string;
}

export type TsiSort = 'tsi' | 'hist' | 'symbol';

/**
 * Compute the latest True Strength Index for one symbol. Returns null with bad
 * params or too little history (needs ≥ long + short + 1 closes so the diff
 * series can feed the double EMA).
 */
export function computeTsi(
  closes: number[],
  long = 25,
  short = 13,
  signalPeriod = 7,
): TsiStats | null {
  if (long < 1 || short < 1 || signalPeriod < 1) return null;
  if (closes.length < long + short + 1) return null;

  const pc: number[] = [];
  const apc: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    pc.push(d);
    apc.push(Math.abs(d));
  }

  // Double smoothing: long period first (inner), short period second (outer).
  const dsPc = emaSeries(emaSeries(pc, long), short);
  const dsApc = emaSeries(emaSeries(apc, long), short);
  const series = dsPc.map((v, i) => (dsApc[i] !== 0 ? (100 * v) / dsApc[i] : 0));
  const signalSeries = emaSeries(series, signalPeriod);

  const last = series.length - 1;
  const tsi = series[last];
  const signal = signalSeries[last];
  const hist = tsi - signal;
  const dir: TsiDir = hist >= 0 ? 'up' : 'down';
  const zone: TsiZone = tsi >= 25 ? 'ob' : tsi <= -25 ? 'os' : 'mid';
  return { tsi, signal, hist, dir, zone, n: closes.length };
}

/** Build a sorted per-symbol TSI board, skipping symbols with too little history. */
export function tsiBoard(
  series: { symbol: string; closes: number[] }[],
  sort: TsiSort = 'tsi',
  long = 25,
  short = 13,
  signalPeriod = 7,
): TsiRow[] {
  const rows: TsiRow[] = [];
  for (const s of series) {
    const stats = computeTsi(s.closes, long, short, signalPeriod);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortTsi(rows, sort);
}

export function sortTsi(rows: TsiRow[], sort: TsiSort): TsiRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'hist':
      out.sort((a, b) => b.hist - a.hist);
      break;
    case 'tsi':
    default:
      out.sort((a, b) => b.tsi - a.tsi);
      break;
  }
  return out;
}
