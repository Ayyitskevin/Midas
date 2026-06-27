/**
 * Disparity Index screener helpers.
 *
 * Steve Nison's Disparity Index measures how far price has stretched from its
 * moving average, as a percentage of that average:
 *
 *   DI = 100 × (close − EMA(close, N)) / EMA(close, N)
 *
 * Above zero means price trades above its mean (uptrend bias), below zero below
 * it; the magnitude is the stretch and, being a percentage, is comparable
 * across symbols regardless of price. Large positive / negative readings flag
 * over-extension from the mean. Reuses the shared seeded `emaSeries`, so the
 * mean matches the chart's EMA overlay. Default look-back N = 14.
 */
import { emaSeries } from './indicators';

export interface DisparityStats {
  /** Latest Disparity Index (% of the EMA). */
  di: number;
  /** Prior bar's Disparity Index. */
  prev: number;
  /** Direction of the latest move (di ≥ prev → up). */
  dir: 'up' | 'down';
  /** Which side of the mean price sits on. */
  side: 'above' | 'below';
  /** Number of closes supplied. */
  n: number;
}

export interface DisparityRow extends DisparityStats {
  symbol: string;
}

export type DisparitySort = 'di' | 'abs' | 'symbol';

/** Disparity Index at bar index i: 100 × (close − ema) / ema (0 when ema is 0). */
function diAt(closes: number[], ema: number[], i: number): number {
  return ema[i] !== 0 ? (100 * (closes[i] - ema[i])) / ema[i] : 0;
}

/**
 * Compute the latest Disparity Index for one symbol. Needs more than `period`
 * closes so the EMA has warmed and a prior bar exists; returns null otherwise.
 */
export function computeDisparity(closes: number[], period = 14): DisparityStats | null {
  if (period < 1) return null;
  const n = closes.length;
  if (n < period + 1) return null;

  const ema = emaSeries(closes, period);
  const last = n - 1;
  const di = diAt(closes, ema, last);
  const prev = diAt(closes, ema, last - 1);
  return {
    di,
    prev,
    dir: di >= prev ? 'up' : 'down',
    side: di >= 0 ? 'above' : 'below',
    n,
  };
}

/** Build a sorted per-symbol Disparity Index board, skipping thin history. */
export function disparityBoard(
  series: { symbol: string; closes: number[] }[],
  sort: DisparitySort = 'di',
  period = 14,
): DisparityRow[] {
  const rows: DisparityRow[] = [];
  for (const s of series) {
    const stats = computeDisparity(s.closes, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortDisparity(rows, sort);
}

export function sortDisparity(rows: DisparityRow[], sort: DisparitySort): DisparityRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'abs':
      out.sort((a, b) => Math.abs(b.di) - Math.abs(a.di));
      break;
    case 'di':
    default:
      out.sort((a, b) => b.di - a.di);
      break;
  }
  return out;
}
