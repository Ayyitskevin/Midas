/**
 * Vortex indicator (Botes & Siepman, 2010).
 *
 * Two oscillating lines built from directional "vortex movement" relative to
 * the true range:
 *
 *   +VM = |high − priorLow|,   −VM = |low − priorHigh|
 *   +VI = Σ(+VM, N) / Σ(TR, N),  −VI = Σ(−VM, N) / Σ(TR, N)
 *
 * +VI above −VI is an uptrend; −VI above +VI a downtrend; the lines crossing is
 * the trigger. A trend-direction board, distinct from ADX (strength only),
 * Aroon (time-since-extreme) and Supertrend (ATR trailing stop).
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */

/** Minimal OHLC bar (no open needed). */
export interface VtxBar {
  high: number;
  low: number;
  close: number;
}

export type VtxTrend = 'up' | 'down';
export type VtxCross = 'bull' | 'bear' | 'none';

export interface VtxStats {
  /** +VI (positive vortex line). */
  plus: number;
  /** −VI (negative vortex line). */
  minus: number;
  /** +VI − −VI (signed trend strength). */
  diff: number;
  /** Which line leads. */
  trend: VtxTrend;
  /** Fresh +VI / −VI crossover on the latest bar. */
  cross: VtxCross;
  /** Number of bars supplied. */
  n: number;
}

export interface VtxRow extends VtxStats {
  symbol: string;
}

export type VtxSort = 'diff' | 'plus' | 'symbol';

/**
 * Compute the aligned +VI and −VI series. Returns null with too little history
 * (needs more than `period` bars). A flat (zero true range) window maps both
 * lines to 1 rather than dividing by zero.
 */
export function vortexSeries(bars: VtxBar[], period = 14): { plus: number[]; minus: number[] } | null {
  const n = bars.length;
  if (period < 1 || n < period + 1) return null;

  // Per-bar vortex movement and true range (each needs a predecessor → from i=1).
  const vmPlus: number[] = [];
  const vmMinus: number[] = [];
  const tr: number[] = [];
  for (let i = 1; i < n; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    vmPlus.push(Math.abs(cur.high - prev.low));
    vmMinus.push(Math.abs(cur.low - prev.high));
    tr.push(Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close)));
  }

  const plus: number[] = [];
  const minus: number[] = [];
  const m = vmPlus.length;
  for (let e = period - 1; e < m; e++) {
    let sp = 0;
    let sm = 0;
    let st = 0;
    for (let j = e - period + 1; j <= e; j++) {
      sp += vmPlus[j];
      sm += vmMinus[j];
      st += tr[j];
    }
    if (st > 0) {
      plus.push(sp / st);
      minus.push(sm / st);
    } else {
      plus.push(1);
      minus.push(1);
    }
  }

  if (plus.length === 0) return null;
  return { plus, minus };
}

/**
 * Compute the latest Vortex reading for one symbol. Needs at least `period + 2`
 * bars to detect a crossover; with exactly `period + 1` it reports the lines
 * and trend but `cross` is 'none'.
 */
export function computeVortex(bars: VtxBar[], period = 14): VtxStats | null {
  const s = vortexSeries(bars, period);
  if (!s) return null;
  const { plus, minus } = s;

  const p = plus[plus.length - 1];
  const mi = minus[minus.length - 1];

  let cross: VtxCross = 'none';
  if (plus.length >= 2) {
    const pPrev = plus[plus.length - 2];
    const miPrev = minus[minus.length - 2];
    if (pPrev <= miPrev && p > mi) cross = 'bull';
    else if (pPrev >= miPrev && p < mi) cross = 'bear';
  }

  return { plus: p, minus: mi, diff: p - mi, trend: p >= mi ? 'up' : 'down', cross, n: bars.length };
}

/** Build a sorted per-symbol Vortex board, skipping symbols with too little history. */
export function vortexBoard(
  series: { symbol: string; bars: VtxBar[] }[],
  sort: VtxSort = 'diff',
  period = 14,
): VtxRow[] {
  const rows: VtxRow[] = [];
  for (const s of series) {
    const stats = computeVortex(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortVtx(rows, sort);
}

export function sortVtx(rows: VtxRow[], sort: VtxSort): VtxRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'plus':
      out.sort((a, b) => b.plus - a.plus);
      break;
    case 'diff':
    default:
      out.sort((a, b) => b.diff - a.diff);
      break;
  }
  return out;
}
