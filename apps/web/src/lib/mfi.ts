/**
 * Money Flow Index (MFI) — the "volume-weighted RSI".
 *
 * For each bar, typical price TP = (high + low + close) / 3 and raw money flow
 * RMF = TP · volume. Over the last `period` bars, money flow is split by
 * whether TP rose or fell vs the prior bar:
 *
 *   MFI = 100 · ΣRMF(up) / (ΣRMF(up) + ΣRMF(down))
 *
 * Bounded 0..100; conventionally > 80 is overbought and < 20 is oversold. It
 * combines price and volume into one oscillator — distinct from RSI (price
 * only) and OBV (cumulative signed volume).
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */

/** Minimal OHLC + volume bar. */
export interface MfiBar {
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const MFI_OVERBOUGHT = 80;
export const MFI_OVERSOLD = 20;

export type MfiZone = 'overbought' | 'oversold' | 'neutral';

export interface MfiRow {
  symbol: string;
  mfi: number;
  zone: MfiZone;
  n: number;
}

export type MfiSort = 'mfi' | 'symbol';

const typical = (b: MfiBar) => (b.high + b.low + b.close) / 3;

/**
 * Compute the latest Money Flow Index for one symbol over the last `period`
 * bars. Returns null with too little history or no directional money flow.
 */
export function computeMfi(bars: MfiBar[], period = 14): number | null {
  if (period < 1 || bars.length < period + 1) return null;
  let pmf = 0;
  let nmf = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const tp = typical(bars[i]);
    const prevTp = typical(bars[i - 1]);
    const rmf = tp * bars[i].volume;
    if (tp > prevTp) pmf += rmf;
    else if (tp < prevTp) nmf += rmf;
  }
  const total = pmf + nmf;
  if (total <= 0) return null;
  return (100 * pmf) / total;
}

/** Classify an MFI reading into a zone. */
export function mfiZone(value: number): MfiZone {
  if (value >= MFI_OVERBOUGHT) return 'overbought';
  if (value <= MFI_OVERSOLD) return 'oversold';
  return 'neutral';
}

/** Build a sorted per-symbol MFI board, skipping symbols with too little history. */
export function mfiBoard(
  series: { symbol: string; bars: MfiBar[] }[],
  sort: MfiSort = 'mfi',
  period = 14,
): MfiRow[] {
  const rows: MfiRow[] = [];
  for (const s of series) {
    const value = computeMfi(s.bars, period);
    if (value !== null) rows.push({ symbol: s.symbol, mfi: value, zone: mfiZone(value), n: s.bars.length });
  }
  return sortMfi(rows, sort);
}

export function sortMfi(rows: MfiRow[], sort: MfiSort): MfiRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'mfi':
    default:
      // Most overbought first.
      out.sort((a, b) => b.mfi - a.mfi);
      break;
  }
  return out;
}
