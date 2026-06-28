/**
 * DeMarker (DEM) screener helpers.
 *
 * Tom DeMark's DeMarker is a bounded 0–100 momentum oscillator built from how far
 * each bar extends beyond the prior bar's high/low — a demand/supply balance that,
 * unlike RSI, reads the highs and lows rather than the close:
 *
 *   DeMax[i] = high[i] > high[i−1] ? high[i] − high[i−1] : 0
 *   DeMin[i] = low[i]  < low[i−1]  ? low[i−1] − low[i]   : 0
 *   DEM      = 100 · SMA(DeMax, N) / (SMA(DeMax, N) + SMA(DeMin, N))
 *
 * Default N = 14. Above 70 = overbought / upside-exhaustion risk, below 30 =
 * oversold. The ratio cancels price units, so it is inherently scale-invariant and
 * ranks cleanly across symbols. When neither high nor low moved over the whole
 * window (denominator 0, a degenerate flat market) DEM is defined as 50 (neutral).
 *
 * Pure and synchronous.
 */

/** Minimal bar (DeMarker reads the high/low extremes). */
export interface DeMarkerBar {
  high: number;
  low: number;
}

export type DeMarkerZone = 'overbought' | 'oversold' | 'neutral';

/** Overbought ≥ 70, oversold ≤ 30 (DeMark's guides). */
export const DEM_OB = 70;
export const DEM_OS = 30;

export function deMarkerZone(dem: number): DeMarkerZone {
  if (dem >= DEM_OB) return 'overbought';
  if (dem <= DEM_OS) return 'oversold';
  return 'neutral';
}

export interface DeMarkerStats {
  /** DeMarker value, 0–100. */
  dem: number;
  /** Overbought / oversold / neutral zone. */
  zone: DeMarkerZone;
  /** Number of bars supplied. */
  n: number;
}

export interface DeMarkerRow extends DeMarkerStats {
  symbol: string;
}

export type DeMarkerSort = 'dem' | 'symbol';

/**
 * Compute the latest DeMarker reading for one symbol. Needs at least period + 1
 * bars (DeMax/DeMin need a prior bar and the SMA needs `period` of them); returns
 * null on bad params or too little history.
 */
export function computeDeMarker(bars: DeMarkerBar[], period = 14): DeMarkerStats | null {
  const n = bars.length;
  if (period < 1 || n < period + 1) return null;

  // Trailing `period` DeMax / DeMin values end at the last bar (indices n−period … n−1).
  let sumMax = 0;
  let sumMin = 0;
  for (let i = n - period; i < n; i++) {
    const deMax = bars[i].high > bars[i - 1].high ? bars[i].high - bars[i - 1].high : 0;
    const deMin = bars[i].low < bars[i - 1].low ? bars[i - 1].low - bars[i].low : 0;
    sumMax += deMax;
    sumMin += deMin;
  }

  const denom = sumMax + sumMin;
  const dem = denom === 0 ? 50 : (100 * sumMax) / denom;

  return { dem, zone: deMarkerZone(dem), n };
}

/** Build a sorted per-symbol DeMarker board, skipping symbols with too little history. */
export function deMarkerBoard(
  series: { symbol: string; bars: DeMarkerBar[] }[],
  sort: DeMarkerSort = 'dem',
  period = 14,
): DeMarkerRow[] {
  const rows: DeMarkerRow[] = [];
  for (const s of series) {
    const stats = computeDeMarker(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortDeMarker(rows, sort);
}

export function sortDeMarker(rows: DeMarkerRow[], sort: DeMarkerSort): DeMarkerRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'dem':
    default:
      out.sort((a, b) => b.dem - a.dem);
      break;
  }
  return out;
}
