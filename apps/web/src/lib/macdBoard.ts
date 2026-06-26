/**
 * MACD screener helpers.
 *
 * Thin board layer over the shared `macd()` indicator (the same 12/26/9 the
 * chart draws), so the screener and the chart always agree. For each symbol
 * we take the latest MACD line, signal, and histogram, normalize the
 * histogram by price for cross-symbol comparability, and detect a fresh
 * bullish / bearish cross (the histogram flipping sign on the last bar).
 */
import type { Candle } from '@midas/shared';
import { macd } from './indicators';

export type MacdCross = 'bull' | 'bear' | 'none';

export interface MacdStats {
  /** Latest MACD line (fast EMA − slow EMA). */
  macd: number;
  /** Latest signal line (EMA of the MACD line). */
  signal: number;
  /** Latest histogram (MACD − signal). */
  hist: number;
  /** Histogram as a % of price, for comparing across symbols. */
  histPct: number;
  /** True when the histogram is positive (MACD above signal). */
  bullish: boolean;
  /** Fresh cross on the latest bar, if any. */
  cross: MacdCross;
  /** Number of candles supplied. */
  n: number;
}

export interface MacdRow extends MacdStats {
  symbol: string;
}

export type MacdSort = 'histPct' | 'hist' | 'macd' | 'symbol';

/** Classify a histogram sign change between two consecutive bars. */
export function macdCross(prevHist: number, hist: number): MacdCross {
  if (prevHist <= 0 && hist > 0) return 'bull';
  if (prevHist >= 0 && hist < 0) return 'bear';
  return 'none';
}

/**
 * Compute MACD screener stats for one symbol. Needs more than `slow` candles
 * so the slow EMA and a prior histogram bar exist; returns null otherwise.
 */
export function computeMacd(candles: Candle[], fast = 12, slow = 26, signalPeriod = 9): MacdStats | null {
  if (candles.length < slow + 2) return null;
  const m = macd(candles, fast, slow, signalPeriod);
  const h = m.histogram;
  if (h.length < 2) return null;

  const last = h.length - 1;
  const hist = h[last].value;
  const close = candles[candles.length - 1].close;
  return {
    macd: m.macd[last].value,
    signal: m.signal[last].value,
    hist,
    histPct: close > 0 ? (hist / close) * 100 : 0,
    bullish: hist > 0,
    cross: macdCross(h[last - 1].value, hist),
    n: candles.length,
  };
}

/** Build a sorted per-symbol MACD board, skipping symbols with too little history. */
export function macdBoard(
  series: { symbol: string; candles: Candle[] }[],
  sort: MacdSort = 'histPct',
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdRow[] {
  const rows: MacdRow[] = [];
  for (const s of series) {
    const stats = computeMacd(s.candles, fast, slow, signalPeriod);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortMacd(rows, sort);
}

export function sortMacd(rows: MacdRow[], sort: MacdSort): MacdRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'hist':
      out.sort((a, b) => b.hist - a.hist);
      break;
    case 'macd':
      out.sort((a, b) => b.macd - a.macd);
      break;
    case 'histPct':
    default:
      out.sort((a, b) => b.histPct - a.histPct);
      break;
  }
  return out;
}
