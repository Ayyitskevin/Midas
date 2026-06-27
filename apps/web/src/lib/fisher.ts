/**
 * Ehlers Fisher Transform.
 *
 * Normalizes the median price into its recent range, then applies the Fisher
 * transform so the (roughly Gaussian) result has sharp, distinct turning points:
 *
 *   med   = (high + low) / 2
 *   raw   = (med − minLow) / (maxHigh − minLow)        // 0..1 over the last N medians
 *   value = 0.66·(raw − 0.5) + 0.67·value_prev         // recursive, centered
 *   value = clamp(value, −0.999, 0.999)                // keep the log finite
 *   fish  = 0.5·ln((1 + value) / (1 − value)) + 0.5·fish_prev
 *
 * The trigger line is simply the prior bar's Fisher value, so a Fisher-vs-trigger
 * cross is a turn. Sharper than the smooth oscillators — built to call reversals.
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 * (The recursive formula was adversarially verified.)
 */

/** Minimal bar (Fisher uses the median (high + low) / 2). */
export interface FisherBar {
  high: number;
  low: number;
}

export type FisherCross = 'bull' | 'bear' | 'none';

export interface FisherStats {
  /** Latest Fisher value. */
  fisher: number;
  /** Trigger line = the prior bar's Fisher value. */
  trigger: number;
  /** Fresh Fisher × trigger cross on the latest bar. */
  cross: FisherCross;
  /** Number of bars supplied. */
  n: number;
}

export interface FisherRow extends FisherStats {
  symbol: string;
}

export type FisherSort = 'fisher' | 'symbol';

const clamp = (v: number) => (v > 0.999 ? 0.999 : v < -0.999 ? -0.999 : v);

/**
 * Compute the latest Fisher Transform reading for one symbol. Needs at least
 * `period` bars (for one normalization window); returns null otherwise. The
 * trigger falls back to the Fisher value itself when only one reading exists,
 * and `cross` needs three readings.
 */
export function computeFisher(bars: FisherBar[], period = 9): FisherStats | null {
  const n = bars.length;
  if (period < 1 || n < period) return null;

  const med = bars.map((b) => (b.high + b.low) / 2);
  const series: number[] = [];
  let value = 0;
  let fish = 0;
  for (let i = period - 1; i < n; i++) {
    let maxH = -Infinity;
    let minL = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (med[j] > maxH) maxH = med[j];
      if (med[j] < minL) minL = med[j];
    }
    const range = maxH - minL;
    const raw = range === 0 ? 0 : (med[i] - minL) / range;
    value = clamp(0.66 * (raw - 0.5) + 0.67 * value);
    fish = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * fish;
    series.push(fish);
  }

  const last = series.length - 1;
  const fisher = series[last];
  const trigger = last >= 1 ? series[last - 1] : fisher;

  let cross: FisherCross = 'none';
  if (series.length >= 3) {
    const fPrev = series[last - 1];
    const fPrev2 = series[last - 2];
    if (fPrev <= fPrev2 && fisher > fPrev) cross = 'bull';
    else if (fPrev >= fPrev2 && fisher < fPrev) cross = 'bear';
  }

  return { fisher, trigger, cross, n };
}

/** Build a sorted per-symbol Fisher Transform board, skipping symbols with too little history. */
export function fisherBoard(
  series: { symbol: string; bars: FisherBar[] }[],
  sort: FisherSort = 'fisher',
  period = 9,
): FisherRow[] {
  const rows: FisherRow[] = [];
  for (const s of series) {
    const stats = computeFisher(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortFisher(rows, sort);
}

export function sortFisher(rows: FisherRow[], sort: FisherSort): FisherRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'fisher':
    default:
      out.sort((a, b) => b.fisher - a.fisher);
      break;
  }
  return out;
}
