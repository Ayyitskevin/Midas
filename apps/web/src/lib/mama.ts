/**
 * Ehlers MESA Adaptive Moving Average (MAMA / FAMA) screener helpers.
 *
 * John Ehlers' MAMA ("Rocket Science for Traders", TASC 2001) adapts its EMA
 * smoothing constant to the measured dominant cycle. A Hilbert-transform
 * quadrature (the detrender → I1/Q1 → jI/jQ chain) feeds a homodyne
 * discriminator that estimates the cycle period; the phase rate of change sets
 * the adaptive alpha, clamped to [SlowLimit, FastLimit]:
 *
 *   MAMA = alpha·price + (1−alpha)·MAMA[1]
 *   FAMA = 0.5·alpha·MAMA + (1 − 0.5·alpha)·FAMA[1]
 *
 * FAMA (the "following" average) adapts at half MAMA's rate, so MAMA leads in
 * trends and the two cross in consolidations: MAMA above FAMA = bullish, below =
 * bearish, crossovers are the trade signals. Price input is the median (H+L)/2.
 *
 * Implementation notes (the error-prone parts, all confirmed against Ehlers and
 * TA-Lib's ta_MAMA.c): the Hilbert FIR uses .0962/.5769 with a (.075·Period[1]+
 * .54) adaptive amplitude; the period comes from 360 / atanDeg(Im/Re) — a
 * SINGLE-arg arctangent in DEGREES (atan·180/π), not atan2, with no 0.5 factor;
 * clamp the period 1.5×/.67× then 6/50, then 0.2/0.8-smooth it; alpha =
 * FastLimit/ΔPhase floored at SlowLimit (ΔPhase ≥ 1 implicitly caps it at
 * FastLimit). Per Ehlers, MAMA = FAMA = price for the first 6 bars; the warm-up
 * washes out within ~40 bars, so the board requires ≥ 40 bars and the latest
 * value is independent of the seed. Defaults FastLimit 0.5 / SlowLimit 0.05.
 *
 * Pure and synchronous; the adaptive pipeline is validated against structural
 * invariants (MAMA leads / FAMA lags in trends, alpha bounded to the limits) and
 * the flat-series fixed point (MAMA = FAMA = price).
 */
import { type RangeBar } from './range';

export type MamaBar = RangeBar;
export type MamaDir = 'bull' | 'bear';
export type MamaCross = 'toBull' | 'toBear' | 'none';

/** Minimum bars before the adaptive warm-up has settled (TA-Lib lookback is 32). */
export const MAMA_MIN_BARS = 40;

export interface MamaStats {
  /** MESA Adaptive Moving Average (fast line). */
  mama: number;
  /** Following Adaptive Moving Average (slow line). */
  fama: number;
  /** MAMA ≥ FAMA (bullish) or below (bearish). */
  dir: MamaDir;
  /** Signed MAMA−FAMA gap as a % of price (scale-invariant). */
  gapPct: number;
  /** Crossover on the latest bar, if any. */
  cross: MamaCross;
  /** Latest adaptive alpha (in [SlowLimit, FastLimit]). */
  alpha: number;
  /** Number of bars supplied. */
  n: number;
}

export interface MamaRow extends MamaStats {
  symbol: string;
}

export type MamaSort = 'gap' | 'symbol';

const atanDeg = (x: number) => (Math.atan(x) * 180) / Math.PI;

/**
 * Compute the latest MAMA/FAMA for one symbol. Needs at least `MAMA_MIN_BARS`
 * bars so the adaptive warm-up has settled; returns null on bad params or too
 * little history.
 */
