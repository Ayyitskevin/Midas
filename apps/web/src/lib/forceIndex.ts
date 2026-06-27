/**
 * Force Index (Alexander Elder).
 *
 * Ties the size of each price move to the volume behind it, then smooths:
 *
 *   raw  = (close − priorClose) · volume     (price change × volume)
 *   FI   = EMA(raw, N)
 *
 * Positive means bulls drove price up on volume; negative means bears. The raw
 * units (price × volume) aren't comparable across symbols, so the board also
 * reports a normalized reading — FI ÷ (close × average volume) × 100 — which is
 * roughly the volume-weighted % move, comparable across names. A zero-line
 * volume oscillator; reuses the shared EMA.
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */
import { emaSeries } from './indicators';

/** Bar with close + volume (Force Index needs both). */
export interface ForceBar {
  close: number;
  volume: number;
}

export type ForceSide = 'bulls' | 'bears';

export interface ForceStats {
  /** Smoothed Force Index (raw price×volume units). */
  force: number;
  /** Normalized FI ÷ (close × avg volume) × 100 — comparable across symbols. */
  forcePct: number;
  /** Sign of the Force Index. */
  side: ForceSide;
  /** Rising vs the prior bar. */
  rising: boolean;
  /** Number of bars supplied. */
  n: number;
}

export interface ForceRow extends ForceStats {
  symbol: string;
}

export type ForceSort = 'force' | 'symbol';

/**
 * Compute the latest Force Index reading for one symbol. Needs `period + 1`
 * bars (raw force starts at the second bar, with EMA warm-up); returns null
 * otherwise.
 */
export function computeForce(bars: ForceBar[], period = 13): ForceStats | null {
  const n = bars.length;
  if (period < 1 || n < period + 1) return null;

  // Raw force per bar, from the second bar (needs a prior close).
  const raw: number[] = [];
  for (let i = 1; i < n; i++) raw.push((bars[i].close - bars[i - 1].close) * bars[i].volume);

  const ema = emaSeries(raw, period);
  const force = ema[ema.length - 1];
  const prevForce = ema.length >= 2 ? ema[ema.length - 2] : force;

  // Average volume over the last `period` bars, for normalization.
  let vol = 0;
  for (let i = n - period; i < n; i++) vol += bars[i].volume;
  const avgVol = vol / period;
  const denom = bars[n - 1].close * avgVol;

  return {
    force,
    forcePct: denom !== 0 ? (force / denom) * 100 : 0,
    side: force >= 0 ? 'bulls' : 'bears',
    rising: force > prevForce,
    n,
  };
}

/** Build a sorted per-symbol Force Index board, skipping symbols with too little history. */
export function forceBoard(
  series: { symbol: string; bars: ForceBar[] }[],
  sort: ForceSort = 'force',
  period = 13,
): ForceRow[] {
  const rows: ForceRow[] = [];
  for (const s of series) {
    const stats = computeForce(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortForce(rows, sort);
}

export function sortForce(rows: ForceRow[], sort: ForceSort): ForceRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'force':
    default:
      out.sort((a, b) => b.forcePct - a.forcePct);
      break;
  }
  return out;
}
