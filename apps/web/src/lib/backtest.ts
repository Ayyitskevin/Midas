/**
 * Minimal long/flat backtests over a close series. Three strategies share one
 * simulator:
 *   • SMA crossover — long when the fast simple moving average is above the slow
 *     one, flat otherwise (a trend-follower).
 *   • RSI mean reversion — buy when RSI drops below an oversold line and hold
 *     until it recovers past an exit line (a dip-buyer).
 *   • Bollinger mean reversion — buy when price closes below the lower band and
 *     hold until it closes back above the middle band (a band dip-buyer).
 * All are applied with a one-bar lag (you act on the *next* bar after a signal,
 * so the test never peeks at a price it couldn't have traded on), and both feed
 * the same `simulate` core that produces the equity curve, the buy-and-hold
 * benchmark, and the read-outs that matter — total return, worst drawdown, trade
 * count, win rate and time in the market.
 *
 * Reuses the shared drawdown stats so the strategy's max drawdown matches the
 * rest of the terminal. Pure and deterministic for unit testing.
 */

import { drawdownStats } from './drawdown';

export interface BacktestParams {
  fast: number;
  slow: number;
}

export interface RsiBacktestParams {
  /** RSI lookback in bars. */
  period: number;
  /** Enter long when RSI drops below this level. */
  oversold: number;
  /** Exit to flat when RSI rises above this level (must exceed oversold). */
  exit: number;
}

export interface BollingerBacktestParams {
  /** Moving-average / band lookback in bars. */
  period: number;
  /** Band width in standard deviations. */
  mult: number;
}

export interface BacktestTrade {
  entryIdx: number;
  exitIdx: number;
  entryPrice: number;
  exitPrice: number;
  ret: number;
}

export interface BacktestResult {
  /** Strategy equity curve, starting at 1. */
  equity: number[];
  /** Buy-and-hold equity curve (close / close₀), starting at 1. */
  benchmark: number[];
  /** Position per bar (1 long, 0 flat). */
  position: number[];
  trades: BacktestTrade[];
  /** Total strategy return (equityₙ − 1). */
  stratReturn: number;
  /** Total buy-and-hold return. */
  benchReturn: number;
  /** Worst strategy drawdown, positive fraction. */
  maxDD: number;
  /** Profitable completed trades. */
  wins: number;
  /** wins / trades (0 when no trades). */
  winRate: number;
  /** Fraction of bars spent long. */
  exposure: number;
  /** Bars used. */
  n: number;
}

