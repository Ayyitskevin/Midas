/**
 * Price Volume Trend (PVT).
 *
 * A cumulative volume line like OBV, but each bar adds volume *scaled by the
 * size* of the price move rather than its whole amount by direction:
 *
 *   PVT = running cumulative sum of  ((close − priorClose) / priorClose) · volume
 *
 * A big move on volume moves the line more than a small one. The raw cumulative
 * level isn't comparable across symbols, so the board reports the line's
 * behaviour over the last N bars: its normalized slope (the move ÷ window
 * volume = a volume-weighted % return), its trend, and whether the line just
 * made a new N-bar high / low. Distinct from OBV (whole volume by close
 * direction) and the A/D line (intrabar range position).
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */

/** Bar with close + volume. */
export interface PvtBar {
  close: number;
  volume: number;
}

export type PvtTrend = 'up' | 'down';
export type PvtExtreme = 'high' | 'low' | 'none';

export interface PvtStats {
  /** Latest cumulative PVT value. */
  pvt: number;
  /** Normalized slope over the last N bars (volume-weighted % return). */
  slopePct: number;
  /** PVT rose or fell over the window. */
  trend: PvtTrend;
  /** PVT at a fresh N-bar high / low. */
  extreme: PvtExtreme;
  /** Number of bars supplied. */
  n: number;
}

export interface PvtRow extends PvtStats {
  symbol: string;
}

export type PvtSort = 'slope' | 'symbol';

/**
 * Compute the latest PVT reading for one symbol. Needs `period + 1` bars (to
 * measure the line's change over the window); returns null otherwise.
 */
export function computePvt(bars: PvtBar[], period = 20): PvtStats | null {
  const n = bars.length;
  if (period < 1 || n < period + 1) return null;

  // Cumulative PVT line (starts at 0; each bar needs a prior close).
  const line: number[] = [0];
  for (let i = 1; i < n; i++) {
    const prev = bars[i - 1].close;
    const inc = prev !== 0 ? ((bars[i].close - prev) / prev) * bars[i].volume : 0;
    line.push(line[i - 1] + inc);
  }

  const pvt = line[n - 1];
  const startIdx = n - 1 - period;
  const change = pvt - line[startIdx];

  let windowVol = 0;
  for (let i = n - period; i < n; i++) windowVol += bars[i].volume;

  let maxPrev = -Infinity;
  let minPrev = Infinity;
  for (let i = startIdx; i < n - 1; i++) {
    if (line[i] > maxPrev) maxPrev = line[i];
    if (line[i] < minPrev) minPrev = line[i];
  }
  const extreme: PvtExtreme = pvt > maxPrev ? 'high' : pvt < minPrev ? 'low' : 'none';

  return {
    pvt,
    slopePct: windowVol > 0 ? (change / windowVol) * 100 : 0,
    trend: change >= 0 ? 'up' : 'down',
    extreme,
    n,
  };
}

/** Build a sorted per-symbol PVT board, skipping symbols with too little history. */
export function pvtBoard(
  series: { symbol: string; bars: PvtBar[] }[],
  sort: PvtSort = 'slope',
  period = 20,
): PvtRow[] {
  const rows: PvtRow[] = [];
  for (const s of series) {
    const stats = computePvt(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortPvt(rows, sort);
}

export function sortPvt(rows: PvtRow[], sort: PvtSort): PvtRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'slope':
    default:
      out.sort((a, b) => b.slopePct - a.slopePct);
      break;
  }
  return out;
}
