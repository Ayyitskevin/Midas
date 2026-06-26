/**
 * Historical prices (HP).
 *
 * Turns a series of OHLCV candles into a tabular price history — the data-table
 * complement to the chart panels (G / GIP). Each row carries the bar's
 * open/high/low/close/volume plus the day-over-day change (vs the prior bar's
 * close) and the bar's range, and a period summary rolls the window into one
 * line (period high/low, total change, average volume, up/down days, best/worst).
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */
import type { Candle } from '@midas/shared';

/** Normalize a candle timestamp (seconds or ms) to epoch ms. */
export const toMs = (t: number): number => (t < 1e12 ? t * 1000 : t);

export type HistorySort = 'time' | 'change' | 'volume' | 'range';
export type HistoryOrder = 'asc' | 'desc';

export interface HistoryRow {
  /** Bar timestamp in epoch ms (UTC). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Close − prior bar's close (null for the first bar in the series). */
  change: number | null;
  /** Change as a % of the prior close (null for the first bar). */
  changePct: number | null;
  /** Bar range (high − low). */
  range: number;
  /** Range as a % of the close. */
  rangePct: number;
  volume: number;
}

export interface HistorySummary {
  /** Number of bars. */
  n: number;
  /** Close of the first (oldest) bar. */
  startClose: number;
  /** Close of the last (newest) bar. */
  endClose: number;
  /** Highest high over the window. */
  periodHigh: number;
  /** Lowest low over the window. */
  periodLow: number;
  /** endClose − startClose. */
  totalChange: number;
  /** Total change as a % of the start close. */
  totalChangePct: number;
  /** Average bar volume. */
  avgVolume: number;
  /** Summed volume over the window. */
  totalVolume: number;
  /** Bars that closed up vs the prior bar. */
  upDays: number;
  /** Bars that closed down vs the prior bar. */
  downDays: number;
  /** Largest single-bar change %. */
  bestPct: number;
  /** Most negative single-bar change %. */
  worstPct: number;
}

/**
 * Build chronological history rows (oldest → newest) with each bar's change vs
 * the prior close. The first bar has a null change (no predecessor).
 */
export function historyRows(candles: Candle[]): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = i > 0 ? candles[i - 1].close : null;
    const change = prevClose === null ? null : c.close - prevClose;
    const changePct = prevClose === null || prevClose === 0 ? null : (change! / prevClose) * 100;
    const range = c.high - c.low;
    rows.push({
      time: toMs(c.time),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      change,
      changePct,
      range,
      rangePct: c.close !== 0 ? (range / c.close) * 100 : 0,
      volume: c.volume,
    });
  }
  return rows;
}

/** Sort history rows. `desc` (default) is newest-first / biggest-first per column. */
export function sortHistory(rows: HistoryRow[], sort: HistorySort, order: HistoryOrder = 'desc'): HistoryRow[] {
  const dir = order === 'asc' ? 1 : -1;
  const out = [...rows];
  switch (sort) {
    case 'change':
      // Nulls (the first bar) sort to the bottom of a descending list.
      out.sort((a, b) => dir * ((a.changePct ?? -Infinity) - (b.changePct ?? -Infinity)));
      break;
    case 'volume':
      out.sort((a, b) => dir * (a.volume - b.volume));
      break;
    case 'range':
      out.sort((a, b) => dir * (a.rangePct - b.rangePct));
      break;
    case 'time':
    default:
      out.sort((a, b) => dir * (a.time - b.time));
      break;
  }
  return out;
}

/** Build a sorted history table from OHLCV candles. */
export function buildHistory(
  candles: Candle[],
  sort: HistorySort = 'time',
  order: HistoryOrder = 'desc',
): HistoryRow[] {
  return sortHistory(historyRows(candles), sort, order);
}

/** Roll the window into one summary line. Null for an empty series. */
export function historySummary(candles: Candle[]): HistorySummary | null {
  const n = candles.length;
  if (n === 0) return null;

  const startClose = candles[0].close;
  const endClose = candles[n - 1].close;
  let periodHigh = -Infinity;
  let periodLow = Infinity;
  let totalVolume = 0;
  let upDays = 0;
  let downDays = 0;
  let bestPct = -Infinity;
  let worstPct = Infinity;

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    if (c.high > periodHigh) periodHigh = c.high;
    if (c.low < periodLow) periodLow = c.low;
    totalVolume += c.volume;
    if (i > 0) {
      const prevClose = candles[i - 1].close;
      const ch = c.close - prevClose;
      if (ch > 0) upDays++;
      else if (ch < 0) downDays++;
      if (prevClose !== 0) {
        const pct = (ch / prevClose) * 100;
        if (pct > bestPct) bestPct = pct;
        if (pct < worstPct) worstPct = pct;
      }
    }
  }

  const totalChange = endClose - startClose;
  return {
    n,
    startClose,
    endClose,
    periodHigh,
    periodLow,
    totalChange,
    totalChangePct: startClose !== 0 ? (totalChange / startClose) * 100 : 0,
    avgVolume: totalVolume / n,
    totalVolume,
    upDays,
    downDays,
    // With a single bar there are no changes; report 0 rather than ±Infinity.
    bestPct: bestPct === -Infinity ? 0 : bestPct,
    worstPct: worstPct === Infinity ? 0 : worstPct,
  };
}