export function computeMama(bars: MamaBar[], fastLimit = 0.5, slowLimit = 0.05): MamaStats | null {
  if (!(fastLimit > 0) || !(slowLimit > 0) || fastLimit < slowLimit) return null;
  const n = bars.length;
  if (n < MAMA_MIN_BARS) return null;

  const price = bars.map((b) => (b.high + b.low) / 2);
  const at = (a: number[], idx: number) => (idx >= 0 ? a[idx] : 0); // na → 0

  const smooth = new Array<number>(n).fill(0);
  const detrender = new Array<number>(n).fill(0);
  const i1 = new Array<number>(n).fill(0);
  const q1 = new Array<number>(n).fill(0);
  const i2 = new Array<number>(n).fill(0);
  const q2 = new Array<number>(n).fill(0);
  const re = new Array<number>(n).fill(0);
  const im = new Array<number>(n).fill(0);
  const period = new Array<number>(n).fill(0);
  const phase = new Array<number>(n).fill(0);
  const mama = new Array<number>(n).fill(0);
  const fama = new Array<number>(n).fill(0);
  let alpha = fastLimit;

  for (let i = 0; i < n; i++) {
    smooth[i] = (4 * price[i] + 3 * at(price, i - 1) + 2 * at(price, i - 2) + at(price, i - 3)) / 10;
    if (i < 6) {
      // Ehlers warm-up: seed both averages to price; leave the Hilbert state at 0.
      mama[i] = price[i];
      fama[i] = price[i];
      continue;
    }

    const adj = 0.075 * period[i - 1] + 0.54;
    detrender[i] =
      (0.0962 * smooth[i] + 0.5769 * at(smooth, i - 2) - 0.5769 * at(smooth, i - 4) - 0.0962 * at(smooth, i - 6)) * adj;
    q1[i] =
      (0.0962 * detrender[i] + 0.5769 * at(detrender, i - 2) - 0.5769 * at(detrender, i - 4) - 0.0962 * at(detrender, i - 6)) *
      adj;
    i1[i] = at(detrender, i - 3);
    const jI =
      (0.0962 * i1[i] + 0.5769 * at(i1, i - 2) - 0.5769 * at(i1, i - 4) - 0.0962 * at(i1, i - 6)) * adj;
    const jQ =
      (0.0962 * q1[i] + 0.5769 * at(q1, i - 2) - 0.5769 * at(q1, i - 4) - 0.0962 * at(q1, i - 6)) * adj;

    // Phasor sum, then 0.2/0.8-smooth the in-phase and quadrature components.
    i2[i] = 0.2 * (i1[i] - jQ) + 0.8 * i2[i - 1];
    q2[i] = 0.2 * (q1[i] + jI) + 0.8 * q2[i - 1];

    // Homodyne discriminator → dominant-cycle period.
    re[i] = 0.2 * (i2[i] * i2[i - 1] + q2[i] * q2[i - 1]) + 0.8 * re[i - 1];
    im[i] = 0.2 * (i2[i] * q2[i - 1] - q2[i] * i2[i - 1]) + 0.8 * im[i - 1];
    let per = period[i - 1];
    if (im[i] !== 0 && re[i] !== 0) per = 360 / atanDeg(im[i] / re[i]);
    if (per > 1.5 * period[i - 1]) per = 1.5 * period[i - 1];
    if (per < 0.67 * period[i - 1]) per = 0.67 * period[i - 1];
    if (per < 6) per = 6;
    if (per > 50) per = 50;
    period[i] = 0.2 * per + 0.8 * period[i - 1];

    // Phase → adaptive alpha, clamped to [slowLimit, fastLimit].
    phase[i] = i1[i] !== 0 ? atanDeg(q1[i] / i1[i]) : phase[i - 1];
    let deltaPhase = phase[i - 1] - phase[i];
    if (deltaPhase < 1) deltaPhase = 1;
    alpha = fastLimit / deltaPhase;
    if (alpha < slowLimit) alpha = slowLimit;

    mama[i] = alpha * price[i] + (1 - alpha) * mama[i - 1];
    fama[i] = 0.5 * alpha * mama[i] + (1 - 0.5 * alpha) * fama[i - 1];
  }

  const last = n - 1;
  const mamaV = mama[last];
  const famaV = fama[last];
  const dir: MamaDir = mamaV >= famaV ? 'bull' : 'bear';
  const prevDir: MamaDir = mama[last - 1] >= fama[last - 1] ? 'bull' : 'bear';
  const cross: MamaCross = dir === prevDir ? 'none' : dir === 'bull' ? 'toBull' : 'toBear';
  const p = price[last];
  const gapPct = p > 0 ? ((mamaV - famaV) / p) * 100 : 0;
  return { mama: mamaV, fama: famaV, dir, gapPct, cross, alpha, n };
}

/** Build a sorted per-symbol MAMA/FAMA board, skipping symbols with too little history. */
export function mamaBoard(
  series: { symbol: string; bars: MamaBar[] }[],
  sort: MamaSort = 'gap',
  fastLimit = 0.5,
  slowLimit = 0.05,
): MamaRow[] {
  const rows: MamaRow[] = [];
  for (const s of series) {
    const stats = computeMama(s.bars, fastLimit, slowLimit);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortMama(rows, sort);
}

export function sortMama(rows: MamaRow[], sort: MamaSort): MamaRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'gap':
    default:
      // Strongest bullish separation (MAMA most above FAMA) first.
      out.sort((a, b) => b.gapPct - a.gapPct);
      break;
  }
  return out;
}
