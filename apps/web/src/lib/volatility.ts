/**
 * Volatility statistics — pure and offline, computed from a candle series:
 *
 *   - ATR     — Average True Range over N periods (absolute and % of price)
 *   - RV      — realized volatility: stdev of log returns, annualized
 *   - range   — full-window high-low spread as % of the last close
 *
 * Every function guards against short / non-positive series and returns null
 * rather than NaN when a statistic is undefined.
 */

export interface VolCandle {
  high: number;
  low: number;
  close: number;
}

/** Wilder's true range for one bar given the previous close. */
export function trueRange(high: number, low: number, prevClose: number): number {
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

/** Simple-average ATR over the last `period` bars; null if too few candles. */
export function atr(candles: readonly VolCandle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(trueRange(candles[i].high, candles[i].low, candles[i - 1].close));
  }
  const last = trs.slice(-period);
  return last.reduce((a, b) => a + b, 0) / period;
}

/** Annualized realized volatility (%) from log returns; null if undefined. */
export function realizedVolPct(candles: readonly VolCandle[], periodsPerYear: number): number | null {
  if (candles.length < 3) return null;
  const rets: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const p0 = candles[i - 1].close;
    const p1 = candles[i].close;
    if (p0 <= 0 || p1 <= 0) return null;
    rets.push(Math.log(p1 / p0));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear) * 100;
}

export interface VolStats {
  samples: number;
  lastClose: number;
  /** First → last close change over the window (%). */
  changePct: number | null;
  atr: number | null;
  atrPct: number | null;
  realizedVolPct: number | null;
  /** Window high-low spread as % of the last close. */
  highLowPct: number | null;
}

export function computeVolStats(
  candles: readonly VolCandle[],
  opts: { atrPeriod?: number; periodsPerYear: number },
): VolStats {
  const n = candles.length;
  const lastClose = n > 0 ? candles[n - 1].close : 0;
  const firstClose = n > 0 ? candles[0].close : 0;

  let hi = -Infinity;
  let lo = Infinity;
  for (const c of candles) {
    if (c.high > hi) hi = c.high;
    if (c.low < lo) lo = c.low;
  }

  const a = atr(candles, opts.atrPeriod ?? 14);
  const highLowPct =
    n > 0 && lastClose > 0 && Number.isFinite(hi) && Number.isFinite(lo)
      ? ((hi - lo) / lastClose) * 100
      : null;

  return {
    samples: n,
    lastClose,
    changePct: firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : null,
    atr: a,
    atrPct: a != null && lastClose > 0 ? (a / lastClose) * 100 : null,
    realizedVolPct: realizedVolPct(candles, opts.periodsPerYear),
    highLowPct,
  };
}
