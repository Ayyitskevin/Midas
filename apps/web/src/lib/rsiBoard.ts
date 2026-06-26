/**
 * RSI screener helpers.
 *
 * Thin board layer over the shared Wilder `rsi()` indicator (the same one the
 * chart's RSI sub-pane draws), so the screener and the chart always agree.
 * For each symbol we take the latest RSI value and classify it into an
 * overbought / oversold / neutral zone.
 */
import type { Candle } from '@midas/shared';
import { rsi } from './indicators';

export const RSI_OVERBOUGHT = 70;
export const RSI_OVERSOLD = 30;

export type RsiZone = 'overbought' | 'oversold' | 'neutral';

export interface RsiRow {
  symbol: string;
  rsi: number;
  zone: RsiZone;
}

export type RsiSort = 'rsi' | 'symbol';

/** Latest Wilder RSI for a candle series, or null when there's too little history. */
export function latestRsi(candles: Candle[], period = 14): number | null {
  const series = rsi(candles, period);
  if (series.length === 0) return null;
  return series[series.length - 1].value;
}

/** Classify an RSI reading into a zone. */
export function rsiZone(value: number): RsiZone {
  if (value >= RSI_OVERBOUGHT) return 'overbought';
  if (value <= RSI_OVERSOLD) return 'oversold';
  return 'neutral';
}

/** Build a sorted per-symbol RSI board, skipping symbols with too little history. */
export function rsiBoard(
  series: { symbol: string; candles: Candle[] }[],
  sort: RsiSort = 'rsi',
  period = 14,
): RsiRow[] {
  const rows: RsiRow[] = [];
  for (const s of series) {
    const value = latestRsi(s.candles, period);
    if (value !== null) rows.push({ symbol: s.symbol, rsi: value, zone: rsiZone(value) });
  }
  return sortRsi(rows, sort);
}

export function sortRsi(rows: RsiRow[], sort: RsiSort): RsiRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'rsi':
    default:
      // Most overbought first.
      out.sort((a, b) => b.rsi - a.rsi);
      break;
  }
  return out;
}
