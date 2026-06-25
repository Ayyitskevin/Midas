/**
 * A minimal SMA-crossover backtest. The rule is long when the fast simple moving
 * average is above the slow one and flat otherwise, applied with a one-bar lag
 * (you act on the *next* bar after a cross, so the test never peeks at a price it
 * couldn't have traded on). The result carries the strategy equity curve, the
 * buy-and-hold benchmark, and the read-outs that matter — total return, worst
 * drawdown, trade count, win rate and time in the market.
 *
 * Reuses the shared drawdown stats so the strategy's max drawdown matches the
 * rest of the terminal. Pure and deterministic for unit testing.
 */

import { drawdownStats } from './drawdown';

export interface BacktestParams {
  fast: number;
  slow: number;
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
 * Run the SMA-crossover backtest over a close series. Returns null when the
 * parameters are invalid (fast ≥ slow, non-positive) or there isn't enough
 * history for the slow average plus a bar to trade.
 */
export function backtestSmaCross(closes: number[], params: BacktestParams): BacktestResult | null {
  const f = Math.floor(params.fast);
  const s = Math.floor(params.slow);
  const n = closes.length;
  if (f < 1 || s < 1 || f >= s || n < s + 1) return null;

  const fast = sma(closes, f);
  const slow = sma(closes, s);

  const position = new Array<number>(n).fill(0);
  for (let t = 1; t < n; t++) {
    const i = t - 1; // act on the next bar after the signal
    if (!Number.isNaN(fast[i]) && !Number.isNaN(slow[i])) position[t] = fast[i] > slow[i] ? 1 : 0;
  }

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
