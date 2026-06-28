/**
 * Hull Moving Average (HMA) slope/trend screener helpers.
 *
 * Alan Hull's HMA is a low-lag moving average built from three weighted MAs:
 *
 *   half = floor(n/2);  sq = round(√n)
 *   raw  = 2·WMA(close, half) − WMA(close, n)
 *   HMA  = WMA(raw, sq)
 *
 * where WMA is the linearly-weighted MA (weights 1..p, most-recent weighted p,
 * divided by p(p+1)/2). The double-weighted half-length term minus the full
 * term removes most of the lag; the final √n smoothing tames the overshoot.
 *
 * The board screens by the HMA's slope. The raw per-bar change HMA[i]−HMA[i−1]
 * is in price units, so — like a raw price — it is NOT comparable across symbols
 * of different price scale; sorting on it would just rank by how expensive the
 * coin is. Instead the board reports a scale-invariant percent slope,
 *
 *   slopePct = 100 · (HMA[last] − HMA[prev]) / HMA[prev]
 *
 * (percent change of the HMA), and takes the rising/falling direction from its
 * sign. The HMA value itself is shown per-row but not used as a cross-symbol key.
 *
 * The √n smoothing length uses round() (TradingView ta.hma convention); some
 * code lineages (pandas-ta) floor it instead — they differ only when the
 * fractional part of √n ≥ 0.5 (e.g. n = 32 → 6 vs 5). Pure and synchronous so
 * the nested WMAs can be unit-tested against hand-computed values.
 */

export type HmaDir = 'up' | 'down' | 'flat';

/** Direction dead-band: treat |slopePct| below this as flat (numerical-zero guard). */
const EPS = 1e-9;

export interface HmaStats {
  /** Latest Hull Moving Average value (price units). */
  hma: number;
  /** Scale-invariant percent slope: 100·(HMA[last] − HMA[prev]) / HMA[prev]. */
  slopePct: number;
  /** Trend direction from the slope sign. */
  dir: HmaDir;
  /** Lookback period used. */
  period: number;
  /** Number of closes supplied. */
  n: number;
}

export interface HmaRow extends HmaStats {
  symbol: string;
}

export type HmaSort = 'slope' | 'symbol';

/**
 * Linearly-weighted moving average — weights 1..period with the most-recent
 * value weighted `period`, divided by the triangular number period(period+1)/2.
 * Returns a full-length array, NaN before index period−1.
 */
export function wma(values: number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  if (period < 1 || n < period) return out;
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < period; k++) sum += (period - k) * values[i - k];
    out[i] = sum / denom;
  }
  return out;
}

/**
 * Compute the latest Hull Moving Average and its percent slope for one symbol.
 * Needs at least `period + round(√period)` closes (so the HMA has ≥ 2 defined
 * values for the slope); returns null on bad params or too little history.
 */
export function computeHma(closes: number[], period = 20): HmaStats | null {
  if (period < 2) return null;
  const n = closes.length;
  const half = Math.floor(period / 2);
  const sq = Math.round(Math.sqrt(period));
  if (n < period + sq) return null;

  const wmaHalf = wma(closes, half);
  const wmaFull = wma(closes, period);
  const rawSub: number[] = [];
  for (let i = period - 1; i < n; i++) rawSub.push(2 * wmaHalf[i] - wmaFull[i]);

  const hmaArr = wma(rawSub, sq);
  const L = rawSub.length;
  const hma = hmaArr[L - 1];
  const prev = hmaArr[L - 2];
  if (Number.isNaN(hma) || Number.isNaN(prev)) return null;

  const slopePct = prev !== 0 ? (100 * (hma - prev)) / prev : 0;
  const dir: HmaDir = slopePct > EPS ? 'up' : slopePct < -EPS ? 'down' : 'flat';
  return { hma, slopePct, dir, period, n };
}

/** Build a sorted per-symbol Hull MA board, skipping symbols with too little history. */
export function hmaBoard(
  series: { symbol: string; closes: number[] }[],
  sort: HmaSort = 'slope',
  period = 20,
): HmaRow[] {
  const rows: HmaRow[] = [];
  for (const s of series) {
    const stats = computeHma(s.closes, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortHma(rows, sort);
}

export function sortHma(rows: HmaRow[], sort: HmaSort): HmaRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'slope':
    default:
      // Strongest up-trends (most positive percent slope) first, deepest down last.
      out.sort((a, b) => b.slopePct - a.slopePct);
      break;
  }
  return out;
}
