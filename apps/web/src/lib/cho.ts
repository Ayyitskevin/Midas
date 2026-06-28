/**
 * Chaikin Oscillator (CHO) screener helpers.
 *
 * Marc Chaikin's oscillator is the momentum of the Accumulation/Distribution
 * Line (ADL) — the difference of two EMAs of that cumulative volume-flow line:
 *
 *   ADL = running cumulative sum of (moneyFlowMultiplier · volume)
 *   CHO = EMA(ADL, fast) − EMA(ADL, slow)
 *
 * Williams/Chaikin defaults are fast 3, slow 10. It applies the MACD idea to
 * volume flow rather than price: above zero, accumulation momentum is building
 * (the ADL's short EMA leads its long EMA); below zero, distribution. Zero-line
 * crossovers and divergence from price are the classic signals, and each bar is
 * green when the oscillator rises versus the prior bar, red when it falls.
 *
 * Because the ADL scales with a symbol's volume, the raw CHO is not comparable
 * across symbols; the board ranks on choNorm = CHO ÷ average volume, which
 * cancels the volume scale (and is already price-scale-free, since the money
 * flow multiplier is a ratio of price distances) — the same volume-normalised
 * convention as the Klinger (KVO) board. Pure and synchronous; reuses the ADL
 * board's money-flow multiplier and the shared EMA core.
 */
import { moneyFlowMultiplier } from './adl';
import { emaSeries } from './indicators';

/** OHLCV bar (the CHO reads where the close sits in the range, weighted by volume). */
export interface ChoBar {
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Green bar = CHO rose vs the prior bar (accumulation building); red = it fell. */
export type ChoBarColor = 'up' | 'down';

export interface ChoStats {
  /** Raw Chaikin Oscillator at the latest bar (volume units). */
  cho: number;
  /** CHO ÷ average volume — signed, comparable across symbols. */
  choNorm: number;
  /** Histogram bar colour: rose (up) or fell (down) vs the prior bar. */
  bar: ChoBarColor;
  /** Number of bars supplied. */
  n: number;
}

export interface ChoRow extends ChoStats {
  symbol: string;
}

export type ChoSort = 'cho' | 'symbol';

/**
 * Accumulation/Distribution Line aligned to the input: the running cumulative
 * sum of moneyFlowMultiplier(bar) · volume. Reuses the ADL board's multiplier.
 */
export function adlSeries(bars: ChoBar[]): number[] {
  const out = new Array<number>(bars.length);
  let cum = 0;
  for (let i = 0; i < bars.length; i++) {
    cum += moneyFlowMultiplier(bars[i]) * bars[i].volume;
    out[i] = cum;
  }
  return out;
}

/**
 * Compute the latest Chaikin Oscillator for one symbol. Needs at least slow + 1
 * bars (so the CHO and its prior bar both exist); returns null on bad params or
 * too little history. The EMAs are seeded from the first bar (shared emaSeries),
 * so both warm up over the supplied window — the daily board feeds ~1y.
 */
export function computeCho(bars: ChoBar[], fast = 3, slow = 10): ChoStats | null {
  const n = bars.length;
  if (fast < 1 || slow < 1 || fast >= slow || n < slow + 1) return null;

  const adl = adlSeries(bars);
  const emaFast = emaSeries(adl, fast);
  const emaSlow = emaSeries(adl, slow);

  const last = n - 1;
  const cho = emaFast[last] - emaSlow[last];
  const choPrev = emaFast[last - 1] - emaSlow[last - 1];
  if (!Number.isFinite(cho) || !Number.isFinite(choPrev)) return null;

  let vsum = 0;
  for (const b of bars) vsum += b.volume;
  const avgVol = vsum / n;
  const choNorm = avgVol > 0 ? cho / avgVol : 0;
  const bar: ChoBarColor = cho >= choPrev ? 'up' : 'down';

  return { cho, choNorm, bar, n };
}

/** Build a sorted per-symbol Chaikin Oscillator board, skipping symbols with too little history. */
export function choBoard(
  series: { symbol: string; bars: ChoBar[] }[],
  sort: ChoSort = 'cho',
  fast = 3,
  slow = 10,
): ChoRow[] {
  const rows: ChoRow[] = [];
  for (const s of series) {
    const stats = computeCho(s.bars, fast, slow);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortCho(rows, sort);
}

export function sortCho(rows: ChoRow[], sort: ChoSort): ChoRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'cho':
    default:
      // Volume-normalised so symbols compare; most bullish (accumulation) first.
      out.sort((a, b) => b.choNorm - a.choNorm);
      break;
  }
  return out;
}
