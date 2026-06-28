/**
 * Ehlers Center of Gravity (CG) oscillator screener helpers.
 *
 * John Ehlers' Center of Gravity oscillator (Cybernetic Analysis for Stocks and
 * Futures, 2004). It treats the last N median prices as a physical mass
 * distribution and reports where their centre of gravity sits relative to the
 * window's midpoint — a smoothed, near-zero-lag oscillator built to call turns:
 *
 *   price = (high + low) / 2
 *   Num   = Σ_{k=0}^{N−1} (1 + k)·price[k]      // price[k] = k bars ago (current = 0)
 *   Den   = Σ_{k=0}^{N−1} price[k]
 *   CG    = −Num / Den + (N + 1) / 2
 *
 * The −Num/Den term is the price-weighted average bar index (1…N); subtracting it
 * from (N+1)/2 centres the result on zero, so CG swings within ±(N−1)/2. Because
 * Num/Den is a ratio of prices it is dimensionless — the oscillator is inherently
 * scale-invariant and ranks cleanly across symbols with no normalization. The
 * trigger is the prior bar's CG, so a CG-vs-trigger cross is a turn.
 *
 * Pure, synchronous, and a single closed form (no recursion), so it is
 * unit-tested against exact hand-computed medians.
 */

/** Minimal bar (CG uses the median (high + low) / 2). */
export interface CgBar {
  high: number;
  low: number;
}

export type CgCross = 'bull' | 'bear' | 'none';

export interface CgStats {
  /** Latest Center of Gravity value (bounded ±(length−1)/2, centred on 0). */
  cg: number;
  /** Trigger line = the prior bar's CG. */
  trigger: number;
  /** Fresh CG turn relative to its trigger on the latest bar. */
  cross: CgCross;
  /** Number of bars supplied. */
  n: number;
}

export interface CgRow extends CgStats {
  symbol: string;
}

export type CgSort = 'cg' | 'symbol';

/**
 * Compute the latest Center of Gravity reading for one symbol. Needs at least
 * `length` bars (one window); returns null otherwise. The trigger falls back to
 * the CG itself when only one reading exists, and `cross` needs three readings.
 */
export function computeCg(bars: CgBar[], length = 10): CgStats | null {
  const n = bars.length;
  if (length < 1 || n < length) return null;

  const med = bars.map((b) => (b.high + b.low) / 2);
  const series: number[] = [];
  for (let i = length - 1; i < n; i++) {
    let num = 0;
    let den = 0;
    for (let k = 0; k < length; k++) {
      const p = med[i - k]; // k bars ago
      num += (1 + k) * p;
      den += p;
    }
    series.push(den === 0 ? 0 : -num / den + (length + 1) / 2);
  }

  const last = series.length - 1;
  const cg = series[last];
  const trigger = last >= 1 ? series[last - 1] : cg;

  let cross: CgCross = 'none';
  if (series.length >= 3) {
    const cgPrev = series[last - 1];
    const cgPrev2 = series[last - 2];
    if (cgPrev <= cgPrev2 && cg > cgPrev) cross = 'bull';
    else if (cgPrev >= cgPrev2 && cg < cgPrev) cross = 'bear';
  }

  return { cg, trigger, cross, n };
}

/** Build a sorted per-symbol Center of Gravity board, skipping symbols with too little history. */
export function cgBoard(
  series: { symbol: string; bars: CgBar[] }[],
  sort: CgSort = 'cg',
  length = 10,
): CgRow[] {
  const rows: CgRow[] = [];
  for (const s of series) {
    const stats = computeCg(s.bars, length);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortCg(rows, sort);
}

export function sortCg(rows: CgRow[], sort: CgSort): CgRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'cg':
    default:
      out.sort((a, b) => b.cg - a.cg);
      break;
  }
  return out;
}
