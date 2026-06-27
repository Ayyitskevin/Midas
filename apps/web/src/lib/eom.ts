/**
 * Ease of Movement (Richard Arms).
 *
 * How readily price moves relative to the volume required to move it:
 *
 *   midpoint = (high + low) / 2
 *   DM       = midpoint − priorMidpoint        (distance moved)
 *   EMV_bar  = DM · (high − low) / volume       (move × range ÷ effort)
 *   EOM      = SMA(EMV_bar, N)
 *
 * Positive means price rose easily (a large up-move on light volume); negative
 * means it fell easily. Raw EMV carries arbitrary price²/volume units that
 * aren't comparable across symbols, so the board normalizes the smoothed value
 * to a dimensionless index — × avgVolume / avgMidpoint² × 100 — comparable
 * across names. A volume/price-efficiency oscillator around zero.
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */

/** Bar with high/low/volume (Ease of Movement uses the midpoint and range). */
export interface EomBar {
  high: number;
  low: number;
  volume: number;
}

export type EomSide = 'up' | 'down';

export interface EomStats {
  /** Normalized, dimensionless Ease of Movement (× 100). */
  eom: number;
  /** Ease direction (sign). */
  side: EomSide;
  /** Number of bars supplied. */
  n: number;
}

export interface EomRow extends EomStats {
  symbol: string;
}

export type EomSort = 'eom' | 'symbol';

/**
 * Compute the latest Ease of Movement for one symbol. Needs `period + 1` bars
 * (the per-bar EMV needs a prior midpoint); returns null otherwise.
 */
export function computeEom(bars: EomBar[], period = 14): EomStats | null {
  const n = bars.length;
  if (period < 1 || n < period + 1) return null;

  const mid = (b: EomBar) => (b.high + b.low) / 2;

  // Per-bar EMV from the second bar (needs a prior midpoint).
  const emv: number[] = [];
  for (let i = 1; i < n; i++) {
    const dm = mid(bars[i]) - mid(bars[i - 1]);
    const range = bars[i].high - bars[i].low;
    emv.push(range === 0 || bars[i].volume === 0 ? 0 : (dm * range) / bars[i].volume);
  }

  // Smooth the last `period` per-bar values, and gather the matching bars for
  // the dimensionless normalization.
  let sumEmv = 0;
  let sumVol = 0;
  let sumMid = 0;
  for (let k = emv.length - period; k < emv.length; k++) sumEmv += emv[k];
  for (let i = n - period; i < n; i++) {
    sumVol += bars[i].volume;
    sumMid += mid(bars[i]);
  }
  const raw = sumEmv / period;
  const avgVol = sumVol / period;
  const avgMid = sumMid / period;

  const eom = avgMid > 0 ? (raw * avgVol) / (avgMid * avgMid) * 100 : 0;
  return { eom, side: eom >= 0 ? 'up' : 'down', n };
}

/** Build a sorted per-symbol Ease of Movement board, skipping symbols with too little history. */
export function eomBoard(
  series: { symbol: string; bars: EomBar[] }[],
  sort: EomSort = 'eom',
  period = 14,
): EomRow[] {
  const rows: EomRow[] = [];
  for (const s of series) {
    const stats = computeEom(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortEom(rows, sort);
}

export function sortEom(rows: EomRow[], sort: EomSort): EomRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'eom':
    default:
      out.sort((a, b) => b.eom - a.eom);
      break;
  }
  return out;
}
