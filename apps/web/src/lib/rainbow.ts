/**
 * Rainbow Oscillator screener helpers.
 *
 * Mel Widner's Rainbow Charts (Stocks & Commodities, 1997) build a "rainbow" of
 * recursively-smoothed 2-period SMAs of the close — band 1 = SMA(close, 2), and
 * each subsequent band is a 2-SMA of the previous, so they fan out from fast to
 * slow. Two readings come off it, each normalized by the recent price range:
 *
 *   bandAvg   = mean(band[1..bands]) at the latest bar
 *   range     = highestHigh(N) − lowestLow(N)
 *   RO        = 100 · (close − bandAvg) / range        (oscillator)
 *   bandwidth = 100 · (maxBand − minBand) / range      (trend strength)
 *
 * RO is positive when price sits above the rainbow average (uptrend), negative
 * below; the bandwidth widens in strong trends and narrows in consolidation.
 * The range normalizer uses the high/low price envelope over N bars (a close-
 * range normalizer is an alternative convention). Defaults: 10 bands, N = 10.
 */

export interface RainbowBar {
  high: number;
  low: number;
  close: number;
}

export interface RainbowStats {
  /** Rainbow Oscillator (≈ ±100, centred on 0). */
  ro: number;
  /** Rainbow Bandwidth (band spread as a % of the range). */
  bandwidth: number;
  /** Mean of the rainbow bands (the rainbow centre) at the latest bar. */
  bandAvg: number;
  /** Which side of the rainbow average price sits on. */
  side: 'above' | 'below';
  /** Number of bars supplied. */
  n: number;
}

export interface RainbowRow extends RainbowStats {
  symbol: string;
}

export type RainbowSort = 'ro' | 'bandwidth' | 'symbol';

/** 2-period SMA that propagates NaN warm-up, so recursive bands lose one bar each. */
function sma2(values: number[]): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  for (let i = 1; i < values.length; i++) {
    const a = values[i];
    const b = values[i - 1];
    if (!Number.isNaN(a) && !Number.isNaN(b)) out[i] = (a + b) / 2;
  }
  return out;
}

/**
 * Compute the latest Rainbow Oscillator for one symbol. Needs more than `bands`
 * bars so the deepest band exists, plus a full `lookback` window; returns null
 * otherwise.
 */
export function computeRainbow(bars: RainbowBar[], bands = 10, lookback = 10): RainbowStats | null {
  if (bands < 1 || lookback < 1) return null;
  const n = bars.length;
  if (n < bands + 1 || n < lookback) return null;

  // Build the rainbow: band[0] = SMA(close,2); band[k] = SMA(band[k-1],2).
  let prev = bars.map((b) => b.close);
  const lastBands: number[] = [];
  const last = n - 1;
  for (let k = 0; k < bands; k++) {
    prev = sma2(prev);
    lastBands.push(prev[last]);
  }

  let bandSum = 0;
  let highBand = -Infinity;
  let lowBand = Infinity;
  for (const v of lastBands) {
    bandSum += v;
    if (v > highBand) highBand = v;
    if (v < lowBand) lowBand = v;
  }
  const bandAvg = bandSum / bands;

  let hhv = -Infinity;
  let llv = Infinity;
  for (let i = last - lookback + 1; i <= last; i++) {
    if (bars[i].high > hhv) hhv = bars[i].high;
    if (bars[i].low < llv) llv = bars[i].low;
  }
  const range = hhv - llv;
  const close = bars[last].close;
  const ro = range > 0 ? (100 * (close - bandAvg)) / range : 0;
  const bandwidth = range > 0 ? (100 * (highBand - lowBand)) / range : 0;
  return { ro, bandwidth, bandAvg, side: ro >= 0 ? 'above' : 'below', n };
}

/** Build a sorted per-symbol Rainbow Oscillator board, skipping thin history. */
export function rainbowBoard(
  series: { symbol: string; bars: RainbowBar[] }[],
  sort: RainbowSort = 'ro',
  bands = 10,
  lookback = 10,
): RainbowRow[] {
  const rows: RainbowRow[] = [];
  for (const s of series) {
    const stats = computeRainbow(s.bars, bands, lookback);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortRainbow(rows, sort);
}

export function sortRainbow(rows: RainbowRow[], sort: RainbowSort): RainbowRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'bandwidth':
      out.sort((a, b) => b.bandwidth - a.bandwidth);
      break;
    case 'ro':
    default:
      out.sort((a, b) => b.ro - a.ro);
      break;
  }
  return out;
}
