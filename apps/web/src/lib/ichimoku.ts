/**
 * Ichimoku Kinkō Hyō (cloud) — per-symbol screener.
 *
 * The five-line system, reduced to the latest-bar signals a board needs:
 *
 *   Tenkan(t) = (highestHigh + lowestLow over the last t bars) / 2
 *   Kijun(k)  = same midpoint over the last k bars
 *   Senkou A  = (Tenkan + Kijun) / 2,  Senkou B = midpoint over senkouB bars
 *
 * Both spans are plotted `displacement` bars FORWARD (displacement = kijun), so
 * the cloud (kumo) sitting under the *current* price was computed at the
 * supplier bar j = last − kijun. We read both spans there:
 *
 *   spanA_now = (Tenkan(j) + Kijun(j)) / 2,  spanB_now = midpoint(senkouB)(j)
 *
 * From that we report price-vs-cloud (above / below / inside), the cloud colour
 * (Senkou A vs B), and a fresh Tenkan×Kijun cross. A full current-cloud reading
 * needs `kijun + max(tenkan, kijun, senkouB)` bars (78 for the standard
 * 9 / 26 / 52); fewer returns null.
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 * (Formulas and the hand-computed test fixtures were adversarially verified.)
 */

/** Minimal OHLC bar (no open needed). */
export interface IchiBar {
  high: number;
  low: number;
  close: number;
}

export type IchiCloud = 'above' | 'below' | 'inside';
export type IchiColor = 'bull' | 'bear' | 'flat';
export type IchiCross = 'bull' | 'bear' | 'none';

export interface IchiStats {
  /** Tenkan-sen (conversion line) at the latest bar. */
  tenkan: number;
  /** Kijun-sen (base line) at the latest bar. */
  kijun: number;
  /** Senkou Span A of the cloud under the current price. */
  spanA: number;
  /** Senkou Span B of the cloud under the current price. */
  spanB: number;
  /** Close vs the current cloud. */
  cloud: IchiCloud;
  /** Cloud colour (Senkou A vs B). */
  color: IchiColor;
  /** Fresh Tenkan × Kijun cross on the latest bar. */
  tkCross: IchiCross;
  /** Signed % distance of the close from the cloud (above +, below −, inside 0). */
  dist: number;
  /** Number of bars supplied. */
  n: number;
}

export interface IchiRow extends IchiStats {
  symbol: string;
}

export type IchiSort = 'cloud' | 'dist' | 'symbol';

/** (highestHigh + lowestLow) / 2 over the `period` bars ending at `end`; null on underflow. */
function midpoint(bars: IchiBar[], end: number, period: number): number | null {
  const start = end - period + 1;
  if (start < 0 || end >= bars.length || period < 1) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = start; i <= end; i++) {
    if (bars[i].high > hi) hi = bars[i].high;
    if (bars[i].low < lo) lo = bars[i].low;
  }
  return (hi + lo) / 2;
}

/**
 * Compute the latest Ichimoku reading for one symbol. Needs
 * `kijun + max(tenkan, kijun, senkouB)` bars for a current-cloud reading;
 * returns null otherwise.
 */
export function computeIchimoku(bars: IchiBar[], tenkan = 9, kijun = 26, senkouB = 52): IchiStats | null {
  const n = bars.length;
  if (tenkan < 1 || kijun < 1 || senkouB < 1) return null;
  if (n < kijun + Math.max(tenkan, kijun, senkouB)) return null;

  const last = n - 1;
  const j = last - kijun; // cloud supplier bar (displacement = kijun)

  const tNow = midpoint(bars, last, tenkan);
  const kNow = midpoint(bars, last, kijun);
  const spanATenkan = midpoint(bars, j, tenkan);
  const spanAKijun = midpoint(bars, j, kijun);
  const spanBVal = midpoint(bars, j, senkouB);
  if (tNow === null || kNow === null || spanATenkan === null || spanAKijun === null || spanBVal === null) {
    return null;
  }

  const spanA = (spanATenkan + spanAKijun) / 2;
  const spanB = spanBVal;

  // Fresh Tenkan × Kijun cross, gated by the prior bar.
  let tkCross: IchiCross = 'none';
  const tPrev = midpoint(bars, last - 1, tenkan);
  const kPrev = midpoint(bars, last - 1, kijun);
  if (tPrev !== null && kPrev !== null) {
    if (tPrev <= kPrev && tNow > kNow) tkCross = 'bull';
    else if (tPrev >= kPrev && tNow < kNow) tkCross = 'bear';
  }

  const lo = Math.min(spanA, spanB);
  const hi = Math.max(spanA, spanB);
  const close = bars[last].close;
  const cloud: IchiCloud = close > hi ? 'above' : close < lo ? 'below' : 'inside';
  const color: IchiColor = spanA > spanB ? 'bull' : spanA < spanB ? 'bear' : 'flat';

  let dist = 0;
  if (close !== 0) {
    if (cloud === 'above') dist = ((close - hi) / close) * 100;
    else if (cloud === 'below') dist = ((close - lo) / close) * 100;
  }

  return { tenkan: tNow, kijun: kNow, spanA, spanB, cloud, color, tkCross, dist, n };
}

const cloudScore = (c: IchiCloud) => (c === 'above' ? 2 : c === 'inside' ? 1 : 0);

/** Build a sorted per-symbol Ichimoku board, skipping symbols with too little history. */
export function ichimokuBoard(
  series: { symbol: string; bars: IchiBar[] }[],
  sort: IchiSort = 'cloud',
  tenkan = 9,
  kijun = 26,
  senkouB = 52,
): IchiRow[] {
  const rows: IchiRow[] = [];
  for (const s of series) {
    const stats = computeIchimoku(s.bars, tenkan, kijun, senkouB);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortIchi(rows, sort);
}

export function sortIchi(rows: IchiRow[], sort: IchiSort): IchiRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'dist':
      out.sort((a, b) => b.dist - a.dist);
      break;
    case 'cloud':
    default:
      // Most bullish stance first, then by distance from the cloud.
      out.sort((a, b) => cloudScore(b.cloud) - cloudScore(a.cloud) || b.dist - a.dist);
      break;
  }
  return out;
}
