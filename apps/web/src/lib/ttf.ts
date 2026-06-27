/**
 * Trend Trigger Factor (TTF) screener helpers.
 *
 * M.H. Pee's Trend Trigger Factor (Stocks & Commodities, 2004) compares the
 * high/low range of the most recent N bars against the N bars before that. At
 * the latest bar, with a recent window and a non-overlapping prior window:
 *
 *   buyPower  = highestHigh(recent) − lowestLow(prior)
 *   sellPower = highestHigh(prior)  − lowestLow(recent)
 *   TTF       = 100 · (buyPower − sellPower) / (0.5 · (buyPower + sellPower))
 *
 * buyPower measures how far the recent high sits above the prior low; sellPower
 * the reverse. TTF oscillates around 0 and beyond ±100: above +100 is a strong
 * uptrend (buy), below −100 a strong downtrend (sell), in between is neutral.
 * It can exceed ±100 because the average-power denominator can shrink in clean
 * breakouts. Uses high/low only; default lookback N = 15 (so 2N = 30 bars).
 */

export interface TtfBar {
  high: number;
  low: number;
}

export type TtfZone = 'up' | 'down' | 'neutral';

export interface TtfStats {
  /** Trend Trigger Factor at the latest bar. */
  ttf: number;
  /** recentHH − priorLL. */
  buyPower: number;
  /** priorHH − recentLL. */
  sellPower: number;
  /** > +100 uptrend (buy), < −100 downtrend (sell), otherwise neutral. */
  zone: TtfZone;
  /** Number of bars supplied. */
  n: number;
}

export interface TtfRow extends TtfStats {
  symbol: string;
}

export type TtfSort = 'ttf' | 'abs' | 'symbol';

/** Classify a TTF reading using the ±100 trend-trigger bands. */
export function classifyTtf(ttf: number): TtfZone {
  if (ttf > 100) return 'up';
  if (ttf < -100) return 'down';
  return 'neutral';
}

/**
 * Compute the latest Trend Trigger Factor for one symbol. Needs at least 2·N
 * bars (the recent and prior windows are non-overlapping); returns null on bad
 * params or too little history.
 */
export function computeTtf(bars: TtfBar[], period = 15): TtfStats | null {
  if (period < 1) return null;
  const n = bars.length;
  if (n < 2 * period) return null;
  const last = n - 1;

  let recentHH = -Infinity;
  let recentLL = Infinity;
  for (let i = last - period + 1; i <= last; i++) {
    if (bars[i].high > recentHH) recentHH = bars[i].high;
    if (bars[i].low < recentLL) recentLL = bars[i].low;
  }

  let priorHH = -Infinity;
  let priorLL = Infinity;
  for (let i = last - 2 * period + 1; i <= last - period; i++) {
    if (bars[i].high > priorHH) priorHH = bars[i].high;
    if (bars[i].low < priorLL) priorLL = bars[i].low;
  }

  const buyPower = recentHH - priorLL;
  const sellPower = priorHH - recentLL;
  const denom = 0.5 * (buyPower + sellPower);
  const ttf = denom !== 0 ? (100 * (buyPower - sellPower)) / denom : 0;
  return { ttf, buyPower, sellPower, zone: classifyTtf(ttf), n };
}

/** Build a sorted per-symbol Trend Trigger Factor board, skipping thin history. */
export function ttfBoard(
  series: { symbol: string; bars: TtfBar[] }[],
  sort: TtfSort = 'ttf',
  period = 15,
): TtfRow[] {
  const rows: TtfRow[] = [];
  for (const s of series) {
    const stats = computeTtf(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortTtf(rows, sort);
}

export function sortTtf(rows: TtfRow[], sort: TtfSort): TtfRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'abs':
      out.sort((a, b) => Math.abs(b.ttf) - Math.abs(a.ttf));
      break;
    case 'ttf':
    default:
      out.sort((a, b) => b.ttf - a.ttf);
      break;
  }
  return out;
}
