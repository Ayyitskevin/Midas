/**
 * Gann HiLo Activator (GHLA) screener helpers.
 *
 * Robert Krausz's Gann HiLo Activator is a trend-following stop-and-reverse line
 * built from two simple moving averages — one of the highs, one of the lows:
 *
 *   smaHigh = SMA(high, N) ,  smaLow = SMA(low, N)
 *   if close > smaHigh[prev bar]   → trend = up
 *   if close < smaLow[prev bar]    → trend = down
 *   otherwise                      → trend carries over
 *   activator = trend up ? smaLow : smaHigh
 *
 * In an uptrend the activator is the low-SMA trailing *below* price (a support /
 * stop); in a downtrend it is the high-SMA *above* price (resistance / stop). A
 * close that pierces the opposite band flips the trend. The comparison uses the
 * PRIOR bar's SMAs, so there is no look-ahead.
 *
 * The activator is in price units, so the board screens trend STATE: direction,
 * how many bars the current trend has held (age), fresh flips, and how far price
 * sits from the activator/stop line (distPct, scale-invariant) — positive when
 * price leads its stop in an uptrend, negative below it in a downtrend.
 *
 * Pure, synchronous, and a simple state machine (no deep recursion), so it is
 * unit-tested against exact hand-computed OHLC bars.
 */

/** Minimal bar (Gann HiLo uses high, low and close). */
export interface GannHiloBar {
  high: number;
  low: number;
  close: number;
}

export type GannHiloDir = 'up' | 'down';

export interface GannHiloStats {
  /** The activator/stop line on the latest bar (price units). */
  activator: number;
  /** Trend regime on the latest bar. */
  direction: GannHiloDir;
  /** Bars the current trend has held (1 = flipped on the latest bar). */
  age: number;
  /** Trend flipped on the latest bar. */
  flip: boolean;
  /** Close relative to the activator line, percent (scale-invariant). */
  distPct: number;
  /** Number of bars supplied. */
  n: number;
}

export interface GannHiloRow extends GannHiloStats {
  symbol: string;
}

export type GannHiloSort = 'trend' | 'dist' | 'symbol';

/**
 * Compute the latest Gann HiLo Activator reading for one symbol. Needs at least
 * `period + 1` bars (so the prior-bar SMA exists for one trend decision); returns
 * null otherwise. The trend is seeded to 'up' before the first decision, which
 * washes out over real history.
 */
export function computeGannHilo(bars: GannHiloBar[], period = 3): GannHiloStats | null {
  const n = bars.length;
  if (period < 1 || n < period + 1) return null;

  const smaHigh = (i: number) => {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += bars[j].high;
    return s / period;
  };
  const smaLow = (i: number) => {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += bars[j].low;
    return s / period;
  };

  const trend: GannHiloDir[] = [];
  let prevTrend: GannHiloDir = 'up';
  let activator = 0;
  for (let i = period; i < n; i++) {
    const shPrev = smaHigh(i - 1);
    const slPrev = smaLow(i - 1);
    const c = bars[i].close;
    const t: GannHiloDir = c > shPrev ? 'up' : c < slPrev ? 'down' : prevTrend;
    trend.push(t);
    prevTrend = t;
    activator = t === 'up' ? smaLow(i) : smaHigh(i);
  }

  const direction = trend[trend.length - 1];
  let age = 1;
  for (let j = trend.length - 2; j >= 0; j--) {
    if (trend[j] === direction) age++;
    else break;
  }

  const close = bars[n - 1].close;
  const distPct = activator === 0 ? 0 : (100 * (close - activator)) / activator;
  return { activator, direction, age, flip: age === 1, distPct, n };
}

/** Build a sorted per-symbol Gann HiLo Activator board, skipping symbols with too little history. */
export function gannHiloBoard(
  series: { symbol: string; bars: GannHiloBar[] }[],
  sort: GannHiloSort = 'trend',
  period = 3,
): GannHiloRow[] {
  const rows: GannHiloRow[] = [];
  for (const s of series) {
    const stats = computeGannHilo(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortGannHilo(rows, sort);
}

/** Signed trend persistence: +age while up, −age while down. */
const trendScore = (r: GannHiloStats) => (r.direction === 'up' ? r.age : -r.age);

export function sortGannHilo(rows: GannHiloRow[], sort: GannHiloSort): GannHiloRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'dist':
      out.sort((a, b) => b.distPct - a.distPct);
      break;
    case 'trend':
    default:
      // Longest-running uptrends first, longest downtrends last; ties by distance.
      out.sort((a, b) => trendScore(b) - trendScore(a) || b.distPct - a.distPct);
      break;
  }
  return out;
}