/** Trailing simple moving average; NaN until `period` bars are available. */
function sma(closes: number[], period: number): number[] {
  const n = closes.length;
  const out = new Array<number>(n).fill(NaN);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Simple (non-Wilder) RSI at each bar over a trailing `period` window, matching
 * the scanner's `rsi` helper. NaN until `period` price changes are available; a
 * flat window is 50, all-up 100, all-down 0.
 */
export function rsiSeries(closes: number[], period: number): number[] {
  const n = closes.length;
  const out = new Array<number>(n).fill(NaN);
  if (period < 1) return out;
  for (let i = period; i < n; i++) {
    let gain = 0;
    let loss = 0;
    for (let k = i - period + 1; k <= i; k++) {
      const d = closes[k] - closes[k - 1];
      if (d >= 0) gain += d;
      else loss += -d;
    }
    const avgGain = gain / period;
    const avgLoss = loss / period;
    if (avgLoss === 0) out[i] = avgGain === 0 ? 50 : 100;
    else if (avgGain === 0) out[i] = 0;
    else out[i] = 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/**
 * Turn a per-bar position series (1 long / 0 flat, position[t] held over bar t and
 * entered at the prior close) into the full backtest result: equity vs
 * buy-and-hold, completed trades, drawdown, win rate and exposure.
 */
function simulate(closes: number[], position: number[]): BacktestResult {
  const n = closes.length;
  const equity = new Array<number>(n);
  const benchmark = new Array<number>(n);
  equity[0] = 1;
  benchmark[0] = 1;
  for (let t = 1; t < n; t++) {
    const mret = closes[t - 1] !== 0 ? closes[t] / closes[t - 1] - 1 : 0;
    equity[t] = equity[t - 1] * (1 + position[t] * mret);
    benchmark[t] = closes[0] !== 0 ? closes[t] / closes[0] : 1;
  }

  const trades: BacktestTrade[] = [];
  let inPos = false;
  let entryIdx = -1;
  let entryPrice = 0;
  for (let t = 1; t < n; t++) {
    if (position[t] === 1 && !inPos) {
      inPos = true;
      entryIdx = t;
      entryPrice = closes[t - 1]; // bought at the prior close
    } else if (position[t] === 0 && inPos) {
      inPos = false;
      const exitPrice = closes[t - 1];
      trades.push({ entryIdx, exitIdx: t - 1, entryPrice, exitPrice, ret: exitPrice / entryPrice - 1 });
    }
  }
  if (inPos) {
    const exitPrice = closes[n - 1];
    trades.push({ entryIdx, exitIdx: n - 1, entryPrice, exitPrice, ret: exitPrice / entryPrice - 1 });
  }

  const wins = trades.filter((t) => t.ret > 0).length;
  let inMarket = 0;
  for (const p of position) inMarket += p;
  const ddMax = drawdownStats(equity).maxDD; // ≤ 0

  return {
    equity,
    benchmark,
    position,
    trades,
    stratReturn: equity[n - 1] - 1,
    benchReturn: benchmark[n - 1] - 1,
    maxDD: ddMax < 0 ? -ddMax : 0,
    wins,
    winRate: trades.length > 0 ? wins / trades.length : 0,
    exposure: inMarket / n,
    n,
  };
}

/**
 * Run the SMA-crossover backtest over a close series. Returns null when the
 * parameters are invalid (fast ≥ slow, non-positive) or there isn't enough
 * history for the slow average plus a bar to trade.
 */
export function backtestSmaCross(closes: number[], params: BacktestParams): BacktestResult | null {
  const f = Math.floor(params.fast);
  const s = Math.floor(params.slow);
  const n = closes.length;
  if (!Number.isFinite(f) || !Number.isFinite(s) || f < 1 || s < 1 || f >= s || n < s + 1) return null;

  const fast = sma(closes, f);
  const slow = sma(closes, s);

  const position = new Array<number>(n).fill(0);
  for (let t = 1; t < n; t++) {
    const i = t - 1; // act on the next bar after the signal
    if (!Number.isNaN(fast[i]) && !Number.isNaN(slow[i])) position[t] = fast[i] > slow[i] ? 1 : 0;
  }

  return simulate(closes, position);
}

/**
 * Run the RSI mean-reversion backtest: go long the bar after RSI closes below
 * `oversold`, and return to flat the bar after it closes back above `exit`
 * (long-only dip buying). Returns null on invalid params (period < 1, exit not
 * above oversold, out-of-range thresholds) or too little history for an RSI read
 * plus a bar to trade.
 */
export function backtestRsiReversion(closes: number[], params: RsiBacktestParams): BacktestResult | null {
  const p = Math.floor(params.period);
  const { oversold, exit } = params;
  const n = closes.length;
  if (!Number.isFinite(p) || p < 1 || !(oversold > 0) || !(exit > oversold) || exit > 100 || n < p + 2)
    return null;

  const r = rsiSeries(closes, p);

  const position = new Array<number>(n).fill(0);
  let held = false;
  for (let t = 1; t < n; t++) {
    const i = t - 1; // act on the next bar after the signal
    const v = r[i];
    if (!Number.isNaN(v)) {
      if (!held && v < oversold) held = true;
      else if (held && v > exit) held = false;
    }
    position[t] = held ? 1 : 0;
  }

  return simulate(closes, position);
}

/**
 * Bollinger bands over a trailing `period` window: the simple moving average
 * (middle band) and ± `mult` population standard deviations. NaN until the
 * window fills.
 */
export function bollingerBands(
  closes: number[],
  period: number,
  mult: number,
): { mid: number[]; lower: number[]; upper: number[] } {
  const n = closes.length;
  const mid = new Array<number>(n).fill(NaN);
  const lower = new Array<number>(n).fill(NaN);
  const upper = new Array<number>(n).fill(NaN);
  if (period < 1) return { mid, lower, upper };
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let k = i - period + 1; k <= i; k++) sum += closes[k];
    const m = sum / period;
    let v = 0;
    for (let k = i - period + 1; k <= i; k++) {
      const d = closes[k] - m;
      v += d * d;
    }
    const sd = Math.sqrt(v / period);
    mid[i] = m;
    lower[i] = m - mult * sd;
    upper[i] = m + mult * sd;
  }
  return { mid, lower, upper };
}

/**
 * Run the Bollinger mean-reversion backtest: go long the bar after price closes
 * below the lower band, and return to flat the bar after it closes back above
 * the middle band (long-only band dip buying). Returns null on invalid params
 * (period < 2, non-positive width) or too little history for a band read plus a
 * bar to trade.
 */
export function backtestBollinger(
  closes: number[],
  params: BollingerBacktestParams,
): BacktestResult | null {
  const p = Math.floor(params.period);
  const { mult } = params;
  const n = closes.length;
  if (!Number.isFinite(p) || p < 2 || !Number.isFinite(mult) || !(mult > 0) || n < p + 1) return null;

  const { mid, lower } = bollingerBands(closes, p, mult);

  const position = new Array<number>(n).fill(0);
  let held = false;
  for (let t = 1; t < n; t++) {
    const i = t - 1; // act on the next bar after the signal
    if (!Number.isNaN(lower[i]) && !Number.isNaN(mid[i])) {
      if (!held && closes[i] < lower[i]) held = true;
      else if (held && closes[i] > mid[i]) held = false;
    }
    position[t] = held ? 1 : 0;
  }

  return simulate(closes, position);
}
