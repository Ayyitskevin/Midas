/**
 * Schaff Trend Cycle (Doug Schaff, 1999).
 *
 * A cyclical oscillator that runs a stochastic over the MACD line, then a
 * second stochastic over that — each pass smoothed — to turn earlier than a
 * plain MACD while staying bounded in [0, 100]:
 *
 *   macd = EMA(close, fast) − EMA(close, slow)
 *   pf   = smooth( stochastic(macd, cycle) )      // first %D
 *   stc  = smooth( stochastic(pf,  cycle) )      // second %D = STC
 *
 * Each `stochastic` rescales its input to 0–100 over the trailing `cycle`
 * window; each `smooth` is an EMA-like pass with factor 0.5 (equivalent to a
 * length-3 EMA). When a window is flat the stochastic carries its prior value
 * forward. STC reacts faster than MACD: > 75 and rising flags a strengthening
 * up-cycle, < 25 a down-cycle, with crosses of 25 / 75 the common triggers.
 *
 * The convention here (seeded EMAs, prev-init-0 smoothing, partial-window
 * stochastic, carry-forward on zero range, final clamp) matches the de-facto
 * everget / shayankm TradingView reference — verified against an independent
 * worked example. Pure and synchronous so it can be unit-tested exactly.
 */

import { emaSeries } from './indicators';

export type StcZone = 'bull' | 'bear' | 'mid';
export type StcDir = 'up' | 'down';

export interface StcStats {
  /** Schaff Trend Cycle at the latest bar, clamped to [0, 100]. */
  stc: number;
  /** STC one bar back, for slope / direction. */
  prev: number;
  /** Cycle rising (stc ≥ prev) or falling. */
  dir: StcDir;
  /** ≥ 75 bull cycle, ≤ 25 bear cycle, otherwise mid. */
  zone: StcZone;
  /** Number of closes supplied. */
  n: number;
}

export interface StcRow extends StcStats {
  symbol: string;
}

export type StcSort = 'stc' | 'slope' | 'symbol';

/**
 * Stochastic-normalize `x` over a trailing `cycle` window, then EMA-smooth with
 * `factor`. Partial windows are used at the start; a flat window carries the
 * previous raw stochastic forward (initial 0); the smoother seeds prev = 0.
 */
function stochSmooth(x: number[], cycle: number, factor: number): number[] {
  const out: number[] = [];
  let prevRaw = 0;
  let smoothed = 0;
  for (let i = 0; i < x.length; i++) {
    const start = Math.max(0, i - cycle + 1);
    let lo = x[start];
    let hi = x[start];
    for (let j = start + 1; j <= i; j++) {
      if (x[j] < lo) lo = x[j];
      if (x[j] > hi) hi = x[j];
    }
    const range = hi - lo;
    const raw = range > 0 ? ((x[i] - lo) / range) * 100 : i > 0 ? prevRaw : 0;
    prevRaw = raw;
    smoothed = smoothed + factor * (raw - smoothed);
    out.push(smoothed);
  }
  return out;
}

/**
 * Compute the latest Schaff Trend Cycle for one symbol. Returns null with bad
 * params or too little history (needs ≥ slow + 2·cycle closes so both EMAs and
 * the two stochastic windows are defined).
 */
export function computeStc(
  closes: number[],
  fast = 23,
  slow = 50,
  cycle = 10,
  factor = 0.5,
): StcStats | null {
  if (fast < 1 || slow <= fast || cycle < 2 || factor <= 0 || factor > 1) return null;
  if (closes.length < slow + 2 * cycle) return null;

  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  const macd = closes.map((_, i) => emaFast[i] - emaSlow[i]);

  const pf = stochSmooth(macd, cycle, factor);
  const series = stochSmooth(pf, cycle, factor);

  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const last = series.length - 1;
  const stc = clamp(series[last]);
  const prev = clamp(series[Math.max(0, last - 1)]);
  const dir: StcDir = stc >= prev ? 'up' : 'down';
  const zone: StcZone = stc >= 75 ? 'bull' : stc <= 25 ? 'bear' : 'mid';
  return { stc, prev, dir, zone, n: closes.length };
}

/** Build a sorted per-symbol STC board, skipping symbols with too little history. */
export function stcBoard(
  series: { symbol: string; closes: number[] }[],
  sort: StcSort = 'stc',
  fast = 23,
  slow = 50,
  cycle = 10,
  factor = 0.5,
): StcRow[] {
  const rows: StcRow[] = [];
  for (const s of series) {
    const stats = computeStc(s.closes, fast, slow, cycle, factor);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortStc(rows, sort);
}

export function sortStc(rows: StcRow[], sort: StcSort): StcRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'slope':
      out.sort((a, b) => b.stc - b.prev - (a.stc - a.prev));
      break;
    case 'stc':
    default:
      out.sort((a, b) => b.stc - a.stc);
      break;
  }
  return out;
}
