/**
 * Projection Oscillator (Mel Widner) screener helpers.
 *
 * Widner's Projection Bands (Stocks & Commodities, 1995) tilt a Stochastic's
 * raw high/low extremes by the regression slope. Over a lookback of `period`
 * bars, fit two independent least-squares lines — one to the highs, one to the
 * lows — and project every bar forward to the current bar along its own slope:
 *
 *   slopeH = least-squares slope of high over N bars
 *   slopeL = least-squares slope of low  over N bars
 *   PBU = max over k=0..N−1 of ( high[i−k] + slopeH·k )   (upper projection band)
 *   PBL = min over k=0..N−1 of ( low[i−k]  + slopeL·k )   (lower projection band)
 *
 * The oscillator is the close's position within that band, like a slope-adjusted
 * Stochastic %K:
 *
 *   PO = 100 · (close − PBL) / (PBU − PBL)     (0..100; 50 = mid-band)
 *
 * with a short EMA signal/trigger line. Bounded 0..100 by construction, so it is
 * scale-invariant and directly comparable across symbols. Above 80 is
 * overbought, below 20 oversold (the repo's Stochastic thresholds). Reuses the
 * seeded `emaSeries` for the signal. Pure and synchronous for exact unit tests.
 *
 * Note: the upper band uses the HIGH series with the HIGH's own slope and the
 * lower band the LOW series with the LOW's own slope (the canonical FM Labs /
 * Wealth-Lab form). Both projections add +slope·k — do not use the MultiCharts
 * recursive two-term shorthand, which negates the low term.
 */
import { type RangeBar } from './range';
import { emaSeries } from './indicators';

export type ProjBar = RangeBar;
export type ProjZone = 'overbought' | 'oversold' | 'neutral';

/** Overbought / oversold thresholds (shared with the Stochastic board). */
export const PROJ_OB = 80;
export const PROJ_OS = 20;

export interface ProjStats {
  /** Projection Oscillator, 0..100. */
  po: number;
  /** EMA signal/trigger line of the oscillator. */
  signal: number;
  /** PO − signal (positive = above its trigger). */
  hist: number;
  /** Band zone from the latest oscillator value. */
  zone: ProjZone;
  /** Number of bars supplied. */
  n: number;
}

export interface ProjRow extends ProjStats {
  symbol: string;
}

export type ProjSort = 'po' | 'hist' | 'symbol';

/** Least-squares slope of values[end−period+1..end] with x = 0..period−1 (oldest→newest). */
function regSlope(values: number[], end: number, period: number): number {
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (let k = 0; k < period; k++) {
    const y = values[end - period + 1 + k];
    sx += k;
    sy += y;
    sxy += k * y;
    sxx += k * k;
  }
  const denom = period * sxx - sx * sx;
  return denom !== 0 ? (period * sxy - sx * sy) / denom : 0;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Projection Oscillator value at bar `end` over the trailing `period` window. */
function projAt(highs: number[], lows: number[], closes: number[], end: number, period: number): number {
  const slopeH = regSlope(highs, end, period);
  const slopeL = regSlope(lows, end, period);
  let pbu = -Infinity;
  let pbl = Infinity;
  for (let k = 0; k < period; k++) {
    const up = highs[end - k] + slopeH * k;
    const dn = lows[end - k] + slopeL * k;
    if (up > pbu) pbu = up;
    if (dn < pbl) pbl = dn;
  }
  if (pbu <= pbl) return 50; // degenerate / flat window
  return clamp((100 * (closes[end] - pbl)) / (pbu - pbl), 0, 100);
}

/**
 * Compute the latest Projection Oscillator for one symbol. Needs at least
 * `period + 1` bars (so the oscillator has ≥ 2 points for the signal/histogram);
 * returns null on bad params or too little history.
 */
export function computeProjection(
  bars: ProjBar[],
  period = 14,
  signalPeriod = 5,
): ProjStats | null {
  if (period < 2 || signalPeriod < 1) return null;
  const n = bars.length;
  if (n < period + 1) return null;

  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const closes = bars.map((b) => b.close);

  const po: number[] = [];
  for (let i = period - 1; i < n; i++) po.push(projAt(highs, lows, closes, i, period));

  const sig = emaSeries(po, signalPeriod);
  const L = po.length;
  const poLast = po[L - 1];
  const signal = sig[L - 1];
  const zone: ProjZone = poLast > PROJ_OB ? 'overbought' : poLast < PROJ_OS ? 'oversold' : 'neutral';
  return { po: poLast, signal, hist: poLast - signal, zone, n };
}

/** Build a sorted per-symbol Projection Oscillator board, skipping thin history. */
export function projectionBoard(
  series: { symbol: string; bars: ProjBar[] }[],
  sort: ProjSort = 'po',
  period = 14,
  signalPeriod = 5,
): ProjRow[] {
  const rows: ProjRow[] = [];
  for (const s of series) {
    const stats = computeProjection(s.bars, period, signalPeriod);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortProjection(rows, sort);
}

export function sortProjection(rows: ProjRow[], sort: ProjSort): ProjRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'hist':
      // Strongest above-signal momentum first.
      out.sort((a, b) => b.hist - a.hist);
      break;
    case 'po':
    default:
      // Most overbought (near 100) first, most oversold (near 0) last.
      out.sort((a, b) => b.po - a.po);
      break;
  }
  return out;
}
