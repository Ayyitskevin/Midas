/**
 * Chaikin Volatility (CVOL) screener helpers.
 *
 * Marc Chaikin's volatility gauge measures how fast a market's trading range is
 * expanding or contracting. It takes an EMA of the high−low range, then its
 * percent rate-of-change over a lookback:
 *
 *   range[t]   = high[t] − low[t]
 *   emaHL[t]   = EMA(range, emaPeriod)
 *   CVOL[t]    = 100 · (emaHL[t] − emaHL[t − rocPeriod]) / emaHL[t − rocPeriod]
 *
 * Defaults emaPeriod = 10, rocPeriod = 10 (Chaikin's original). A positive value
 * means the smoothed range is wider than `rocPeriod` bars ago — volatility is
 * expanding (often near tops / breakouts); negative means it is contracting
 * (consolidation). Because CVOL is a percent rate-of-change, the price units
 * cancel, so it is inherently scale-invariant and ranks cleanly across symbols.
 *
 * The EMA reuses the repo's first-value-seeded `emaSeries`, matching every other
 * EMA-based board here. Pure and synchronous.
 */

import { emaSeries } from './indicators';

/** Minimal bar (Chaikin Volatility uses the high−low range). */
export interface ChaikinBar {
  high: number;
  low: number;
}

export type ChaikinRegime = 'expanding' | 'contracting' | 'flat';

export interface ChaikinVolStats {
  /** Percent rate-of-change of the smoothed high−low range (signed, scale-invariant). */
  chaikinVol: number;
  /** Current EMA of the high−low range (price units — context, not the ranking key). */
  emaHL: number;
  /** Expanding (CVOL > 0) / contracting (< 0) / flat volatility regime. */
  regime: ChaikinRegime;
  /** Number of bars supplied. */
  n: number;
}

export interface ChaikinVolRow extends ChaikinVolStats {
  symbol: string;
}

export type ChaikinVolSort = 'cvol' | 'symbol';

/**
 * EMA of the high−low range, aligned to the input bars (first-value seeded).
 */
export function chaikinRangeEma(bars: ChaikinBar[], emaPeriod = 10): number[] {
  const range = bars.map((b) => b.high - b.low);
  return emaSeries(range, emaPeriod);
}

/**
 * Compute the latest Chaikin Volatility reading for one symbol. Needs at least
 * emaPeriod + rocPeriod bars so the ROC reaches back past the EMA warm-up;
 * returns null on bad params or too little history.
 */
export function computeChaikinVol(
  bars: ChaikinBar[],
  emaPeriod = 10,
  rocPeriod = 10,
): ChaikinVolStats | null {
  const n = bars.length;
  if (emaPeriod < 1 || rocPeriod < 1 || n < emaPeriod + rocPeriod) return null;

  const ema = chaikinRangeEma(bars, emaPeriod);
  const cur = ema[n - 1];
  const past = ema[n - 1 - rocPeriod];
  if (!Number.isFinite(cur) || !Number.isFinite(past) || past === 0) return null;

  const chaikinVol = (100 * (cur - past)) / past;
  const regime: ChaikinRegime = chaikinVol > 0 ? 'expanding' : chaikinVol < 0 ? 'contracting' : 'flat';

  return { chaikinVol, emaHL: cur, regime, n };
}

/** Build a sorted per-symbol Chaikin Volatility board, skipping symbols with too little history. */
export function chaikinVolBoard(
  series: { symbol: string; bars: ChaikinBar[] }[],
  sort: ChaikinVolSort = 'cvol',
  emaPeriod = 10,
  rocPeriod = 10,
): ChaikinVolRow[] {
  const rows: ChaikinVolRow[] = [];
  for (const s of series) {
    const stats = computeChaikinVol(s.bars, emaPeriod, rocPeriod);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortChaikinVol(rows, sort);
}

export function sortChaikinVol(rows: ChaikinVolRow[], sort: ChaikinVolSort): ChaikinVolRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'cvol':
    default:
      out.sort((a, b) => b.chaikinVol - a.chaikinVol);
      break;
  }
  return out;
}
