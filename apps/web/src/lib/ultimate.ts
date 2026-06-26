/**
 * Ultimate Oscillator (Larry Williams).
 *
 * Blends three timeframes of buying pressure relative to the true range, so a
 * single false divergence on one timeframe doesn't dominate:
 *
 *   BP_i = close[i] − min(low[i], close[i-1])              // buying pressure
 *   TR_i = max(high[i], close[i-1]) − min(low[i], close[i-1])  // true range
 *   Avg_p = Σ BP over last p bars / Σ TR over last p bars  // ratio of sums
 *   UO   = 100 · (4·Avg_p1 + 2·Avg_p2 + Avg_p3) / 7        // 4:2:1 weighting
 *
 * 0–100; above 70 is overbought, below 30 oversold. BP and TR need a prior bar,
 * so they start at index 1 (bar 0 is never summed) — needs `p3 + 1` bars.
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 * (The BP/TR definitions and weighting were adversarially verified.)
 */

/** Minimal OHLC bar (no open needed). */
export interface UoBar {
  high: number;
  low: number;
  close: number;
}

export const UO_OVERBOUGHT = 70;
export const UO_OVERSOLD = 30;

export type UoZone = 'overbought' | 'oversold' | 'neutral';

export interface UoRow {
  symbol: string;
  uo: number;
  zone: UoZone;
  n: number;
}

export type UoSort = 'uo' | 'symbol';

/**
 * Compute the latest Ultimate Oscillator for one symbol. Needs more than the
 * longest period in bars (`max(p1,p2,p3) + 1`); returns null otherwise. A flat
 * window (zero true range) contributes 0 rather than dividing by zero.
 */
export function computeUo(bars: UoBar[], p1 = 7, p2 = 14, p3 = 28): number | null {
  const n = bars.length;
  const maxP = Math.max(p1, p2, p3);
  if (p1 < 1 || p2 < 1 || p3 < 1 || n < maxP + 1) return null;

  // BP / TR per bar, starting at index 1 (bar 0 has no predecessor).
  const bp: number[] = [];
  const tr: number[] = [];
  for (let i = 1; i < n; i++) {
    const prevClose = bars[i - 1].close;
    const trueLow = Math.min(bars[i].low, prevClose);
    bp.push(bars[i].close - trueLow);
    tr.push(Math.max(bars[i].high, prevClose) - trueLow);
  }

  const avg = (p: number): number => {
    let sumBp = 0;
    let sumTr = 0;
    for (let k = bp.length - p; k < bp.length; k++) {
      sumBp += bp[k];
      sumTr += tr[k];
    }
    return sumTr === 0 ? 0 : sumBp / sumTr;
  };

  return (100 * (4 * avg(p1) + 2 * avg(p2) + avg(p3))) / 7;
}

/** Classify a UO reading into a zone. */
export function uoZone(uo: number): UoZone {
  if (uo >= UO_OVERBOUGHT) return 'overbought';
  if (uo <= UO_OVERSOLD) return 'oversold';
  return 'neutral';
}

/** Build a sorted per-symbol Ultimate Oscillator board, skipping symbols with too little history. */
export function uoBoard(
  series: { symbol: string; bars: UoBar[] }[],
  sort: UoSort = 'uo',
  p1 = 7,
  p2 = 14,
  p3 = 28,
): UoRow[] {
  const rows: UoRow[] = [];
  for (const s of series) {
    const uo = computeUo(s.bars, p1, p2, p3);
    if (uo !== null) rows.push({ symbol: s.symbol, uo, zone: uoZone(uo), n: s.bars.length });
  }
  return sortUo(rows, sort);
}

export function sortUo(rows: UoRow[], sort: UoSort): UoRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'uo':
    default:
      out.sort((a, b) => b.uo - a.uo);
      break;
  }
  return out;
}
