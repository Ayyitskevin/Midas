/**
 * Inertia (Donald Dorsey) screener helpers.
 *
 * Inertia is the Relative Volatility Index (RVI) smoothed by a linear-regression
 * line. The RVI is RSI's twin but fed the *volatility* of price rather than the
 * price change:
 *
 *   sd[i]   = rolling population stdev of close over stdevPeriod
 *   up/down = sd routed to the up bucket when close rose, the down bucket when it fell
 *   RVI     = 100 · Wilder(up) / (Wilder(up) + Wilder(down))   over rviPeriod
 *   Inertia = linear-regression endpoint (LSMA) of RVI over linregPeriod
 *
 * Above 50 is positive inertia (the longer-term trend is up / bullish and tends
 * to persist); below 50 is negative. Being a regression of a smoothed volatility
 * ratio, it moves slowly. This uses the close-only one-sided RVI (Dorsey's 1993
 * original) with Wilder smoothing — matching Dorsey's verbatim formula and the
 * repo's RVI board, which share the `rviSeries` core in `rvi.ts`; the 1995
 * refinement instead averages an RVI of the high and of the low.
 * Defaults follow Dorsey: stdev 10, RVI 14, linreg 20.
 */
import { rviSeries } from './rvi';

export type InertiaSide = 'up' | 'down';

export interface InertiaStats {
  /** Inertia: the linear-regression endpoint of the RVI. */
  inertia: number;
  /** Latest raw RVI (before the regression smoothing), 0–100. */
  rvi: number;
  /** Inertia ≥ 50 (up / bullish) or < 50 (down / bearish). */
  side: InertiaSide;
  /** Number of closes supplied. */
  n: number;
}

export interface InertiaRow extends InertiaStats {
  symbol: string;
}

export type InertiaSort = 'inertia' | 'rvi' | 'symbol';

/** Least-squares regression value at the newest point (LSMA endpoint) of y[0..p-1]. */
function linregEndpoint(y: number[]): number {
  const p = y.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < p; i++) {
    sumX += i;
    sumY += y[i];
    sumXY += i * y[i];
    sumXX += i * i;
  }
  const denom = p * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (p * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / p;
  return intercept + slope * (p - 1);
}

/**
 * Compute the latest Inertia for one symbol. Needs at least
 * stdevPeriod + rviPeriod + linregPeriod − 2 closes (rolling stdev, then the
 * Wilder RVI, then the regression window); returns null otherwise.
 */
export function computeInertia(
  closes: number[],
  stdevPeriod = 10,
  rviPeriod = 14,
  linregPeriod = 20,
): InertiaStats | null {
  if (stdevPeriod < 1 || rviPeriod < 1 || linregPeriod < 2) return null;
  const n = closes.length;
  if (n < stdevPeriod + rviPeriod + linregPeriod - 2) return null;

  // RVI series (population stdev routed up/down, Wilder-smoothed) — shared with rvi.ts.
  const rvi = rviSeries(closes, stdevPeriod, rviPeriod);
  if (rvi.length < linregPeriod) return null;

  const inertia = linregEndpoint(rvi.slice(rvi.length - linregPeriod));
  const rviLast = rvi[rvi.length - 1];
  return { inertia, rvi: rviLast, side: inertia >= 50 ? 'up' : 'down', n };
}

/** Build a sorted per-symbol Inertia board, skipping symbols with too little history. */
export function inertiaBoard(
  series: { symbol: string; closes: number[] }[],
  sort: InertiaSort = 'inertia',
  stdevPeriod = 10,
  rviPeriod = 14,
  linregPeriod = 20,
): InertiaRow[] {
  const rows: InertiaRow[] = [];
  for (const s of series) {
    const stats = computeInertia(s.closes, stdevPeriod, rviPeriod, linregPeriod);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortInertia(rows, sort);
}

export function sortInertia(rows: InertiaRow[], sort: InertiaSort): InertiaRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'rvi':
      out.sort((a, b) => b.rvi - a.rvi);
      break;
    case 'inertia':
    default:
      out.sort((a, b) => b.inertia - a.inertia);
      break;
  }
  return out;
}
