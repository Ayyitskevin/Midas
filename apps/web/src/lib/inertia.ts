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
 * original, the TradingView form) with Wilder smoothing (matching the RSI board);
 * the 1995 refinement instead averages an RVI of the high and of the low.
 * Defaults follow Dorsey: stdev 10, RVI 14, linreg 20.
 */

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

/** Population standard deviation of a window (÷N, matching the repo's stdev). */
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
 * RVI from the smoothed up/down averages. The ratio is taken before the ×100 so
 * a pure trend (avgDown 0 → avgUp/avgUp = 1) reads exactly 100, never a 1-ULP
 * overshoot above the RVI's 0–100 range; 0 when both averages are 0.
 */
function rviRatio(avgUp: number, avgDown: number): number {
  return avgUp + avgDown !== 0 ? 100 * (avgUp / (avgUp + avgDown)) : 0;
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

  // Volatility routed into up / down buckets by close direction (one bucket per bar).
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
  if (ups.length < rviPeriod) return null;

  // RVI = 100·Wilder(up)/(Wilder(up)+Wilder(down)); SMA seed then Wilder recursion.
  const rvi: number[] = [];
  let avgUp = 0;
  let avgDown = 0;
  for (let k = 0; k < rviPeriod; k++) {
    avgUp += ups[k];
    avgDown += downs[k];
  }
  avgUp /= rviPeriod;
  avgDown /= rviPeriod;
  rvi.push(rviRatio(avgUp, avgDown));
  for (let k = rviPeriod; k < ups.length; k++) {
    avgUp = (avgUp * (rviPeriod - 1) + ups[k]) / rviPeriod;
    avgDown = (avgDown * (rviPeriod - 1) + downs[k]) / rviPeriod;
    rvi.push(rviRatio(avgUp, avgDown));
  }
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
