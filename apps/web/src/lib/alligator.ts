/**
 * Williams Alligator (GATOR) screener helpers.
 *
 * Bill Williams' Alligator is three smoothed moving averages of the median price
 * ((high + low) / 2), each shifted forward in time:
 *
 *   Jaw   (blue)  = SMMA(median, 13), displaced 8 bars
 *   Teeth (red)   = SMMA(median, 8),  displaced 5 bars
 *   Lips  (green) = SMMA(median, 5),  displaced 3 bars
 *
 * SMMA is Wilder's smoothed MA (RMA): seed = SMA of the first N, then
 * SMMA[i] = (SMMA[i−1]·(N−1) + price[i]) / N. The forward displacement means the
 * value plotted at the current bar is the SMMA computed `shift` bars ago.
 *
 * When the three lines are intertwined the "alligator sleeps" (a range / no
 * trend); when they fan out in order it "feeds": Lips > Teeth > Jaw is an uptrend,
 * Lips < Teeth < Jaw a downtrend. The board reports that state and the fan width
 * (Lips − Jaw) as a percent of price — scale-invariant, so it ranks cleanly
 * across symbols (a wide positive fan = strong uptrend, wide negative = strong
 * downtrend, near zero = sleeping).
 *
 * Pure and synchronous.
 */

/** Minimal bar (the Alligator works on the median (high + low) / 2). */
export interface AlligatorBar {
  high: number;
  low: number;
}

/** Wilder's smoothed moving average (RMA): SMA seed then recursive smoothing. */
export function smma(values: number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  if (period < 1 || n < period) return out;

  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < n; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

export type GatorState = 'up' | 'down' | 'sleeping';

export interface AlligatorStats {
  /** Jaw line value plotted at the latest bar (SMMA 13, displaced 8). */
  jaw: number;
  /** Teeth line value (SMMA 8, displaced 5). */
  teeth: number;
  /** Lips line value (SMMA 5, displaced 3). */
  lips: number;
  /** Feeding up (Lips>Teeth>Jaw) / down / sleeping (intertwined). */
  state: GatorState;
  /** Fan width = 100·(Lips − Jaw) / median (signed, scale-invariant). */
  spreadPct: number;
  /** Number of bars supplied. */
  n: number;
}

export interface AlligatorRow extends AlligatorStats {
  symbol: string;
}

export type AlligatorSort = 'spread' | 'symbol';

/**
 * Compute the latest Alligator state for one symbol. Needs at least jawPeriod +
 * jawShift bars so the displaced Jaw line is defined; returns null on bad params
 * or too little history.
 */
export function computeAlligator(
  bars: AlligatorBar[],
  jawPeriod = 13,
  jawShift = 8,
  teethPeriod = 8,
  teethShift = 5,
  lipsPeriod = 5,
  lipsShift = 3,
): AlligatorStats | null {
  const n = bars.length;
  if (jawPeriod < 1 || teethPeriod < 1 || lipsPeriod < 1) return null;
  if (jawShift < 0 || teethShift < 0 || lipsShift < 0) return null;
  if (n < jawPeriod + jawShift) return null;

  const median = bars.map((b) => (b.high + b.low) / 2);
  const jawLine = smma(median, jawPeriod);
  const teethLine = smma(median, teethPeriod);
  const lipsLine = smma(median, lipsPeriod);

  const last = n - 1;
  const jaw = jawLine[last - jawShift];
  const teeth = teethLine[last - teethShift];
  const lips = lipsLine[last - lipsShift];
  if (!Number.isFinite(jaw) || !Number.isFinite(teeth) || !Number.isFinite(lips)) return null;

  let state: GatorState = 'sleeping';
  if (lips > teeth && teeth > jaw) state = 'up';
  else if (lips < teeth && teeth < jaw) state = 'down';

  const price = median[last];
  const spreadPct = price === 0 ? 0 : (100 * (lips - jaw)) / price;

  return { jaw, teeth, lips, state, spreadPct, n };
}

/** Build a sorted per-symbol Alligator board, skipping symbols with too little history. */
export function alligatorBoard(
  series: { symbol: string; bars: AlligatorBar[] }[],
  sort: AlligatorSort = 'spread',
): AlligatorRow[] {
  const rows: AlligatorRow[] = [];
  for (const s of series) {
    const stats = computeAlligator(s.bars);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortAlligator(rows, sort);
}

export function sortAlligator(rows: AlligatorRow[], sort: AlligatorSort): AlligatorRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'spread':
    default:
      out.sort((a, b) => b.spreadPct - a.spreadPct);
      break;
  }
  return out;
}
