/**
 * Bollinger Band %B and bandwidth-squeeze analytics.
 *
 * Bollinger Bands wrap an N-period SMA with ±k standard deviations:
 *   middle = SMA(close, period)
 *   upper  = middle + k·stdev,  lower = middle − k·stdev
 *
 * From them, per symbol:
 *   - pctB      (close − lower) / (upper − lower): position in the bands
 *               (0 = lower, 0.5 = middle, 1 = upper; <0 or >1 = outside)
 *   - bandwidth (upper − lower) / middle: band width relative to price
 *   - bwPctile  percentile rank of the current bandwidth over a trailing
 *               lookback (0 = narrowest)
 *   - squeeze   bandwidth in the bottom quintile of that lookback — the
 *               compression that often precedes an expansion
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed
 * closes. Standard deviation is the population form (÷n), matching the other
 * distribution helpers in this codebase.
 */

export interface BBStats {
  /** %B: position of the close within the bands. */
  pctB: number;
  /** Bandwidth: (upper − lower) / middle. */
  bandwidth: number;
  /** Percentile rank (0..1) of the current bandwidth over the lookback. */
  bwPctile: number;
  /** True when bandwidth sits in the bottom quintile of the lookback. */
  squeeze: boolean;
  /** Upper band. */
  upper: number;
  /** Middle band (SMA). */
  middle: number;
  /** Lower band. */
  lower: number;
  /** Number of closes supplied. */
  n: number;
}

export interface BBRow extends BBStats {
  symbol: string;
}

export type BBSort = 'pctB' | 'bandwidth' | 'bwPctile' | 'symbol';

const MIN_SQUEEZE_HISTORY = 3;
const SQUEEZE_PCTILE = 0.2;

function meanStd(window: number[]): { mean: number; std: number } {
  const n = window.length;
  let sum = 0;
  for (const v of window) sum += v;
  const mean = sum / n;
  let v = 0;
  for (const x of window) v += (x - mean) * (x - mean);
  return { mean, std: Math.sqrt(v / n) };
}

/**
 * Compute Bollinger %B / bandwidth / squeeze for one symbol. The squeeze
 * percentile ranks the current bandwidth against the trailing `lookback`
 * rolling bandwidths. Returns null with too few closes or a non-positive SMA.
 */
export function computeBands(closes: number[], period = 20, k = 2, lookback = 120): BBStats | null {
  if (period < 2 || closes.length < period) return null;

  const { mean, std } = meanStd(closes.slice(-period));
  if (mean <= 0) return null;
  const upper = mean + k * std;
  const lower = mean - k * std;
  const width = upper - lower;
  const close = closes[closes.length - 1];
  const pctB = width > 0 ? (close - lower) / width : 0.5;
  const bandwidth = width / mean;

  // Rolling bandwidth series for the squeeze percentile.
  const bws: number[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    const ms = meanStd(closes.slice(i - period + 1, i + 1));
    bws.push(ms.mean > 0 ? (2 * k * ms.std) / ms.mean : 0);
  }
  const tail = bws.slice(-lookback);
  let bwPctile = 0.5;
  if (tail.length >= 2) {
    const cur = tail[tail.length - 1];
    let below = 0;
    for (let i = 0; i < tail.length - 1; i++) if (tail[i] < cur) below += 1;
    bwPctile = below / (tail.length - 1);
  }
  const squeeze = tail.length >= MIN_SQUEEZE_HISTORY && bwPctile <= SQUEEZE_PCTILE;

  return { pctB, bandwidth, bwPctile, squeeze, upper, middle: mean, lower, n: closes.length };
}

/** Build a sorted per-symbol Bollinger board, skipping symbols with too little history. */
export function bandsBoard(
  series: { symbol: string; closes: number[] }[],
  sort: BBSort = 'pctB',
  period = 20,
  k = 2,
  lookback = 120,
): BBRow[] {
  const rows: BBRow[] = [];
  for (const s of series) {
    const stats = computeBands(s.closes, period, k, lookback);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortBands(rows, sort);
}

export function sortBands(rows: BBRow[], sort: BBSort): BBRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'bandwidth':
      out.sort((a, b) => b.bandwidth - a.bandwidth);
      break;
    case 'bwPctile':
      // Ascending: tightest squeezes first.
      out.sort((a, b) => a.bwPctile - b.bwPctile);
      break;
    case 'pctB':
    default:
      out.sort((a, b) => b.pctB - a.pctB);
      break;
  }
  return out;
}
