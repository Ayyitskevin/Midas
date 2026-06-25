/**
 * Technical signal scanner — boils each symbol's recent price action down to a
 * few classic, glanceable states: the SMA-20 vs SMA-50 trend, the 14-day RSI
 * (overbought / oversold), and where price sits in its 52-week range. A net
 * bull/bear score rolls them up so the most stretched or aligned names surface
 * first. Pure helpers (smaLast, rsi) plus the per-symbol scan, all unit-tested.
 */

export type Trend = 'up' | 'down';
export type RsiState = 'overbought' | 'oversold' | 'neutral';
export type RangeState = 'high' | 'mid' | 'low';

export interface SignalRow {
  symbol: string;
  last: number;
  sma20: number | null;
  sma50: number | null;
  trend: Trend | null;
  rsi: number | null;
  rsiState: RsiState | null;
  /** Position in the trailing 52-week (≤252d) high-low range, 0–100. */
  rangePct: number | null;
  rangeState: RangeState | null;
  /** Net bull (+) / bear (−) score from the aligned signals. */
  score: number;
}

export interface SignalInput {
  symbol: string;
  closes: number[];
}

export type SignalSort = 'score' | 'rsi' | 'range' | 'symbol';

/** Trailing simple moving average of the last `period` closes, or null. */
export function smaLast(closes: number[], period: number): number | null {
  if (period < 1 || closes.length < period) return null;
  let s = 0;
  for (let i = closes.length - period; i < closes.length; i++) s += closes[i];
  return s / period;
}

/**
 * Simple (non-Wilder) RSI over the last `period` price changes, in [0, 100].
 * A flat window is 50; all-up is 100, all-down is 0. Null without period+1 closes.
 */
export function rsi(closes: number[], period = 14): number | null {
  if (period < 1 || closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss += -d;
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  if (avgGain === 0) return 0;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Evaluate the signal set for one close series. Null when empty. */
export function computeSignals(closes: number[]): Omit<SignalRow, 'symbol'> | null {
  if (closes.length === 0) return null;
  const last = closes[closes.length - 1];
  const sma20 = smaLast(closes, 20);
  const sma50 = smaLast(closes, 50);
  const trend: Trend | null = sma20 != null && sma50 != null ? (sma20 > sma50 ? 'up' : 'down') : null;

  const r = rsi(closes, 14);
  const rsiState: RsiState | null = r == null ? null : r >= 70 ? 'overbought' : r <= 30 ? 'oversold' : 'neutral';

  const win = closes.slice(-252);
  let hi = -Infinity;
  let lo = Infinity;
  for (const c of win) {
    if (c > hi) hi = c;
    if (c < lo) lo = c;
  }
  const rangePct = hi > lo ? ((last - lo) / (hi - lo)) * 100 : null;
  const rangeState: RangeState | null =
    rangePct == null ? null : rangePct >= 90 ? 'high' : rangePct <= 10 ? 'low' : 'mid';

  // Bull (+) / bear (−): trend plus a mean-reversion read on RSI.
  let score = 0;
  if (trend === 'up') score += 1;
  else if (trend === 'down') score -= 1;
  if (rsiState === 'oversold') score += 1;
  else if (rsiState === 'overbought') score -= 1;

  return { last, sma20, sma50, trend, rsi: r, rsiState, rangePct, rangeState, score };
}

/** Scan a basket, sorted (default by bull/bear score descending). */
export function signalBoard(series: SignalInput[], sort: SignalSort = 'score'): SignalRow[] {
  const rows: SignalRow[] = [];
  for (const s of series) {
    if (s.closes.length === 0) continue;
    const r = computeSignals(s.closes);
    if (r) rows.push({ symbol: s.symbol, ...r });
  }
  return sortSignals(rows, sort);
}

export function sortSignals(rows: SignalRow[], sort: SignalSort): SignalRow[] {
  const lo = (v: number | null) => (v == null ? -Infinity : v);
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case 'symbol':
        return a.symbol.localeCompare(b.symbol);
      case 'rsi':
        return lo(b.rsi) - lo(a.rsi);
      case 'range':
        return lo(b.rangePct) - lo(a.rangePct);
      case 'score':
      default:
        return b.score - a.score;
    }
  });
  return out;
}
