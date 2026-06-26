/**
 * Stochastic oscillator (Lane).
 *
 * Locates the close within its recent high-low range:
 *
 *   rawK = (close − lowestLow(N)) / (highestHigh(N) − lowestLow(N)) · 100
 *   %K   = SMA(rawK, smoothK)      // fast %K when smoothK = 1
 *   %D   = SMA(%K, smoothD)        // the signal line
 *
 * Above 80 is overbought, below 20 oversold; a %K-crossing-%D flip is the
 * classic trigger. A range-position oscillator, distinct from RSI (gains vs
 * losses), MFI (volume-weighted) and CCI (mean deviation).
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */

/** Minimal OHLC bar (no open needed). */
export interface StochBar {
  high: number;
  low: number;
  close: number;
}

export const STOCH_OVERBOUGHT = 80;
export const STOCH_OVERSOLD = 20;

export type StochZone = 'overbought' | 'oversold' | 'neutral';
export type StochCross = 'bull' | 'bear' | 'none';

export interface StochStats {
  /** Latest %K (the smoothed range position). */
  k: number;
  /** Latest %D (the signal line). */
  d: number;
  /** Overbought / oversold / neutral by %K. */
  zone: StochZone;
  /** Fresh %K-vs-%D crossover on the latest bar. */
  cross: StochCross;
  /** Number of bars supplied. */
  n: number;
}

export interface StochRow extends StochStats {
  symbol: string;
}

export type StochSort = 'k' | 'd' | 'symbol';

/** Trailing simple moving average; output starts at index `period − 1`. */
function sma(values: number[], period: number): number[] {
  if (period < 1 || values.length < period) return [];
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out.push(sum / period);
  }
  return out;
}

/**
 * Compute the aligned %K and %D series. Returns null with too little history.
 * A flat window (zero range) maps to the 50 midpoint rather than dividing by
 * zero.
 */
export function stochasticSeries(
  bars: StochBar[],
  period = 14,
  smoothK = 3,
  smoothD = 3,
): { k: number[]; d: number[] } | null {
  const n = bars.length;
  if (period < 1 || smoothK < 1 || smoothD < 1 || n < period) return null;

  const rawK: number[] = [];
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].high > hi) hi = bars[j].high;
      if (bars[j].low < lo) lo = bars[j].low;
    }
    const range = hi - lo;
    rawK.push(range > 0 ? ((bars[i].close - lo) / range) * 100 : 50);
  }

  const k = smoothK === 1 ? rawK : sma(rawK, smoothK);
  const d = sma(k, smoothD);
  if (k.length === 0 || d.length === 0) return null;
  return { k, d };
}

/** Classify a %K reading into a zone. */
export function stochZone(k: number): StochZone {
  if (k >= STOCH_OVERBOUGHT) return 'overbought';
  if (k <= STOCH_OVERSOLD) return 'oversold';
  return 'neutral';
}

/**
 * Compute the latest Stochastic reading for one symbol. Needs at least
 * `period + smoothK + smoothD − 1` bars (so both lines have two points to
 * detect a crossover); returns null otherwise.
 */
export function computeStochastic(bars: StochBar[], period = 14, smoothK = 3, smoothD = 3): StochStats | null {
  const s = stochasticSeries(bars, period, smoothK, smoothD);
  if (!s) return null;
  const { k, d } = s;

  const kLast = k[k.length - 1];
  const dLast = d[d.length - 1];

  // %D aligns to the tail of %K, so compare the last two aligned pairs.
  let cross: StochCross = 'none';
  if (d.length >= 2 && k.length >= 2) {
    const kPrev = k[k.length - 2];
    const dPrev = d[d.length - 2];
    if (kPrev <= dPrev && kLast > dLast) cross = 'bull';
    else if (kPrev >= dPrev && kLast < dLast) cross = 'bear';
  }

  return { k: kLast, d: dLast, zone: stochZone(kLast), cross, n: bars.length };
}

/** Build a sorted per-symbol Stochastic board, skipping symbols with too little history. */
export function stochasticBoard(
  series: { symbol: string; bars: StochBar[] }[],
  sort: StochSort = 'k',
  period = 14,
  smoothK = 3,
  smoothD = 3,
): StochRow[] {
  const rows: StochRow[] = [];
  for (const s of series) {
    const stats = computeStochastic(s.bars, period, smoothK, smoothD);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortStoch(rows, sort);
}

export function sortStoch(rows: StochRow[], sort: StochSort): StochRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'd':
      out.sort((a, b) => b.d - a.d);
      break;
    case 'k':
    default:
      out.sort((a, b) => b.k - a.k);
      break;
  }
  return out;
}
