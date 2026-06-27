/**
 * Trend Intensity Index (TII) screener helpers.
 *
 * M.H. Pee's Trend Intensity Index (Stocks & Commodities, 2002) measures how
 * one-sided price has been around its moving average over a recent window. For
 * each of the last `minor` bars it takes the deviation of close from a simple
 * `major`-period moving average, then:
 *
 *   SDpos = Σ deviations that are positive (close above the SMA)
 *   SDneg = Σ |deviations| that are negative (close below the SMA)
 *   TII   = 100 × SDpos / (SDpos + SDneg)
 *
 * TII is a sum of deviation *magnitudes* (not a count of bars) on a 0–100
 * scale: above 50 means positive deviations dominate (uptrend bias), below 50
 * the reverse, ~50 is trendless; the 80 / 20 bands mark a strong trend. The
 * window `minor` is half the `major` look-back (Pee's 60 / 30 default).
 */

export type TiiTrend = 'strong-up' | 'up' | 'flat' | 'down' | 'strong-down';

export interface TiiStats {
  /** Latest Trend Intensity Index, 0–100. */
  tii: number;
  /** Prior bar's TII. */
  prev: number;
  /** Change in TII from the prior bar (its own momentum). */
  delta: number;
  /** Trend classification from the 80 / 50 / 20 bands. */
  trend: TiiTrend;
  /** Number of closes supplied. */
  n: number;
}

export interface TiiRow extends TiiStats {
  symbol: string;
}

export type TiiSort = 'tii' | 'delta' | 'symbol';

/** Classify a TII reading using the canonical 80 (strong) / 50 (bias) / 20 bands. */
export function classifyTrend(tii: number): TiiTrend {
  if (tii >= 80) return 'strong-up';
  if (tii > 50) return 'up';
  if (tii === 50) return 'flat';
  if (tii > 20) return 'down';
  return 'strong-down';
}

/** Simple moving average of `closes` over `period` ending at bar `i`. */
function smaAt(closes: number[], period: number, i: number): number {
  let sum = 0;
  for (let j = i - period + 1; j <= i; j++) sum += closes[j];
  return sum / period;
}

/**
 * TII over the trailing `minor`-bar window ending at bar `end`: sum the
 * positive vs absolute-negative deviations of close from its `major`-SMA.
 * Returns the neutral 50 when every deviation in the window is zero.
 */
function tiiAt(closes: number[], major: number, minor: number, end: number): number {
  let sdPos = 0;
  let sdNeg = 0;
  for (let j = end - minor + 1; j <= end; j++) {
    const dev = closes[j] - smaAt(closes, major, j);
    if (dev > 0) sdPos += dev;
    else if (dev < 0) sdNeg += -dev;
  }
  const denom = sdPos + sdNeg;
  return denom === 0 ? 50 : (100 * sdPos) / denom;
}

/**
 * Compute the latest Trend Intensity Index for one symbol. Needs at least
 * `major + minor` closes so the SMA is defined across both the current and the
 * prior window; returns null otherwise.
 */
export function computeTii(
  closes: number[],
  major = 60,
  minor = Math.floor(major / 2),
): TiiStats | null {
  if (major < 1 || minor < 1) return null;
  const n = closes.length;
  if (n < major + minor) return null;

  const tii = tiiAt(closes, major, minor, n - 1);
  const prev = tiiAt(closes, major, minor, n - 2);
  return { tii, prev, delta: tii - prev, trend: classifyTrend(tii), n };
}

/** Build a sorted per-symbol Trend Intensity Index board, skipping thin history. */
export function tiiBoard(
  series: { symbol: string; closes: number[] }[],
  sort: TiiSort = 'tii',
  major = 60,
  minor = Math.floor(major / 2),
): TiiRow[] {
  const rows: TiiRow[] = [];
  for (const s of series) {
    const stats = computeTii(s.closes, major, minor);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortTii(rows, sort);
}

export function sortTii(rows: TiiRow[], sort: TiiSort): TiiRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'delta':
      out.sort((a, b) => b.delta - a.delta);
      break;
    case 'tii':
    default:
      out.sort((a, b) => b.tii - a.tii);
      break;
  }
  return out;
}
