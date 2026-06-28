/**
 * Ehlers Roofing Filter (ROOF) screener helpers.
 *
 * John Ehlers' Roofing Filter (Cycle Analytics for Traders, 2013). It passes
 * only the tradable cycle band by stacking two filters — a "roof":
 *
 *   1. A two-pole HIGH-PASS removes components slower than `hpPeriod` (trend):
 *        α₁    = (cosD(a) + sinD(a) − 1) / cosD(a),  a = 0.707·360 / hpPeriod  (deg)
 *        HP[i] = (1 − α₁/2)²·(Close[i] − 2·Close[i−1] + Close[i−2])
 *              + 2(1 − α₁)·HP[i−1] − (1 − α₁)²·HP[i−2]
 *   2. A two-pole SuperSmoother LOW-PASS removes components faster than `ssPeriod`
 *      (noise):
 *        a1 = exp(−1.414·π / ssPeriod),  b1 = 2·a1·cosD(1.414·180 / ssPeriod)  (deg)
 *        c2 = b1,  c3 = −a1²,  c1 = 1 − c2 − c3
 *        Filt[i] = c1·(HP[i] + HP[i−1]) / 2 + c2·Filt[i−1] + c3·Filt[i−2]
 *
 * Defaults hpPeriod = 48, ssPeriod = 10 (Ehlers). What survives is a smooth,
 * de-trended oscillation about zero.
 *
 * CONVENTION TRAPS (confirmed by a multi-agent derive→fixture→verify workflow
 * against three independent computations):
 *  - EasyLanguage `Cosine()/Sine()` take DEGREES; the trig args must be converted
 *    via ·π/180 before any radian Math.cos/sin. The unit-DC-gain identity
 *    c1 + c2 + c3 = 1 holds ONLY under the degree reading.
 *  - The SuperSmoother exponent uses full `Math.PI` (a truncated 3.14159 shifts
 *    every coefficient at the ~7th significant figure).
 *  - Warm-up: HP[0]=HP[1]=Filt[0]=Filt[1]=0; the recurrence is active from i ≥ 2,
 *    and the output is transient for roughly the first `hpPeriod` bars.
 *
 * Cross-symbol scaling: the raw Filt is a band-passed price (zero-centred, in
 * price units), so its amplitude scales with each symbol's volatility — dividing
 * by price does NOT equalise it. The board ranks on an Ehlers AGC peak-normalised
 * signal (Filt / running-peak, bounded ±1) so every symbol swings comparably.
 *
 * Pure and synchronous.
 */

const cosD = (deg: number): number => Math.cos((deg * Math.PI) / 180);
const sinD = (deg: number): number => Math.sin((deg * Math.PI) / 180);

export interface RoofingFilterResult {
  /** The high-pass intermediate series (same length as input, 0-seeded for i<2). */
  hp: number[];
  /** The SuperSmoothed high-pass output — the Roofing Filter (price units). */
  filt: number[];
}

/**
 * Compute the raw Roofing Filter series for a close array. Returns HP and Filt
 * arrays the same length as `closes` (indices 0,1 are 0-seeds). Trig in degrees,
 * SuperSmoother exponent on full Math.PI.
 */
export function roofingFilter(closes: number[], hpPeriod = 48, ssPeriod = 10): RoofingFilterResult {
  const n = closes.length;
  const hp = new Array<number>(n).fill(0);
  const filt = new Array<number>(n).fill(0);
  if (n === 0) return { hp, filt };

  const angHP = (0.707 * 360) / hpPeriod;
  const alpha1 = (cosD(angHP) + sinD(angHP) - 1) / cosD(angHP);
  const k = (1 - alpha1 / 2) * (1 - alpha1 / 2);
  const f1 = 2 * (1 - alpha1);
  const f2 = (1 - alpha1) * (1 - alpha1);

  const a1 = Math.exp((-1.414 * Math.PI) / ssPeriod);
  const b1 = 2 * a1 * cosD((1.414 * 180) / ssPeriod);
  const c2 = b1;
  const c3 = -a1 * a1;
  const c1 = 1 - c2 - c3;

  for (let i = 2; i < n; i++) {
    hp[i] = k * (closes[i] - 2 * closes[i - 1] + closes[i - 2]) + f1 * hp[i - 1] - f2 * hp[i - 2];
    filt[i] = (c1 * (hp[i] + hp[i - 1])) / 2 + c2 * filt[i - 1] + c3 * filt[i - 2];
  }
  return { hp, filt };
}

/**
 * Ehlers automatic-gain-control peak normaliser: rescales a zero-centred series
 * to ~±1 by dividing each value by a fast-attack / slow-decay running peak of its
 * magnitude. Equalises oscillation amplitude across symbols of differing
 * volatility. `decay` is the per-bar peak decay (0.991 ≈ Ehlers' default).
 */
export function agcNormalize(values: number[], decay = 0.991): number[] {
  const out = new Array<number>(values.length).fill(0);
  let peak = 0;
  for (let i = 0; i < values.length; i++) {
    peak = Math.max(Math.abs(values[i]), decay * peak);
    out[i] = peak > 0 ? values[i] / peak : 0;
  }
  return out;
}

export type RoofCross = 'bull' | 'bear' | 'none';

export interface RoofStats {
  /** AGC-normalised Roofing Filter at the latest bar (≈ ±1, scale-invariant). */
  signal: number;
  /** Trigger — the normalised filter one bar back. */
  trigger: number;
  /** Raw Filt as a percent of price (human-readable context, not the ranking key). */
  filtPct: number;
  /** Fresh cyclic turn relative to the trigger on the latest bar. */
  cross: RoofCross;
  /** Number of bars supplied. */
  n: number;
}

export interface RoofRow extends RoofStats {
  symbol: string;
}

export type RoofSort = 'roof' | 'symbol';

/**
 * Compute the latest Roofing Filter reading for one symbol. Needs at least
 * `hpPeriod` closes so the filter has spun up past its warm-up transient;
 * returns null on bad params or too little history.
 */
export function computeRoof(closes: number[], hpPeriod = 48, ssPeriod = 10): RoofStats | null {
  const n = closes.length;
  if (hpPeriod <= 0 || ssPeriod <= 0 || n < hpPeriod || n < 3) return null;

  const { filt } = roofingFilter(closes, hpPeriod, ssPeriod);
  const norm = agcNormalize(filt);

  const last = n - 1;
  const signal = norm[last];
  const trigger = norm[last - 1];

  const close = closes[last];
  const filtPct = close === 0 ? 0 : (100 * filt[last]) / close;

  // Cyclic turn: the band-pass crossing its 1-bar trigger marks a peak/trough.
  let cross: RoofCross = 'none';
  const fPrev = filt[last - 1];
  const fPrev2 = filt[last - 2];
  if (fPrev <= fPrev2 && filt[last] > fPrev) cross = 'bull';
  else if (fPrev >= fPrev2 && filt[last] < fPrev) cross = 'bear';

  return { signal, trigger, filtPct, cross, n };
}

/** Build a sorted per-symbol Roofing Filter board, skipping symbols with too little history. */
export function roofBoard(
  series: { symbol: string; closes: number[] }[],
  sort: RoofSort = 'roof',
  hpPeriod = 48,
  ssPeriod = 10,
): RoofRow[] {
  const rows: RoofRow[] = [];
  for (const s of series) {
    const stats = computeRoof(s.closes, hpPeriod, ssPeriod);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortRoof(rows, sort);
}

export function sortRoof(rows: RoofRow[], sort: RoofSort): RoofRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'roof':
    default:
      out.sort((a, b) => b.signal - a.signal);
      break;
  }
  return out;
}
