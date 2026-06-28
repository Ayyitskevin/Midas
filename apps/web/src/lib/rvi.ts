/**
 * Relative Volatility Index (RVI) screener helpers — Donald Dorsey (Stocks &
 * Commodities, 1993).
 *
 * The RVI is RSI's twin, but fed the *volatility* of price rather than the price
 * change — a confirmation gauge for the direction of volatility:
 *
 *   sd[i]   = rolling population stdev of close over stdevPeriod
 *   up/down = sd routed to the up bucket when close rose, the down bucket when it fell
 *   RVI     = 100 · Wilder(up) / (Wilder(up) + Wilder(down))   over rviPeriod
 *
 * Above 50 means volatility is expanding on up moves (bullish confirmation),
 * below 50 on down moves; Dorsey draws overbought / oversold guides at 60 / 40.
 * This is the close-based 1993 original with Wilder smoothing (matching the RSI
 * board and Dorsey's verbatim formula `RVI_Up = (PREV·13 + sd)/14`); the 1995
 * refinement instead averages an RVI of the high and of the low. Defaults follow
 * Dorsey: stdev 10, RVI 14.
 *
 * `rviSeries` is the shared core used both here and by the Inertia board
 * (`inertia.ts`, a linear-regression of this exact RVI), so the two always agree.
 * Pure and synchronous; the std-dev / Wilder chain is unit-tested against an
 * independently verified fixture.
 */

export const RVI_HIGH = 60;
export const RVI_LOW = 40;

export type RviZone = 'high' | 'low' | 'neutral';

export interface RviStats {
  /** Latest RVI, 0–100. */
  rvi: number;
  /** Band zone from the 60 / 40 guides. */
  zone: RviZone;
  /** Number of closes supplied. */
  n: number;
}

export interface RviRow extends RviStats {
  symbol: string;
}

export type RviSort = 'rvi' | 'symbol';

/** Population standard deviation of a window (÷N, matching the repo's stdev convention). */
function popStdev(window: number[]): number {
  const n = window.length;
  if (n === 0) return 0;
  let m = 0;
  for (const x of window) m += x;
  m /= n;
  let v = 0;
  for (const x of window) v += (x - m) ** 2;
  return Math.sqrt(v / n);
}

/**
 * The RVI = 100·up/(up+down), taken before the ×100 so a pure trend (down 0 →
 * up/up = 1) reads exactly 100, never a 1-ULP overshoot; 0 when both are 0.
 */
const rviRatio = (up: number, down: number): number =>
  up + down !== 0 ? 100 * (up / (up + down)) : 0;

/**
 * Wilder-smoothed RVI series (Dorsey 1993, close-based). Routes each bar's
 * population stdev into an up/down bucket by close direction, then Wilder-smooths
 * (SMA seed of the first `rviPeriod`, then the recursion). Returns the defined
 * subseries, or `[]` with too little history. Shared with `inertia.ts`.
 */
export function rviSeries(closes: number[], stdevPeriod = 10, rviPeriod = 14): number[] {
  if (stdevPeriod < 1 || rviPeriod < 1) return [];
  const n = closes.length;

  const firstIdx = Math.max(stdevPeriod - 1, 1); // need the stdev window and a prior close
  const ups: number[] = [];
  const downs: number[] = [];
  for (let i = firstIdx; i < n; i++) {
    const sd = popStdev(closes.slice(i - stdevPeriod + 1, i + 1));
    if (closes[i] > closes[i - 1]) {
      ups.push(sd);
      downs.push(0);
    } else if (closes[i] < closes[i - 1]) {
      ups.push(0);
      downs.push(sd);
    } else {
      ups.push(0);
      downs.push(0);
    }
  }
  if (ups.length < rviPeriod) return [];

  const out: number[] = [];
  let avgUp = 0;
  let avgDown = 0;
  for (let k = 0; k < rviPeriod; k++) {
    avgUp += ups[k];
    avgDown += downs[k];
  }
  avgUp /= rviPeriod;
  avgDown /= rviPeriod;
  out.push(rviRatio(avgUp, avgDown));
  for (let k = rviPeriod; k < ups.length; k++) {
    avgUp = (avgUp * (rviPeriod - 1) + ups[k]) / rviPeriod;
    avgDown = (avgDown * (rviPeriod - 1) + downs[k]) / rviPeriod;
    out.push(rviRatio(avgUp, avgDown));
  }
  return out;
}

/** Classify an RVI reading against the 60 / 40 guides. */
export function rviZone(v: number): RviZone {
  if (v >= RVI_HIGH) return 'high';
  if (v <= RVI_LOW) return 'low';
  return 'neutral';
}

/**
 * Compute the latest RVI for one symbol. Needs at least
 * `stdevPeriod + rviPeriod − 1` closes; returns null otherwise.
 */
export function computeRvi(closes: number[], stdevPeriod = 10, rviPeriod = 14): RviStats | null {
  const series = rviSeries(closes, stdevPeriod, rviPeriod);
  if (series.length === 0) return null;
  const rvi = series[series.length - 1];
  return { rvi, zone: rviZone(rvi), n: closes.length };
}

/** Build a sorted per-symbol RVI board, skipping symbols with too little history. */
export function rviBoard(
  series: { symbol: string; closes: number[] }[],
  sort: RviSort = 'rvi',
  stdevPeriod = 10,
  rviPeriod = 14,
): RviRow[] {
  const rows: RviRow[] = [];
  for (const s of series) {
    const stats = computeRvi(s.closes, stdevPeriod, rviPeriod);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortRvi(rows, sort);
}

export function sortRvi(rows: RviRow[], sort: RviSort): RviRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'rvi':
    default:
      out.sort((a, b) => b.rvi - a.rvi);
      break;
  }
  return out;
}
