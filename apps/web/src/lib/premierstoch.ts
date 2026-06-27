/**
 * Premier Stochastic Oscillator (Lee Leibfarth, TASC 2008).
 *
 * Takes a fast stochastic, normalises and double-EMA-smooths it, then squashes
 * the result through an exponential transform into a crisp ±1 oscillator:
 *
 *   stochK = 100·(close − lowestLow) / (highestHigh − lowestLow)   over `length`
 *   nsk    = 0.1·(stochK − 50)                                     centered, ≈ [-5, 5]
 *   ss     = EMA(EMA(nsk, smooth), smooth)                         double smoothed
 *   PSO    = (e^ss − 1) / (e^ss + 1)                               = tanh(ss/2), in [-1, 1]
 *
 * The exponential transform sharpens turns: PSO sits near ±1 only on a
 * sustained, smoothed stochastic extreme. > +0.9 is strongly overbought, < −0.9
 * strongly oversold (±0.2 are the minor zones); zero-line crossovers and the
 * ±0.9 extremes are the triggers.
 *
 * Defaults: stochastic length 8, smoothing EMA period 5. NOTE: Leibfarth's
 * published input is a "smoothing length" of 25 from which the EMA period is
 * derived as round(√25) = 5 — `smooth` here is that EMA period (5), not the raw
 * 25. Verified against an independent worked example. Pure and synchronous.
 */

import { emaSeries } from './indicators';

export type PsoZone = 'ob' | 'os' | 'mid';
export type PsoDir = 'up' | 'down';

export interface PsoBar {
  high: number;
  low: number;
  close: number;
}

export interface PsoStats {
  /** Premier Stochastic at the latest bar, in [-1, 1]. */
  pso: number;
  /** PSO one bar back, for slope / direction. */
  prev: number;
  /** PSO rising (pso ≥ prev) or falling. */
  dir: PsoDir;
  /** ≥ 0.9 strongly overbought, ≤ −0.9 strongly oversold, otherwise mid. */
  zone: PsoZone;
  /** Number of bars supplied. */
  n: number;
}

export interface PsoRow extends PsoStats {
  symbol: string;
}

export type PsoSort = 'pso' | 'slope' | 'symbol';

/**
 * Compute the latest Premier Stochastic Oscillator for one symbol. Returns null
 * with bad params or too little history (needs ≥ length + 2·smooth bars so the
 * stochastic window and the double EMA warm up).
 */
export function computePso(bars: PsoBar[], length = 8, smooth = 5): PsoStats | null {
  if (length < 1 || smooth < 1) return null;
  const n = bars.length;
  if (n < length + 2 * smooth) return null;

  const nsk: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - length + 1);
    let hh = bars[start].high;
    let ll = bars[start].low;
    for (let j = start + 1; j <= i; j++) {
      if (bars[j].high > hh) hh = bars[j].high;
      if (bars[j].low < ll) ll = bars[j].low;
    }
    const rng = hh - ll;
    const stochK = rng !== 0 ? (100 * (bars[i].close - ll)) / rng : 50;
    nsk.push(0.1 * (stochK - 50));
  }

  const ss = emaSeries(emaSeries(nsk, smooth), smooth);
  const psoOf = (v: number) => {
    const e = Math.exp(v);
    return (e - 1) / (e + 1);
  };

  const last = n - 1;
  const pso = psoOf(ss[last]);
  const prev = psoOf(ss[Math.max(0, last - 1)]);
  const zone: PsoZone = pso >= 0.9 ? 'ob' : pso <= -0.9 ? 'os' : 'mid';
  return { pso, prev, dir: pso >= prev ? 'up' : 'down', zone, n };
}

/** Build a sorted per-symbol Premier Stochastic board, skipping symbols with too little history. */
export function psoBoard(
  series: { symbol: string; bars: PsoBar[] }[],
  sort: PsoSort = 'pso',
  length = 8,
  smooth = 5,
): PsoRow[] {
  const rows: PsoRow[] = [];
  for (const s of series) {
    const stats = computePso(s.bars, length, smooth);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortPso(rows, sort);
}

export function sortPso(rows: PsoRow[], sort: PsoSort): PsoRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'slope':
      out.sort((a, b) => b.pso - b.prev - (a.pso - a.prev));
      break;
    case 'pso':
    default:
      out.sort((a, b) => b.pso - a.pso);
      break;
  }
  return out;
}
