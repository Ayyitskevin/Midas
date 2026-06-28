/**
 * Relative Strength (Levy) — RSL screener helpers.
 *
 * Robert Levy's relative strength compares price to its own moving average:
 *
 *   RSL = close / SMA(close, N)
 *
 * It is a momentum / trend gauge: RSL > 1 means price trades above its N-period
 * average (leading its own trend, bullish), RSL < 1 means it lags (bearish),
 * and 1.0 sits exactly on the average. Levy's original work used a 27-week
 * window (~130 trading days); the module defaults to 130 with a faster 50-bar
 * preset.
 *
 * Unlike a raw price or range, RSL is a ratio of two same-scale prices, so it is
 * naturally scale-invariant and comparable straight across symbols — a reading
 * of 1.15 is "15% above its average" whether the coin trades at $60,000 or
 * $0.50. `devPct` restates the same signal as a percentage above/below the
 * average ((RSL − 1)·100).
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed closes.
 */

export type RslSide = 'up' | 'down';

export interface RslStats {
  /** Relative Strength (Levy): close ÷ SMA(close, N). 1.0 = on the average. */
  rsl: number;
  /** Percentage above (+) or below (−) the moving average: (RSL − 1)·100. */
  devPct: number;
  /** RSL ≥ 1 (above its average / strong) or < 1 (below / weak). */
  side: RslSide;
  /** Lookback period used for the SMA. */
  period: number;
  /** Number of closes supplied. */
  n: number;
}

export interface RslRow extends RslStats {
  symbol: string;
}

export type RslSort = 'rsl' | 'symbol';

/**
 * Compute the latest Relative Strength (Levy) for one symbol. Needs at least
 * `period` closes for the SMA; returns null on bad params, too little history,
 * or a non-positive average.
 */
export function computeRsl(closes: number[], period = 130): RslStats | null {
  if (period < 1) return null;
  const n = closes.length;
  if (n < period) return null;

  let sum = 0;
  for (let i = n - period; i < n; i++) sum += closes[i];
  const sma = sum / period;
  if (!(sma > 0)) return null;

  const close = closes[n - 1];
  const rsl = close / sma;
  const devPct = (rsl - 1) * 100;
  return { rsl, devPct, side: rsl >= 1 ? 'up' : 'down', period, n };
}

/** Build a sorted per-symbol RSL board, skipping symbols with too little history. */
export function rslBoard(
  series: { symbol: string; closes: number[] }[],
  sort: RslSort = 'rsl',
  period = 130,
): RslRow[] {
  const rows: RslRow[] = [];
  for (const s of series) {
    const stats = computeRsl(s.closes, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortRsl(rows, sort);
}

export function sortRsl(rows: RslRow[], sort: RslSort): RslRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'rsl':
    default:
      // Strongest relative strength (furthest above its average) first.
      out.sort((a, b) => b.rsl - a.rsl);
      break;
  }
  return out;
}
