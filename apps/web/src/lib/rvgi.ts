/**
 * Relative Vigor Index (John Ehlers & Rick Way).
 *
 * Gauges conviction by where price closes within its bar: a strong up day
 * closes near its high (close ≫ open), a weak one near its low. Both the
 * close−open "vigor" and the high−low range are passed through a 4-bar
 * symmetric 1·2·2·1 filter, summed over N bars, and divided:
 *
 *   numBar = (co + 2·co₋₁ + 2·co₋₂ + co₋₃) / 6        co = close − open
 *   denBar = (hl + 2·hl₋₁ + 2·hl₋₂ + hl₋₃) / 6        hl = high − low
 *   RVI    = SMA(numBar, N) / SMA(denBar, N)          (≡ ΣnumBar / ΣdenBar)
 *   signal = (RVI + 2·RVI₋₁ + 2·RVI₋₂ + RVI₋₃) / 6    same 1·2·2·1 filter
 *
 * RVI is dimensionless and self-normalising, oscillating around zero within
 * roughly [−1, 1]: above its signal is bullish vigor, below is bearish, and the
 * RVI/signal crossovers are the triggers. Default N = 10. Verified against an
 * independent worked example. Pure and synchronous so it can be unit-tested.
 */

export type RvgiSide = 'pos' | 'neg';
export type RvgiDir = 'up' | 'down';

export interface RvgiBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface RvgiStats {
  /** Relative Vigor Index at the latest bar (≈ [-1, 1]). */
  rvi: number;
  /** Signal line (1·2·2·1 filter of RVI) at the latest bar. */
  signal: number;
  /** RVI − signal. */
  hist: number;
  /** RVI above (up) or below (down) its signal line. */
  dir: RvgiDir;
  /** RVI above (pos) or below (neg) the zero line. */
  side: RvgiSide;
  /** Number of bars supplied. */
  n: number;
}

export interface RvgiRow extends RvgiStats {
  symbol: string;
}

export type RvgiSort = 'rvi' | 'hist' | 'symbol';

/**
 * Compute the latest Relative Vigor Index for one symbol. Returns null with bad
 * params or too little history (needs ≥ N + 6 bars: a 4-bar filter warm-up, the
 * N-bar SMA window, and a second 4-bar filter for the signal).
 */
export function computeRvgi(bars: RvgiBar[], period = 10): RvgiStats | null {
  if (period < 1) return null;
  const n = bars.length;
  if (n < period + 6) return null;

  const co: number[] = [];
  const hl: number[] = [];
  for (const b of bars) {
    co.push(b.close - b.open);
    hl.push(b.high - b.low);
  }

  // 1·2·2·1 / 6 symmetric filter of co and hl (defined from index 3).
  const numBar = new Array<number>(n).fill(NaN);
  const denBar = new Array<number>(n).fill(NaN);
  for (let i = 3; i < n; i++) {
    numBar[i] = (co[i] + 2 * co[i - 1] + 2 * co[i - 2] + co[i - 3]) / 6;
    denBar[i] = (hl[i] + 2 * hl[i - 1] + 2 * hl[i - 2] + hl[i - 3]) / 6;
  }

  // RVI = SMA(numBar, N) / SMA(denBar, N) — the /N cancels, so it's Σ/Σ.
  const rvi = new Array<number>(n).fill(NaN);
  for (let i = period + 2; i < n; i++) {
    let sumN = 0;
    let sumD = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumN += numBar[j];
      sumD += denBar[j];
    }
    rvi[i] = sumD !== 0 ? sumN / sumD : 0;
  }

  const last = n - 1;
  if (Number.isNaN(rvi[last]) || Number.isNaN(rvi[last - 3])) return null;

  const signal = (rvi[last] + 2 * rvi[last - 1] + 2 * rvi[last - 2] + rvi[last - 3]) / 6;
  const value = rvi[last];
  const hist = value - signal;
  return {
    rvi: value,
    signal,
    hist,
    dir: value >= signal ? 'up' : 'down',
    side: value >= 0 ? 'pos' : 'neg',
    n,
  };
}

/** Build a sorted per-symbol RVGI board, skipping symbols with too little history. */
export function rvgiBoard(
  series: { symbol: string; bars: RvgiBar[] }[],
  sort: RvgiSort = 'rvi',
  period = 10,
): RvgiRow[] {
  const rows: RvgiRow[] = [];
  for (const s of series) {
    const stats = computeRvgi(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortRvgi(rows, sort);
}

export function sortRvgi(rows: RvgiRow[], sort: RvgiSort): RvgiRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'hist':
      out.sort((a, b) => b.hist - a.hist);
      break;
    case 'rvi':
    default:
      out.sort((a, b) => b.rvi - a.rvi);
      break;
  }
  return out;
}
