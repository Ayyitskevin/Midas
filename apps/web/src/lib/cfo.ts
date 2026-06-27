/**
 * Chande Forecast Oscillator (Tushar Chande).
 *
 * How far price sits from its own least-squares regression line over N bars:
 *
 *   fit = endpoint of the linear-regression line fitted to the last N closes
 *   CFO = 100 · (close − fit) / close
 *
 * Above zero means price closed above its regression fit (running ahead of
 * trend); below zero means it lagged. Oscillates around the zero line as price
 * reverts to and diverges from its own fitted trend — a regression-based
 * oscillator, distinct from the moving-average family.
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */

export type CfoSide = 'up' | 'down';

export interface CfoStats {
  /** Chande Forecast Oscillator (%). */
  cfo: number;
  /** The regression-line endpoint (fit) at the latest bar. */
  fit: number;
  /** Price above (up) or below (down) its regression fit. */
  side: CfoSide;
  /** Number of closes supplied. */
  n: number;
}

export interface CfoRow extends CfoStats {
  symbol: string;
}

export type CfoSort = 'cfo' | 'symbol';

/**
 * Compute the latest Chande Forecast Oscillator for one symbol over the last
 * `period` closes. Returns null with too little history (needs ≥ 2 and
 * ≥ period closes).
 */
export function computeCfo(closes: number[], period = 14): CfoStats | null {
  if (period < 2 || closes.length < period) return null;
  const w = closes.slice(-period);

  // Least-squares fit y = intercept + slope·x over x = 0..period-1.
  const n = period;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += w[i];
    sumXY += i * w[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;
  const fit = intercept + slope * (n - 1); // regression value at the latest bar

  const close = w[n - 1];
  const cfo = close !== 0 ? ((close - fit) / close) * 100 : 0;
  return { cfo, fit, side: cfo >= 0 ? 'up' : 'down', n: closes.length };
}

/** Build a sorted per-symbol CFO board, skipping symbols with too little history. */
export function cfoBoard(
  series: { symbol: string; closes: number[] }[],
  sort: CfoSort = 'cfo',
  period = 14,
): CfoRow[] {
  const rows: CfoRow[] = [];
  for (const s of series) {
    const stats = computeCfo(s.closes, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortCfo(rows, sort);
}

export function sortCfo(rows: CfoRow[], sort: CfoSort): CfoRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'cfo':
    default:
      out.sort((a, b) => b.cfo - a.cfo);
      break;
  }
  return out;
}
