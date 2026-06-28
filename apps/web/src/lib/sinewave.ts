/**
 * Ehlers Sine Wave Indicator screener helpers.
 *
 * John Ehlers' Sine Wave ("Rocket Science for Traders") reads the market's
 * position within its dominant cycle. The Hilbert-transform homodyne
 * discriminator (the same front-end as MAMA) estimates the cycle period; a
 * discrete correlation of the smoothed price against sine/cosine waves of that
 * period gives the dominant-cycle phase, from which two lines are drawn:
 *
 *   Sine     = sin(DCPhase)
 *   LeadSine = sin(DCPhase + 45°)
 *
 * Both are bounded to [−1, +1]. LeadSine crossing ABOVE Sine is a cyclic buy,
 * crossing below a sell; in a trend the cycle measurement degrades and the two
 * lines flatten and stop crossing (which itself flags a trending, non-cyclic
 * market). Price input is the median (H+L)/2.
 *
 * The DCPhase computation (all angles in degrees, per Ehlers' EasyLanguage):
 *   DCPeriod = floor(SmoothPeriod + 0.5)
 *   Real = Σ sin(360·c/DCPeriod)·Smooth[c],  Imag = Σ cos(360·c/DCPeriod)·Smooth[c]   (c = 0..DCPeriod−1, c bars ago)
 *   DCPhase = |Imag|>0.001 ? atan(Real/Imag) : 90·sign(Real)
 *   DCPhase += 90;  DCPhase += 360/SmoothPeriod;  if (Imag<0) DCPhase += 180;  if (DCPhase>315) DCPhase −= 360
 *
 * Because the sine/cosine sums vanish over a full integer cycle, the DC price
 * level cancels — the lines are scale- and offset-invariant, so they rank
 * cleanly across symbols. Needs ≥ 63 bars of warm-up (TA-Lib's HT_SINE
 * lookback). Validated against an independently-reproduced fixture; the front-end
 * matches the (TA-Lib-verified) mama.ts. Pure and synchronous.
 */
import { type RangeBar } from './range';

export type SinewaveBar = RangeBar;
export type SinewaveDir = 'bull' | 'bear';
export type SinewaveCross = 'toBull' | 'toBear' | 'none';

/** Warm-up before the cycle phase is meaningful (TA-Lib HT_SINE lookback). */
export const SINE_MIN_BARS = 63;

export interface SinewaveStats {
  /** Sine of the dominant-cycle phase, [−1, +1]. */
  sine: number;
  /** Sine of phase + 45° (the leading line), [−1, +1]. */
  leadSine: number;
  /** LeadSine ≥ Sine (cyclic up) or below (cyclic down). */
  dir: SinewaveDir;
  /** Crossover on the latest bar, if any. */
  cross: SinewaveCross;
  /** Dominant-cycle period estimate (smoothed). */
  smoothPeriod: number;
  /** Number of bars supplied. */
  n: number;
}

export interface SinewaveRow extends SinewaveStats {
  symbol: string;
}

export type SinewaveSort = 'lead' | 'symbol';

const atanDeg = (x: number) => (Math.atan(x) * 180) / Math.PI;
const sinDeg = (d: number) => Math.sin((d * Math.PI) / 180);
const cosDeg = (d: number) => Math.cos((d * Math.PI) / 180);

/**
 * Compute the latest Sine / LeadSine for one symbol. Needs at least
 * `SINE_MIN_BARS` bars so the adaptive cycle estimate has settled; returns null
 * on too little history.
 */
