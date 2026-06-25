/**
 * Geometric-Brownian-Motion price projection. Daily log returns are taken as
 * Normal(m, s²); the cumulative log return over d days is then Normal(m·d, s²·d),
 * so the price cone's percentiles are exact lognormal quantiles —
 * priceₚ(d) = S₀·exp(m·d + s·√d·zₚ). Computed analytically (deterministic, no
 * RNG) so it's unit-testable; the UI may overlay random sample paths for flavor.
 */

import { mean, stdev } from './distribution';

/** z-scores for the fixed percentile bands. */
const Z = {
  p5: -1.6448536269514722,
  p25: -0.6744897501960817,
  p50: 0,
  p75: 0.6744897501960817,
  p95: 1.6448536269514722,
} as const;

export interface ConePoint {
  day: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface Projection {
  s0: number;
  driftDaily: number; // mean daily log return
  volDaily: number; // std of daily log returns
  horizon: number;
  points: ConePoint[]; // day 0 … horizon
}

/** Daily log returns of a close series (skips non-positive prices). */
export function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) out.push(Math.log(closes[i] / closes[i - 1]));
  }
  return out;
}

/** Project a GBM percentile cone `horizonDays` ahead; null if history is too short. */
export function projectCone(closes: number[], horizonDays: number): Projection | null {
  const lr = logReturns(closes);
  const s0 = closes.length ? closes[closes.length - 1] : 0;
  if (lr.length < 2 || horizonDays < 1 || !(s0 > 0)) return null;

  const m = mean(lr);
  const s = stdev(lr);
  const points: ConePoint[] = [];
  for (let d = 0; d <= horizonDays; d++) {
    const drift = m * d;
    const sd = s * Math.sqrt(d);
    const at = (z: number) => s0 * Math.exp(drift + sd * z);
    points.push({ day: d, p5: at(Z.p5), p25: at(Z.p25), p50: at(Z.p50), p75: at(Z.p75), p95: at(Z.p95) });
  }
  return { s0, driftDaily: m, volDaily: s, horizon: horizonDays, points };
}
