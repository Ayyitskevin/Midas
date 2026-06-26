/**
 * Unusual-volume (relative-volume / RVOL) analytics.
 *
 * For each symbol we compare the latest bar's volume to its recent norm:
 *
 *   surge (RVOL) = volume ÷ trailing-average volume
 *   z            = (volume − mean) ÷ stdev of the trailing window
 *
 * The trailing baseline excludes today, so both answer "is today unusual
 * versus the days before it". `direction` carries the sign of today's return
 * so a surge can be read as accumulation (big volume on an up day) vs
 * distribution (big volume on a down day).
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */

/** Minimal close+volume bar. */
export interface VolBar {
  close: number;
  volume: number;
}

export interface VolSurgeStats {
  /** Today's volume. */
  volume: number;
  /** Trailing-window average volume (excludes today). */
  avgVolume: number;
  /** Relative volume: volume ÷ avgVolume. >1 = above normal. */
  surge: number;
  /** Standard score of today's volume vs the trailing window; 0 if no variance. */
  z: number;
  /** Sign of today's return: +1 up, −1 down, 0 flat. */
  direction: number;
  /** Number of bars used. */
  n: number;
}

export interface VolSurgeRow extends VolSurgeStats {
  symbol: string;
}

export type VolSurgeSort = 'surge' | 'z' | 'volume' | 'symbol';

const MIN_BARS = 3; // need ≥2 prior bars for a stdev plus today

/**
 * Compute relative-volume stats for one symbol. Returns null when there are
 * too few bars or the trailing average volume is non-positive (degenerate).
 */
export function computeVolSurge(bars: VolBar[], window = 20): VolSurgeStats | null {
  if (bars.length < MIN_BARS) return null;
  const n = bars.length;
  const today = bars[n - 1];
  const volume = today.volume;

  const prior = bars.slice(Math.max(0, n - 1 - window), n - 1).map((b) => b.volume);
  if (prior.length < 2) return null;
  const mean = prior.reduce((a, b) => a + b, 0) / prior.length;
  if (mean <= 0) return null;

  const variance = prior.reduce((a, b) => a + (b - mean) * (b - mean), 0) / prior.length;
  const std = Math.sqrt(variance);
  const surge = volume / mean;
  const z = std > 0 ? (volume - mean) / std : 0;
  const prev = bars[n - 2].close;
  const direction = today.close > prev ? 1 : today.close < prev ? -1 : 0;

  return { volume, avgVolume: mean, surge, z, direction, n };
}

/** Build a sorted per-symbol relative-volume board, skipping degenerate names. */
export function volSurgeBoard(
  series: { symbol: string; bars: VolBar[] }[],
  sort: VolSurgeSort = 'surge',
  window = 20,
): VolSurgeRow[] {
  const rows: VolSurgeRow[] = [];
  for (const s of series) {
    const stats = computeVolSurge(s.bars, window);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortVolSurge(rows, sort);
}

export function sortVolSurge(rows: VolSurgeRow[], sort: VolSurgeSort): VolSurgeRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'z':
      out.sort((a, b) => b.z - a.z);
      break;
    case 'volume':
      out.sort((a, b) => b.volume - a.volume);
      break;
    case 'surge':
    default:
      out.sort((a, b) => b.surge - a.surge);
      break;
  }
  return out;
}
