/**
 * Kaufman Adaptive Moving Average (KAMA) trend screener helpers.
 *
 * Perry Kaufman's KAMA is an EMA whose smoothing constant adapts to the
 * Efficiency Ratio — net directional travel ÷ total path — so it tracks price
 * quickly in clean trends and flattens in chop. Per bar i (for i ≥ n):
 *
 *   ER = |close[i] − close[i−n]| / Σ|close[j] − close[j−1]|   (0..1; 0 when flat)
 *   SC = ( ER·(fastSC − slowSC) + slowSC )²                   (the whole bracket squared)
 *   KAMA[i] = KAMA[i−1] + SC·(close[i] − KAMA[i−1])
 *
 * with fastSC = 2/(fast+1), slowSC = 2/(slow+1), seeded KAMA[n−1] = close[n−1].
 * Defaults n = 10, fast = 2, slow = 30. The board reads the KAMA slope for
 * trend direction, the Efficiency Ratio for trend quality, and close-vs-KAMA
 * for the side.
 */

export type KamaDir = 'up' | 'down' | 'flat';

export interface KamaStats {
  /** Latest KAMA value. */
  kama: number;
  /** KAMA slope on the latest bar (kama[last] − kama[last-1]). */
  slope: number;
  /** Latest Efficiency Ratio (0..1; 1 = clean trend, ~0 = chop). */
  er: number;
  /** Close's distance from KAMA, as a signed % of price. */
  distPct: number;
  /** KAMA slope as a % of price, for ranking across symbols. */
  slopePct: number;
  /** Slope direction. */
  dir: KamaDir;
  /** Which side of KAMA price sits on. */
  side: 'above' | 'below';
  /** Number of closes supplied. */
  n: number;
}

export interface KamaRow extends KamaStats {
  symbol: string;
}

export type KamaSort = 'dist' | 'er' | 'slope' | 'symbol';

/**
 * Compute the latest KAMA trend stats for one symbol. Needs at least `n + 2`
 * closes so both the latest KAMA and a prior recursion value (for the slope)
 * exist; returns null on bad params or too little history.
 */
export function computeKama(
  closes: number[],
  n = 10,
  fast = 2,
  slow = 30,
): KamaStats | null {
  if (n < 1 || fast < 1 || slow < 1) return null;
  const len = closes.length;
  if (len < n + 2) return null;

  const fastSC = 2 / (fast + 1);
  const slowSC = 2 / (slow + 1);
  const kama = new Array<number>(len).fill(NaN);
  kama[n - 1] = closes[n - 1]; // seed one bar before the first ER

  let lastEr = 0;
  for (let i = n; i < len; i++) {
    const change = Math.abs(closes[i] - closes[i - n]);
    let vol = 0;
    for (let j = i - n + 1; j <= i; j++) vol += Math.abs(closes[j] - closes[j - 1]);
    const er = vol > 0 ? change / vol : 0;
    const sc = (er * (fastSC - slowSC) + slowSC) ** 2;
    kama[i] = kama[i - 1] + sc * (closes[i] - kama[i - 1]);
    lastEr = er;
  }

  const last = len - 1;
  const kamaLast = kama[last];
  const slope = kamaLast - kama[last - 1];
  const close = closes[last];
  const dir: KamaDir = slope > 0 ? 'up' : slope < 0 ? 'down' : 'flat';
  return {
    kama: kamaLast,
    slope,
    er: lastEr,
    distPct: close > 0 ? ((close - kamaLast) / close) * 100 : 0,
    slopePct: close > 0 ? (slope / close) * 100 : 0,
    dir,
    side: close >= kamaLast ? 'above' : 'below',
    n: len,
  };
}

/** Build a sorted per-symbol KAMA trend board, skipping thin history. */
export function kamaBoard(
  series: { symbol: string; closes: number[] }[],
  sort: KamaSort = 'dist',
  n = 10,
  fast = 2,
  slow = 30,
): KamaRow[] {
  const rows: KamaRow[] = [];
  for (const s of series) {
    const stats = computeKama(s.closes, n, fast, slow);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortKama(rows, sort);
}

export function sortKama(rows: KamaRow[], sort: KamaSort): KamaRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'er':
      out.sort((a, b) => b.er - a.er);
      break;
    case 'slope':
      out.sort((a, b) => b.slopePct - a.slopePct);
      break;
    case 'dist':
    default:
      out.sort((a, b) => b.distPct - a.distPct);
      break;
  }
  return out;
}
