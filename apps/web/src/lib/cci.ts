/**
 * Commodity Channel Index (CCI, Lambert).
 *
 * Measures how far the typical price has deviated from its average, scaled by
 * the mean absolute deviation:
 *
 *   TP   = (high + low + close) / 3
 *   CCI  = (TP − SMA(TP)) / (0.015 · meanDeviation)
 *
 * The 0.015 constant scales so most readings fall within ±100; > +100 is
 * overbought / strong up, < −100 is oversold / strong down. A mean-deviation
 * oscillator, distinct from RSI (gains/losses) and MFI (volume-weighted).
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */

/** Minimal OHLC bar. */
export interface CciBar {
  high: number;
  low: number;
  close: number;
}

export const CCI_OVERBOUGHT = 100;
export const CCI_OVERSOLD = -100;

export type CciZone = 'overbought' | 'oversold' | 'neutral';

export interface CciRow {
  symbol: string;
  cci: number;
  zone: CciZone;
  n: number;
}

export type CciSort = 'cci' | 'symbol';

const typical = (b: CciBar) => (b.high + b.low + b.close) / 3;

/**
 * Compute the latest CCI for one symbol over the last `period` bars. Returns
 * null with too little history or a zero mean deviation (a flat window).
 */
export function computeCci(bars: CciBar[], period = 20): number | null {
  if (period < 1 || bars.length < period) return null;
  const w = bars.slice(-period);
  const tps = w.map(typical);
  let sum = 0;
  for (const tp of tps) sum += tp;
  const smaTp = sum / period;
  let dev = 0;
  for (const tp of tps) dev += Math.abs(tp - smaTp);
  const md = dev / period;
  if (md === 0) return null;
  return (tps[tps.length - 1] - smaTp) / (0.015 * md);
}

/** Classify a CCI reading into a zone. */
export function cciZone(value: number): CciZone {
  if (value >= CCI_OVERBOUGHT) return 'overbought';
  if (value <= CCI_OVERSOLD) return 'oversold';
  return 'neutral';
}

/** Build a sorted per-symbol CCI board, skipping symbols with too little history. */
export function cciBoard(
  series: { symbol: string; bars: CciBar[] }[],
  sort: CciSort = 'cci',
  period = 20,
): CciRow[] {
  const rows: CciRow[] = [];
  for (const s of series) {
    const value = computeCci(s.bars, period);
    if (value !== null) rows.push({ symbol: s.symbol, cci: value, zone: cciZone(value), n: s.bars.length });
  }
  return sortCci(rows, sort);
}

export function sortCci(rows: CciRow[], sort: CciSort): CciRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'cci':
    default:
      out.sort((a, b) => b.cci - a.cci);
      break;
  }
  return out;
}
