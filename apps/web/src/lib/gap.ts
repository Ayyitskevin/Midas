/**
 * Gap analytics.
 *
 * A "gap" is the jump from one daily candle's open to the prior candle's
 * close — in a 24/7 crypto market that's the move across the UTC daily roll:
 *
 *   gap%[t] = (open[t] − close[t−1]) / close[t−1] × 100
 *
 * Per symbol we summarise the gap history:
 *   - today    the latest day's gap %
 *   - avgAbs   the mean absolute gap %, i.e. the typical gap size
 *   - up/down  counts of gap-up vs gap-down days
 *   - fillRate share of directional gaps that "fill" the same day — a gap-up
 *              fills if the day's low trades back to the prior close, a
 *              gap-down fills if the day's high does
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed
 * candles.
 */

/** Minimal OHLC needed for gap analytics. */
export interface GapBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface GapStats {
  /** Latest day's gap %. */
  today: number;
  /** Mean absolute gap % across all day-over-day transitions. */
  avgAbs: number;
  /** Count of gap-up days (open above prior close). */
  up: number;
  /** Count of gap-down days (open below prior close). */
  down: number;
  /** Share of directional gaps filled the same day (0..1). */
  fillRate: number;
  /** Directional gaps counted (up + down) — the fillRate denominator. */
  gaps: number;
  /** Number of day-over-day transitions used. */
  n: number;
}

export interface GapRow extends GapStats {
  symbol: string;
}

export type GapSort = 'today' | 'avgAbs' | 'fillRate' | 'symbol';

const MIN_BARS = 2;

/**
 * Compute gap stats for one symbol. Returns null when there are too few bars
 * or no usable transitions (e.g. a non-positive prior close throughout).
 */
export function computeGaps(bars: GapBar[]): GapStats | null {
  if (bars.length < MIN_BARS) return null;
  let sumAbs = 0;
  let up = 0;
  let down = 0;
  let filled = 0;
  let transitions = 0;
  let today = 0;
  for (let i = 1; i < bars.length; i++) {
    const prevClose = bars[i - 1].close;
    if (prevClose <= 0) continue;
    const b = bars[i];
    const gapPct = ((b.open - prevClose) / prevClose) * 100;
    transitions += 1;
    sumAbs += Math.abs(gapPct);
    today = gapPct; // last transition wins
    if (b.open > prevClose) {
      up += 1;
      if (b.low <= prevClose) filled += 1; // traded back down to the prior close
    } else if (b.open < prevClose) {
      down += 1;
      if (b.high >= prevClose) filled += 1; // traded back up to the prior close
    }
  }
  if (transitions === 0) return null;
  const gaps = up + down;
  return {
    today,
    avgAbs: sumAbs / transitions,
    up,
    down,
    fillRate: gaps > 0 ? filled / gaps : 0,
    gaps,
    n: transitions,
  };
}

/** Build a sorted per-symbol gap board, skipping symbols with too little history. */
export function gapBoard(series: { symbol: string; bars: GapBar[] }[], sort: GapSort = 'today'): GapRow[] {
  const rows: GapRow[] = [];
  for (const s of series) {
    const stats = computeGaps(s.bars);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortGaps(rows, sort);
}

export function sortGaps(rows: GapRow[], sort: GapSort): GapRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'avgAbs':
      out.sort((a, b) => b.avgAbs - a.avgAbs);
      break;
    case 'fillRate':
      out.sort((a, b) => b.fillRate - a.fillRate);
      break;
    case 'today':
    default:
      // Biggest gap today first, regardless of direction.
      out.sort((a, b) => Math.abs(b.today) - Math.abs(a.today));
      break;
  }
  return out;
}
