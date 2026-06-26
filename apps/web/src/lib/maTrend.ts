/**
 * Moving-average trend-persistence.
 *
 * For each symbol we track how durably price holds one side of an SMA:
 *   - run       the current consecutive run of closes on the same side of the
 *               SMA, signed (+ above / − below)
 *   - pctAbove  the share of bars (where the SMA is defined) that closed above it
 *   - dist      the latest close's distance from the SMA, as a % of price
 *
 * Reuses the shared `sma()` indicator so the board matches the chart's MA
 * overlay. Pure and synchronous so it can be unit-tested with exact,
 * hand-computed candles.
 */
import type { Candle } from '@midas/shared';
import { sma } from './indicators';

export interface TrendStats {
  /** Consecutive closes on the current side of the SMA (+ above / − below). */
  run: number;
  /** Share of bars closing above the SMA (0..1). */
  pctAbove: number;
  /** True when the latest close is above the SMA. */
  above: boolean;
  /** Latest close's distance from the SMA, as a % of price. */
  dist: number;
  /** Number of bars where the SMA is defined. */
  n: number;
}

export interface TrendRow extends TrendStats {
  symbol: string;
}

export type TrendSort = 'run' | 'pctAbove' | 'dist' | 'symbol';

/**
 * Compute MA trend-persistence for one symbol. Returns null when there are too
 * few candles for the SMA (needs more than `period`).
 */
export function computeTrend(candles: Candle[], period = 50): TrendStats | null {
  const line = sma(candles, period);
  if (line.length === 0) return null;

  const offset = period - 1; // candles[offset + j] aligns with line[j]
  let aboveCount = 0;
  const sides: boolean[] = [];
  for (let j = 0; j < line.length; j++) {
    const above = candles[offset + j].close > line[j].value;
    sides.push(above);
    if (above) aboveCount += 1;
  }

  const last = sides.length - 1;
  const currentlyAbove = sides[last];
  let runLen = 0;
  for (let j = last; j >= 0 && sides[j] === currentlyAbove; j--) runLen += 1;

  const close = candles[candles.length - 1].close;
  const smaVal = line[last].value;
  return {
    run: currentlyAbove ? runLen : -runLen,
    pctAbove: aboveCount / sides.length,
    above: currentlyAbove,
    dist: close > 0 ? ((close - smaVal) / close) * 100 : 0,
    n: sides.length,
  };
}

/** Build a sorted per-symbol trend-persistence board, skipping symbols with too little history. */
export function trendBoard(
  series: { symbol: string; candles: Candle[] }[],
  sort: TrendSort = 'run',
  period = 50,
): TrendRow[] {
  const rows: TrendRow[] = [];
  for (const s of series) {
    const stats = computeTrend(s.candles, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortTrend(rows, sort);
}

export function sortTrend(rows: TrendRow[], sort: TrendSort): TrendRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'pctAbove':
      out.sort((a, b) => b.pctAbove - a.pctAbove);
      break;
    case 'dist':
      out.sort((a, b) => b.dist - a.dist);
      break;
    case 'run':
    default:
      // Longest current up-runs first, longest down-runs last.
      out.sort((a, b) => b.run - a.run);
      break;
  }
  return out;
}
