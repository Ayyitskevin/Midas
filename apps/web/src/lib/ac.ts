/**
 * Accelerator Oscillator (AC) screener helpers.
 *
 * Bill Williams' Accelerator Oscillator measures the *acceleration* of momentum
 * — the Awesome Oscillator versus its own moving average:
 *
 *   AC = AO − SMA(AO, signal),   AO = SMA(median, fast) − SMA(median, slow)
 *
 * on the median price ((high + low) / 2). Williams' defaults are fast 5, slow
 * 34, signal 5.
 *
 * AC leads the AO: because force precedes price, acceleration turns before
 * momentum does, so AC changing sign is an earlier signal than the AO's zero
 * cross. Each histogram bar is green when AC rises versus the prior bar and red
 * when it falls — Williams' rule is to buy only on green bars, sell only on red.
 *
 * AC is in price units (a difference of price-scale oscillators), so the raw
 * value is not comparable across symbols; the board ranks on acPct = 100·AC /
 * median, which cancels the price scale. Pure and synchronous; reuses the AO
 * board's trailing-SMA core.
 */
import { smaSeries } from './ao';

/** Minimal bar (the AC works on the median (high + low) / 2). */
export interface AcBar {
  high: number;
  low: number;
}

/** Green bar = AC rose vs the prior bar (acceleration building); red = it fell. */
export type AcBarColor = 'up' | 'down';

export interface AcStats {
  /** Raw Accelerator Oscillator (price units). */
  ac: number;
  /** AC as a percent of the median price (signed, scale-invariant). */
  acPct: number;
  /** Histogram bar colour: rose (up) or fell (down) vs the prior bar. */
  bar: AcBarColor;
  /** Number of bars supplied. */
  n: number;
}

export interface AcRow extends AcStats {
  symbol: string;
}

export type AcSort = 'ac' | 'symbol';

/**
 * Accelerator Oscillator series aligned to the input (NaN until it exists):
 * AC[i] = AO[i] − SMA(AO, signal)[i], with AO = SMA(median, fast) −
 * SMA(median, slow). The AO is finite and contiguous from index slow−1 (slow >
 * fast ⇒ both SMAs exist there), so its valid tail is sliced off before the
 * signal SMA — smaSeries is not NaN-safe and a leading NaN would poison it.
 */
export function acRawSeries(
  median: number[],
  fast: number,
  slow: number,
  signal: number,
): number[] {
  const n = median.length;
  const out = new Array<number>(n).fill(NaN);
  if (fast < 1 || slow < 1 || signal < 1 || fast >= slow) return out;

  const fastMa = smaSeries(median, fast);
  const slowMa = smaSeries(median, slow);

  const start = slow - 1; // first index where AO exists
  const ao = new Array<number>(n).fill(NaN);
  for (let i = start; i < n; i++) ao[i] = fastMa[i] - slowMa[i];

  const sig = smaSeries(ao.slice(start), signal);
  for (let j = signal - 1; j < sig.length; j++) out[start + j] = ao[start + j] - sig[j];

  return out;
}

/**
 * Compute the latest Accelerator Oscillator reading for one symbol. Needs at
 * least slow + signal bars (so the AC and its prior bar both exist); returns
 * null on bad params or too little history.
 */
export function computeAc(bars: AcBar[], fast = 5, slow = 34, signal = 5): AcStats | null {
  const n = bars.length;
  if (fast < 1 || slow < 1 || signal < 1 || fast >= slow || n < slow + signal) return null;

  const median = bars.map((b) => (b.high + b.low) / 2);
  const ac = acRawSeries(median, fast, slow, signal);

  const last = n - 1;
  const acNow = ac[last];
  const acPrev = ac[last - 1];
  if (!Number.isFinite(acNow) || !Number.isFinite(acPrev)) return null;

  const price = median[last];
  const acPct = price === 0 ? 0 : (100 * acNow) / price;
  const bar: AcBarColor = acNow >= acPrev ? 'up' : 'down';

  return { ac: acNow, acPct, bar, n };
}

/** Build a sorted per-symbol Accelerator Oscillator board, skipping symbols with too little history. */
export function acBoard(
  series: { symbol: string; bars: AcBar[] }[],
  sort: AcSort = 'ac',
  fast = 5,
  slow = 34,
  signal = 5,
): AcRow[] {
  const rows: AcRow[] = [];
  for (const s of series) {
    const stats = computeAc(s.bars, fast, slow, signal);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortAc(rows, sort);
}

export function sortAc(rows: AcRow[], sort: AcSort): AcRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'ac':
    default:
      out.sort((a, b) => b.acPct - a.acPct);
      break;
  }
  return out;
}
