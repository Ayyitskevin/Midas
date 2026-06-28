/**
 * Polarized Fractal Efficiency (PFE) screener helpers.
 *
 * Hans Hannula's PFE (Stocks & Commodities, 1994) measures how efficient /
 * directional price travel is — the straight-line distance over N bars versus
 * the jagged path price actually took — and polarizes it by the net direction:
 *
 *   straightLine = √( (Close[t] − Close[t−N])² + N² )      // chord, horizontal leg N
 *   pathLength   = Σ_{k=0..N−1} √( (Close[t−k] − Close[t−k−1])² + 1 )  // N unit-bar legs
 *   sign         = (Close[t] ≥ Close[t−N]) ? +1 : −1
 *   PFE_raw[t]   = sign · 100 · straightLine / pathLength
 *   PFE[t]       = EMA(PFE_raw, M)                          // α = 2/(M+1), first-value seed
 *
 * Bounded exactly ±100: pathLength ≥ straightLine (triangle inequality on the N
 * matched unit legs), so |ratio| ≤ 1. +100 = a perfectly straight, efficient
 * up-move; −100 = the same straight efficiency net down; ≈ 0 = serpentine/choppy.
 * Defaults N = 10, M = 5.
 *
 * SCALE TRAP (resolved by a multi-agent derive→fixture→verify workflow, high
 * confidence): the "+N²" and "+1" horizontal floors are constants in PRICE units,
 * so raw PFE is NOT scale-invariant — the same percentage shape reads ≈ −100 at
 * penny prices (the floors dominate → saturation) and ≈ −1 at BTC prices (the
 * floors vanish → the bare Kaufman efficiency ratio). A cross-symbol leaderboard
 * on raw PFE would pin every sub-dollar coin to the rails and compress the
 * expensive ones. Fix: rebase each N-bar window into indexed/percentage space
 * before the fractal computation —
 *
 *   base   = Close[t−N]               // window anchor (oldest close)
 *   scale  = reference / base          // reference R fixes the horizontal calibration
 *   replace every price difference d in the window with d · scale (≈ R · percent move)
 *
 * R = 100 maps a 1 % bar to ≈ 1.0 vertical unit (commensurate with the path's
 * horizontal leg of 1), keeping typical crypto volatility in a sensitive,
 * non-saturated band. The rebase is a pure positive rescale of the price axis, so
 * every difference's sign — and thus the polarity — is preserved. The board uses
 * this normalized PFE; the raw form is kept only as the core-formula fixture.
 *
 * Pure and synchronous.
 */

import { emaSeries } from './indicators';

export type PfeNormalize = 'rebase' | 'none';

/**
 * Raw Polarized Fractal Efficiency for the defined tail (one value per bar from
 * index `lookback` to the end). With `normalize = 'rebase'` each N-bar window is
 * rebased to `reference` at its anchor so the result is comparable across symbols
 * of any price magnitude.
 */
export function pfeRawSeries(
  closes: number[],
  lookback = 10,
  normalize: PfeNormalize = 'rebase',
  reference = 100,
): number[] {
  const out: number[] = [];
  const n = lookback;
  for (let t = n; t < closes.length; t++) {
    const base = closes[t - n];
    const scale = normalize === 'rebase' ? (base !== 0 ? reference / base : 0) : 1;

    const dN = (closes[t] - closes[t - n]) * scale;
    const straight = Math.sqrt(dN * dN + n * n);

    let path = 0;
    for (let k = 0; k < n; k++) {
      const seg = (closes[t - k] - closes[t - k - 1]) * scale;
      path += Math.sqrt(seg * seg + 1);
    }

    const sign = closes[t] >= closes[t - n] ? 1 : -1;
    out.push(path === 0 ? 0 : (sign * 100 * straight) / path);
  }
  return out;
}

/**
 * Smoothed PFE series (EMA of the raw tail), one value per bar from index
 * `lookback` to the end. Empty if there is too little history.
 */
export function pfeSeries(
  closes: number[],
  lookback = 10,
  smoothing = 5,
  normalize: PfeNormalize = 'rebase',
  reference = 100,
): number[] {
  const raw = pfeRawSeries(closes, lookback, normalize, reference);
  if (raw.length === 0) return [];
  return emaSeries(raw, smoothing);
}

export type PfeZone = 'up' | 'down' | 'choppy';

/** |PFE| ≥ 50 ⇒ an efficient (trending) regime, signed by direction; below ⇒ choppy. */
export const PFE_TREND = 50;

export function pfeZone(pfe: number): PfeZone {
  if (pfe >= PFE_TREND) return 'up';
  if (pfe <= -PFE_TREND) return 'down';
  return 'choppy';
}

export interface PfeStats {
  /** Latest smoothed, normalized PFE (signed, ±100). */
  pfe: number;
  /** Latest raw (pre-EMA) PFE, same normalization. */
  raw: number;
  /** Trend strength = |pfe| (direction-agnostic). */
  strength: number;
  /** Trending-up / trending-down / choppy zone. */
  zone: PfeZone;
  /** Number of bars supplied. */
  n: number;
}

export interface PfeRow extends PfeStats {
  symbol: string;
}

export type PfeSort = 'pfe' | 'strength' | 'symbol';

/**
 * Compute the latest PFE reading for one symbol. Needs more than `lookback`
 * closes so at least one raw value exists; returns null on bad params or too
 * little history.
 */
export function computePfe(
  closes: number[],
  lookback = 10,
  smoothing = 5,
  normalize: PfeNormalize = 'rebase',
  reference = 100,
): PfeStats | null {
  if (lookback < 1 || smoothing < 1) return null;
  const raw = pfeRawSeries(closes, lookback, normalize, reference);
  if (raw.length === 0) return null;
  const smooth = emaSeries(raw, smoothing);

  const pfe = smooth[smooth.length - 1];
  return {
    pfe,
    raw: raw[raw.length - 1],
    strength: Math.abs(pfe),
    zone: pfeZone(pfe),
    n: closes.length,
  };
}

/** Build a sorted per-symbol PFE board, skipping symbols with too little history. */
export function pfeBoard(
  series: { symbol: string; closes: number[] }[],
  sort: PfeSort = 'pfe',
  lookback = 10,
  smoothing = 5,
  normalize: PfeNormalize = 'rebase',
  reference = 100,
): PfeRow[] {
  const rows: PfeRow[] = [];
  for (const s of series) {
    const stats = computePfe(s.closes, lookback, smoothing, normalize, reference);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortPfe(rows, sort);
}

export function sortPfe(rows: PfeRow[], sort: PfeSort): PfeRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'strength':
      out.sort((a, b) => b.strength - a.strength);
      break;
    case 'pfe':
    default:
      out.sort((a, b) => b.pfe - a.pfe);
      break;
  }
  return out;
}
