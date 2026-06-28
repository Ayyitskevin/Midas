/**
 * Awesome Oscillator (AO) screener helpers.
 *
 * Bill Williams' Awesome Oscillator is the difference of two simple moving
 * averages of the median price ((high + low) / 2) — a zero-line momentum
 * histogram of the market's "force":
 *
 *   AO = SMA(median, fast) − SMA(median, slow)
 *
 * Defaults fast 5, slow 34. Above zero = bullish momentum, below = bearish; each
 * histogram bar is coloured green when AO rises versus the prior bar and red when
 * it falls (the basis of the saucer and twin-peaks signals).
 *
 * AO is in price units (a difference of price SMAs), so the raw value is not
 * comparable across symbols; the board ranks on aoPct = 100·AO / median, which
 * cancels the price scale. Pure and synchronous.
 */

/** Minimal bar (the AO works on the median (high + low) / 2). */
export interface AoBar {
  high: number;
  low: number;
}

/** Trailing simple moving average, aligned to input (NaN before period−1). */
export function smaSeries(values: number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  if (period < 1 || n < period) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Green bar = AO rose vs the prior bar (momentum building); red = it fell. */
export type AoBarColor = 'up' | 'down';

export interface AoStats {
  /** Raw Awesome Oscillator (price units). */
  ao: number;
  /** AO as a percent of the median price (signed, scale-invariant). */
  aoPct: number;
  /** Histogram bar colour: rose (up) or fell (down) vs the prior bar. */
  bar: AoBarColor;
  /** Number of bars supplied. */
  n: number;
}

export interface AoRow extends AoStats {
  symbol: string;
}

export type AoSort = 'ao' | 'symbol';

/**
 * Compute the latest Awesome Oscillator reading for one symbol. Needs at least
 * slow + 1 bars (so the AO and its prior bar both exist); returns null on bad
 * params or too little history.
 */
export function computeAo(bars: AoBar[], fast = 5, slow = 34): AoStats | null {
  const n = bars.length;
  if (fast < 1 || slow < 1 || fast >= slow || n < slow + 1) return null;

  const median = bars.map((b) => (b.high + b.low) / 2);
  const fastMa = smaSeries(median, fast);
  const slowMa = smaSeries(median, slow);

  const last = n - 1;
  const ao = fastMa[last] - slowMa[last];
  const aoPrev = fastMa[last - 1] - slowMa[last - 1];
  if (!Number.isFinite(ao) || !Number.isFinite(aoPrev)) return null;

  const price = median[last];
  const aoPct = price === 0 ? 0 : (100 * ao) / price;
  const bar: AoBarColor = ao >= aoPrev ? 'up' : 'down';

  return { ao, aoPct, bar, n };
}

/** Build a sorted per-symbol Awesome Oscillator board, skipping symbols with too little history. */
export function aoBoard(
  series: { symbol: string; bars: AoBar[] }[],
  sort: AoSort = 'ao',
  fast = 5,
  slow = 34,
): AoRow[] {
  const rows: AoRow[] = [];
  for (const s of series) {
    const stats = computeAo(s.bars, fast, slow);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortAo(rows, sort);
}

export function sortAo(rows: AoRow[], sort: AoSort): AoRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'ao':
    default:
      out.sort((a, b) => b.aoPct - a.aoPct);
      break;
  }
  return out;
}
