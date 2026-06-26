/**
 * Parabolic SAR (Wilder, stop-and-reverse).
 *
 * An iterative trailing stop that flips side when price pierces it:
 *
 *   SAR_i = SAR_{i-1} + AF · (EP_{i-1} − SAR_{i-1})       // projected stop
 *   long:  SAR_i = min(SAR_i, low[i-1], low[i-2])         // clamp into prior 2 bars
 *   short: SAR_i = max(SAR_i, high[i-1], high[i-2])
 *
 * The extreme point (EP) tracks the trend's high-water (long) or low-water
 * (short) mark; the acceleration factor (AF) steps up by `afStep` on each new
 * extreme (capped at `afMax`), tightening the stop. When the low (long) or high
 * (short) crosses the SAR the position reverses: SAR jumps to the prior EP, EP
 * resets to the piercing extreme and AF resets to `af0`.
 *
 * We seed deterministically from the first two bars and report the latest bar's
 * stop, side, EP, AF, a fresh-flip flag and the signed distance of the close
 * from the stop. Needs at least 3 bars. A trailing-stop trend system, the
 * iterative complement to the ATR-band Supertrend (SUPER).
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-simulated bars.
 * (The algorithm and the hand-computed test fixtures were adversarially verified.)
 */

/** Minimal OHLC bar. */
export interface SarBar {
  high: number;
  low: number;
  close: number;
}

export type SarSide = 'long' | 'short';

export interface SarStats {
  /** Latest SAR (stop) level. */
  sar: number;
  /** Current side: long (dots below price) / short (dots above). */
  side: SarSide;
  /** Current acceleration factor (trend maturity). */
  af: number;
  /** Current extreme point. */
  ep: number;
  /** The SAR reversed on the latest bar. */
  flip: boolean;
  /** Signed % distance of the close from the stop (long > 0, short < 0 in a healthy trend). */
  dist: number;
  /** Number of bars supplied. */
  n: number;
}

export interface SarRow extends SarStats {
  symbol: string;
}

export type SarSort = 'dist' | 'side' | 'symbol';

/**
 * Compute the latest Parabolic SAR reading for one symbol. Needs at least 3
 * bars (two to seed, one to iterate); returns null otherwise.
 */
export function computeParabolicSar(bars: SarBar[], af0 = 0.02, afStep = 0.02, afMax = 0.2): SarStats | null {
  const n = bars.length;
  if (af0 <= 0 || afStep <= 0 || afMax <= 0 || n < 3) return null;

  // Seed from the first two bars.
  let side: SarSide = bars[1].close >= bars[0].close ? 'long' : 'short';
  let sar = side === 'long' ? bars[0].low : bars[0].high;
  let ep = side === 'long' ? bars[1].high : bars[1].low;
  let af = af0;
  let flip = false;

  for (let i = 2; i < n; i++) {
    const cur = bars[i];
    flip = false;

    // Projected stop from the prior carried state, then clamp into the prior 2 bars.
    let next = sar + af * (ep - sar);
    if (side === 'long') next = Math.min(next, bars[i - 1].low, bars[i - 2].low);
    else next = Math.max(next, bars[i - 1].high, bars[i - 2].high);

    if (side === 'long' && cur.low < next) {
      // Reverse to short: SAR jumps to the prior EP.
      side = 'short';
      sar = ep;
      ep = cur.low;
      af = af0;
      flip = true;
    } else if (side === 'short' && cur.high > next) {
      side = 'long';
      sar = ep;
      ep = cur.high;
      af = af0;
      flip = true;
    } else {
      sar = next;
      // Advance EP / AF on a new extreme.
      if (side === 'long') {
        if (cur.high > ep) {
          ep = cur.high;
          af = Math.min(afMax, af + afStep);
        }
      } else if (cur.low < ep) {
        ep = cur.low;
        af = Math.min(afMax, af + afStep);
      }
    }
  }

  const close = bars[n - 1].close;
  const dist = close !== 0 ? ((close - sar) / close) * 100 : 0;
  return { sar, side, af, ep, flip, dist, n };
}

/** Build a sorted per-symbol Parabolic SAR board, skipping symbols with too little history. */
export function parabolicSarBoard(
  series: { symbol: string; bars: SarBar[] }[],
  sort: SarSort = 'dist',
  af0 = 0.02,
  afStep = 0.02,
  afMax = 0.2,
): SarRow[] {
  const rows: SarRow[] = [];
  for (const s of series) {
    const stats = computeParabolicSar(s.bars, af0, afStep, afMax);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortSar(rows, sort);
}

export function sortSar(rows: SarRow[], sort: SarSort): SarRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'side':
      // Longs first, then by distance from the stop.
      out.sort((a, b) => (a.side === b.side ? b.dist - a.dist : a.side === 'long' ? -1 : 1));
      break;
    case 'dist':
    default:
      out.sort((a, b) => b.dist - a.dist);
      break;
  }
  return out;
}