export function computeSinewave(bars: SinewaveBar[]): SinewaveStats | null {
  const n = bars.length;
  if (n < SINE_MIN_BARS) return null;

  const src = bars.map((b) => (b.high + b.low) / 2);
  const at = (a: number[], i: number) => (i >= 0 ? a[i] : 0); // na → 0

  const smooth = new Array<number>(n).fill(0);
  const detrender = new Array<number>(n).fill(0);
  const i1 = new Array<number>(n).fill(0);
  const q1 = new Array<number>(n).fill(0);
  const i2 = new Array<number>(n).fill(0);
  const q2 = new Array<number>(n).fill(0);
  const re = new Array<number>(n).fill(0);
  const im = new Array<number>(n).fill(0);
  const period = new Array<number>(n).fill(0);
  const smoothPeriod = new Array<number>(n).fill(0);
  const sine = new Array<number>(n).fill(0);
  const leadSine = new Array<number>(n).fill(0);

  for (let i = 0; i < n; i++) {
    smooth[i] = (4 * src[i] + 3 * at(src, i - 1) + 2 * at(src, i - 2) + at(src, i - 3)) / 10;
    if (i < 6) continue; // warm-up; leave Hilbert state and outputs at 0

    // Hilbert homodyne discriminator → dominant-cycle period (matches mama.ts).
    const adj = 0.075 * period[i - 1] + 0.54;
    detrender[i] =
      (0.0962 * smooth[i] + 0.5769 * at(smooth, i - 2) - 0.5769 * at(smooth, i - 4) - 0.0962 * at(smooth, i - 6)) * adj;
    q1[i] =
      (0.0962 * detrender[i] + 0.5769 * at(detrender, i - 2) - 0.5769 * at(detrender, i - 4) - 0.0962 * at(detrender, i - 6)) *
      adj;
    i1[i] = at(detrender, i - 3);
    const jI = (0.0962 * i1[i] + 0.5769 * at(i1, i - 2) - 0.5769 * at(i1, i - 4) - 0.0962 * at(i1, i - 6)) * adj;
    const jQ = (0.0962 * q1[i] + 0.5769 * at(q1, i - 2) - 0.5769 * at(q1, i - 4) - 0.0962 * at(q1, i - 6)) * adj;
    i2[i] = 0.2 * (i1[i] - jQ) + 0.8 * i2[i - 1];
    q2[i] = 0.2 * (q1[i] + jI) + 0.8 * q2[i - 1];
    re[i] = 0.2 * (i2[i] * i2[i - 1] + q2[i] * q2[i - 1]) + 0.8 * re[i - 1];
    im[i] = 0.2 * (i2[i] * q2[i - 1] - q2[i] * i2[i - 1]) + 0.8 * im[i - 1];
    let per = period[i - 1];
    if (im[i] !== 0 && re[i] !== 0) per = 360 / atanDeg(im[i] / re[i]);
    if (per > 1.5 * period[i - 1]) per = 1.5 * period[i - 1];
    if (per < 0.67 * period[i - 1]) per = 0.67 * period[i - 1];
    if (per < 6) per = 6;
    if (per > 50) per = 50;
    period[i] = 0.2 * per + 0.8 * period[i - 1];
    smoothPeriod[i] = 0.33 * period[i] + 0.67 * smoothPeriod[i - 1];

    // Dominant-cycle phase via a discrete correlation of the smoothed price.
    const dcPeriod = Math.floor(smoothPeriod[i] + 0.5);
    let realPart = 0;
    let imagPart = 0;
    for (let c = 0; c < dcPeriod; c++) {
      const ang = (360 * c) / dcPeriod;
      realPart += sinDeg(ang) * at(smooth, i - c);
      imagPart += cosDeg(ang) * at(smooth, i - c);
    }
    let dcPhase = Math.abs(imagPart) > 0.001 ? atanDeg(realPart / imagPart) : 90 * Math.sign(realPart);
    dcPhase += 90;
    dcPhase += 360 / smoothPeriod[i]; // compensate the 1-bar lag of the weighted MA
    if (imagPart < 0) dcPhase += 180;
    if (dcPhase > 315) dcPhase -= 360;

    sine[i] = sinDeg(dcPhase);
    leadSine[i] = sinDeg(dcPhase + 45);
  }

  const last = n - 1;
  const s = sine[last];
  const l = leadSine[last];
  const dir: SinewaveDir = l >= s ? 'bull' : 'bear';
  const prevDir: SinewaveDir = leadSine[last - 1] >= sine[last - 1] ? 'bull' : 'bear';
  const cross: SinewaveCross = dir === prevDir ? 'none' : dir === 'bull' ? 'toBull' : 'toBear';
  return { sine: s, leadSine: l, dir, cross, smoothPeriod: smoothPeriod[last], n };
}

/** Build a sorted per-symbol Sine Wave board, skipping symbols with too little history. */
export function sinewaveBoard(
  series: { symbol: string; bars: SinewaveBar[] }[],
  sort: SinewaveSort = 'lead',
): SinewaveRow[] {
  const rows: SinewaveRow[] = [];
  for (const s of series) {
    const stats = computeSinewave(s.bars);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortSinewave(rows, sort);
}

export function sortSinewave(rows: SinewaveRow[], sort: SinewaveSort): SinewaveRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'lead':
    default:
      // Highest LeadSine first (cycle leading toward / at an up-turn).
      out.sort((a, b) => b.leadSine - a.leadSine);
      break;
  }
  return out;
}
