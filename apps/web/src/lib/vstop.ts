/**
 * Wilder Volatility System — volatility-stop (VSTOP) screener helpers.
 *
 * The canonical computable form is TradingView's `ta.vstop`: a ratcheting
 * trailing stop set a multiple of ATR away from price. Carrying state
 * (max, min, uptrend, stop) bar by bar, with ATR length `atrLength` and
 * multiplier `factor`:
 *
 *   atrM    = factor · ATR(atrLength)              (Wilder RMA of true range)
 *   max     = max(max, close);  min = min(min, close)
 *   stop    = uptrend ? max(stop, max − atrM)      (ratchet using the PRIOR
 *                     : min(stop, min + atrM)       bar's trend, before re-test)
 *   uptrend = (close − stop) ≥ 0                    (then re-evaluate the trend)
 *   on a flip (uptrend changed): max = min = close,
 *           stop = uptrend ? close − atrM : close + atrM
 *
 * The stop only tightens within a leg (rises through an up-leg, falls through a
 * down-leg) and jumps to the other side of price when the trend flips. Price at
 * or above the stop is long / up-trend, below is short / down-trend; `distPct`
 * is the signed cushion from price to the stop.
 *
 * To reproduce `ta.vstop` bit-for-bit the recursion runs from the first bar with
 * `atrM = nz(factor·ATR, trueRange)` — the raw true range stands in for the
 * multiple while Wilder's ATR is still seeding — and the stop seeds on its first
 * bar by direct assignment (no ratchet against a prior level). Reuses the shared
 * `trueRanges` helper and the same SMA-seeded Wilder ATR as the Supertrend /
 * Chande-Kroll boards.
 *
 * Defaults follow TradingView ta.vstop (length 20, factor 2); Wilder's classic
 * 1978 Volatility System used a tighter ATR (~7) with an ARC multiple (~3),
 * which the module offers as a faster preset.
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */
import { trueRanges, type RangeBar } from './range';

export type VstopBar = RangeBar;
export type VstopDir = 'long' | 'short';
export type VstopFlip = 'toLong' | 'toShort' | 'none';

export interface VstopStats {
  /** Trend side at the latest bar. */
  dir: VstopDir;
  /** Latest volatility-stop level. */
  stop: number;
  /** Signed distance from price to the stop, as a % of price (≥0 long, ≤0 short). */
  distPct: number;
  /** Trend change on the latest bar, if any. */
  flip: VstopFlip;
  /** Number of bars supplied. */
  n: number;
}

export interface VstopRow extends VstopStats {
  symbol: string;
}

export type VstopSort = 'distPct' | 'symbol';

/** Wilder (RMA) ATR over the true-range series — SMA-seeded at index period−1, NaN before. */
function wilderAtr(tr: number[], period: number): number[] {
  const n = tr.length;
  const atr = new Array<number>(n).fill(NaN);
  if (n < period) return atr;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += tr[i];
  atr[period - 1] = seed / period;
  for (let i = period; i < n; i++) atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  return atr;
}

/**
 * Compute the latest volatility stop (ta.vstop) for one symbol. Needs at least
 * `atrLength + 1` bars so Wilder's ATR is seeded and the stop has ratcheted past
 * the burn-in; returns null on bad params or too little history.
 */
export function computeVstop(bars: VstopBar[], atrLength = 20, factor = 2): VstopStats | null {
  if (atrLength < 1 || factor <= 0) return null;
  const n = bars.length;
  if (n < atrLength + 1) return null;

  const tr = trueRanges(bars);
  const atr = wilderAtr(tr, atrLength);

  let max: number = bars[0].close;
  let min: number = bars[0].close;
  let uptrend: boolean = true;
  let stop: number = NaN;
  let flip: VstopFlip = 'none';

  for (let i = 0; i < n; i++) {
    const c = bars[i].close;
    // Pine nz(factor·ATR, trueRange): raw TR stands in until Wilder's ATR seeds.
    const atrM = Number.isNaN(atr[i]) ? tr[i] : factor * atr[i];
    if (c > max) max = c;
    if (c < min) min = c;
    // Capture the prior-bar trend, then ratchet against it; the first bar seeds
    // the stop by direct assignment (no prior level to ratchet against).
    const prevUptrend: boolean = uptrend;
    const target: number = prevUptrend ? max - atrM : min + atrM;
    let nextStop: number = Number.isNaN(stop)
      ? target
      : prevUptrend
        ? Math.max(stop, target)
        : Math.min(stop, target);
    const nextUptrend: boolean = c - nextStop >= 0;
    if (nextUptrend !== prevUptrend) {
      // Trend flipped: re-anchor the running extremes and jump the stop across price.
      max = c;
      min = c;
      nextStop = nextUptrend ? c - atrM : c + atrM;
      flip = nextUptrend ? 'toLong' : 'toShort';
    } else {
      flip = 'none';
    }
    stop = nextStop;
    uptrend = nextUptrend;
  }

  const close = bars[n - 1].close;
  return {
    dir: uptrend ? 'long' : 'short',
    stop,
    distPct: close > 0 ? ((close - stop) / close) * 100 : 0,
    flip,
    n,
  };
}

/** Build a sorted per-symbol volatility-stop board, skipping thin history. */
export function vstopBoard(
  series: { symbol: string; bars: VstopBar[] }[],
  sort: VstopSort = 'distPct',
  atrLength = 20,
  factor = 2,
): VstopRow[] {
  const rows: VstopRow[] = [];
  for (const s of series) {
    const stats = computeVstop(s.bars, atrLength, factor);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortVstop(rows, sort);
}

export function sortVstop(rows: VstopRow[], sort: VstopSort): VstopRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'distPct':
    default:
      // Strongest long cushion (price far above its stop) first, deepest short last.
      out.sort((a, b) => b.distPct - a.distPct);
      break;
  }
  return out;
}
