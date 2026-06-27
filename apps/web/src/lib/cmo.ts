/**
 * Chande Momentum Oscillator (Tushar Chande).
 *
 * The net of up- vs down-moves over their total, on a ±100 scale:
 *
 *   ΣUp   = sum of positive close-to-close changes over the last N bars
 *   ΣDown = sum of |negative changes| over the last N bars
 *   CMO   = (ΣUp − ΣDown) / (ΣUp + ΣDown) · 100
 *
 * +100 is pure up-momentum, −100 pure down; above +50 is overbought, below −50
 * oversold. Unlike RSI (which smooths the averages), CMO uses the raw sums, so
 * it swings harder — a less-smoothed momentum gauge, distinct from the
 * RSI / Stochastic / CCI family.
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */

export const CMO_OVERBOUGHT = 50;
export const CMO_OVERSOLD = -50;

export type CmoZone = 'overbought' | 'oversold' | 'neutral';

export interface CmoRow {
  symbol: string;
  cmo: number;
  zone: CmoZone;
  n: number;
}

export type CmoSort = 'cmo' | 'symbol';

/**
 * Compute the latest CMO for one symbol over the last `period` close-to-close
 * changes. A flat window (no movement) maps to 0; returns null with too little
 * history (needs more than `period` closes).
 */
export function computeCmo(closes: number[], period = 14): number | null {
  if (period < 1 || closes.length < period + 1) return null;
  const w = closes.slice(-(period + 1)); // period changes need period + 1 closes
  let up = 0;
  let down = 0;
  for (let i = 1; i < w.length; i++) {
    const diff = w[i] - w[i - 1];
    if (diff > 0) up += diff;
    else down += -diff;
  }
  const total = up + down;
  if (total === 0) return 0;
  return ((up - down) / total) * 100;
}

/** Classify a CMO reading into a zone. */
export function cmoZone(value: number): CmoZone {
  if (value >= CMO_OVERBOUGHT) return 'overbought';
  if (value <= CMO_OVERSOLD) return 'oversold';
  return 'neutral';
}

/** Build a sorted per-symbol CMO board, skipping symbols with too little history. */
export function cmoBoard(
  series: { symbol: string; closes: number[] }[],
  sort: CmoSort = 'cmo',
  period = 14,
): CmoRow[] {
  const rows: CmoRow[] = [];
  for (const s of series) {
    const cmo = computeCmo(s.closes, period);
    if (cmo !== null) rows.push({ symbol: s.symbol, cmo, zone: cmoZone(cmo), n: s.closes.length });
  }
  return sortCmo(rows, sort);
}

export function sortCmo(rows: CmoRow[], sort: CmoSort): CmoRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'cmo':
    default:
      out.sort((a, b) => b.cmo - a.cmo);
      break;
  }
  return out;
}
