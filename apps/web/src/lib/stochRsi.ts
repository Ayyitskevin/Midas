/**
 * Stochastic RSI (STRSI) screener helpers.
 *
 * Tushar Chande & Stanley Kroll's Stochastic RSI (1994) applies a Stochastic
 * oscillator to the RSI series instead of to price, so it measures where the RSI
 * sits within its own recent range — a far more sensitive, faster oscillator that
 * reaches the 0–100 extremes much more often than plain RSI:
 *
 *   rsi[]    = Wilder RSI(close, rsiPeriod)
 *   raw[t]   = 100 · (rsi[t] − min(rsi, stochPeriod)) / (max(rsi, stochPeriod) − min(rsi, stochPeriod))
 *   %K       = SMA(raw, smoothK)
 *   %D       = SMA(%K, smoothD)
 *
 * Defaults rsiPeriod 14, stochPeriod 14, smoothK 3, smoothD 3 (the common
 * TradingView form). Bounded 0–100 and built from RSI (itself a ratio), so it is
 * inherently scale-invariant and ranks cleanly across symbols. Overbought ≥ 80,
 * oversold ≤ 20. When the RSI range over the window is flat (max == min) the raw
 * value is defined as 0.
 *
 * Reuses the repo's `wilderRsiSeries`. Pure and synchronous.
 */

import { wilderRsiSeries } from './vrsi';

const sma = (values: number[], period: number): number[] => {
  if (period < 1 || values.length < period) return [];
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out.push(sum / period);
  }
  return out;
};

export interface StochRsiSeries {
  /** Raw Stochastic-RSI (0–100) over the defined tail. */
  raw: number[];
  /** %K = SMA(raw, smoothK). */
  k: number[];
  /** %D = SMA(%K, smoothD). */
  d: number[];
}

/**
 * Full Stochastic-RSI series (each component is the defined tail, aligned at the
 * latest bar). Empty arrays when there is too little history.
 */
export function stochRsiSeries(
  closes: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  smoothK = 3,
  smoothD = 3,
): StochRsiSeries {
  if (rsiPeriod < 1 || stochPeriod < 1 || smoothK < 1 || smoothD < 1) {
    return { raw: [], k: [], d: [] };
  }
  const rsi = wilderRsiSeries(closes, rsiPeriod);
  if (rsi.length < stochPeriod) return { raw: [], k: [], d: [] };

  const raw: number[] = [];
  for (let i = stochPeriod - 1; i < rsi.length; i++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = i - stochPeriod + 1; j <= i; j++) {
      if (rsi[j] < lo) lo = rsi[j];
      if (rsi[j] > hi) hi = rsi[j];
    }
    const range = hi - lo;
    raw.push(range === 0 ? 0 : (100 * (rsi[i] - lo)) / range);
  }

  const k = sma(raw, smoothK);
  const d = sma(k, smoothD);
  return { raw, k, d };
}

export type StochRsiZone = 'overbought' | 'oversold' | 'neutral';

/** Overbought ≥ 80, oversold ≤ 20. */
export const STOCHRSI_OB = 80;
export const STOCHRSI_OS = 20;

export function stochRsiZone(k: number): StochRsiZone {
  if (k >= STOCHRSI_OB) return 'overbought';
  if (k <= STOCHRSI_OS) return 'oversold';
  return 'neutral';
}

export interface StochRsiStats {
  /** Latest %K (smoothed Stochastic-RSI, 0–100). */
  k: number;
  /** Latest %D (signal line). */
  d: number;
  /** Overbought / oversold / neutral zone of %K. */
  zone: StochRsiZone;
  /** Number of bars supplied. */
  n: number;
}

export interface StochRsiRow extends StochRsiStats {
  symbol: string;
}

export type StochRsiSort = 'k' | 'symbol';

/**
 * Compute the latest Stochastic-RSI reading for one symbol. Needs enough history
 * for the RSI, the stochastic window and both SMA smoothings; returns null on bad
 * params or too little history.
 */
export function computeStochRsi(
  closes: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  smoothK = 3,
  smoothD = 3,
): StochRsiStats | null {
  const { k, d } = stochRsiSeries(closes, rsiPeriod, stochPeriod, smoothK, smoothD);
  if (k.length === 0 || d.length === 0) return null;

  const kLast = k[k.length - 1];
  const dLast = d[d.length - 1];
  return { k: kLast, d: dLast, zone: stochRsiZone(kLast), n: closes.length };
}

/** Build a sorted per-symbol Stochastic-RSI board, skipping symbols with too little history. */
export function stochRsiBoard(
  series: { symbol: string; closes: number[] }[],
  sort: StochRsiSort = 'k',
  rsiPeriod = 14,
  stochPeriod = 14,
  smoothK = 3,
  smoothD = 3,
): StochRsiRow[] {
  const rows: StochRsiRow[] = [];
  for (const s of series) {
    const stats = computeStochRsi(s.closes, rsiPeriod, stochPeriod, smoothK, smoothD);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortStochRsi(rows, sort);
}

export function sortStochRsi(rows: StochRsiRow[], sort: StochRsiSort): StochRsiRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'k':
    default:
      out.sort((a, b) => b.k - a.k);
      break;
  }
  return out;
}
