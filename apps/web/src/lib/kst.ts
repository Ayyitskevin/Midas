/**
 * Know Sure Thing (Martin Pring).
 *
 * A "summed rate of change" momentum oscillator. Take four rate-of-change
 * series over different look-backs, smooth each with its own simple moving
 * average (an "RCMA" — rate-of-change MA), then add them with growing weights
 * so the slowest cycle counts most:
 *
 *   ROC(n)[i] = (close[i] − close[i−n]) / close[i−n] · 100
 *   RCMAₖ     = SMA( ROC(rocPeriodₖ), smaPeriodₖ )
 *   KST       = 1·RCMA₁ + 2·RCMA₂ + 3·RCMA₃ + 4·RCMA₄        (raw, NOT ÷ 10)
 *   signal    = SMA(KST, 9)
 *
 * KST oscillates around zero with no fixed bounds: above zero (and above its
 * signal) is bullish momentum, below is bearish, and signal-line crossovers are
 * the primary trigger. Pring's canonical daily set is rocPeriods [10,15,20,30],
 * smaPeriods [10,10,10,15], weights [1,2,3,4], signal 9 — verified against an
 * independent worked example. Pure and synchronous so it can be unit-tested.
 */

export const KST_ROC_PERIODS = [10, 15, 20, 30];
export const KST_SMA_PERIODS = [10, 10, 10, 15];
export const KST_WEIGHTS = [1, 2, 3, 4];
export const KST_SIGNAL = 9;

export type KstSide = 'pos' | 'neg';
export type KstDir = 'up' | 'down';

export interface KstStats {
  /** Know Sure Thing at the latest bar. */
  kst: number;
  /** Signal line (9-SMA of KST) at the latest bar. */
  signal: number;
  /** KST − signal (the histogram). */
  hist: number;
  /** KST above (up) or below (down) its signal line. */
  dir: KstDir;
  /** KST above (pos) or below (neg) the zero line. */
  side: KstSide;
  /** Number of closes supplied. */
  n: number;
}

export interface KstRow extends KstStats {
  symbol: string;
}

export type KstSort = 'kst' | 'hist' | 'symbol';

/**
 * Compute the latest Know Sure Thing for one symbol. Returns null with bad
 * params or too little history (needs max(rocₖ+smaₖ) + signalPeriod − 1 closes
 * so KST and its signal are both defined).
 */
export function computeKst(
  closes: number[],
  rocPeriods: number[] = KST_ROC_PERIODS,
  smaPeriods: number[] = KST_SMA_PERIODS,
  weights: number[] = KST_WEIGHTS,
  signalPeriod = KST_SIGNAL,
): KstStats | null {
  const k = rocPeriods.length;
  if (k === 0 || smaPeriods.length !== k || weights.length !== k || signalPeriod < 1) return null;
  if (rocPeriods.some((p, i) => p < 1 || smaPeriods[i] < 1)) return null;

  const n = closes.length;
  const firstKst = Math.max(...rocPeriods.map((r, i) => r + smaPeriods[i])) - 1; // earliest defined index
  if (n < firstKst + 1 + (signalPeriod - 1)) return null;

  // Each RCMA = simple MA of its ROC series, bar-indexed (NaN before defined).
  const rcmas: number[][] = [];
  for (let c = 0; c < k; c++) {
    const rp = rocPeriods[c];
    const sp = smaPeriods[c];
    const roc = new Array<number>(n).fill(NaN);
    for (let i = rp; i < n; i++) {
      const prev = closes[i - rp];
      roc[i] = prev !== 0 ? ((closes[i] - prev) / prev) * 100 : 0;
    }
    const rcma = new Array<number>(n).fill(NaN);
    for (let i = rp + sp - 1; i < n; i++) {
      let s = 0;
      for (let j = i - sp + 1; j <= i; j++) s += roc[j];
      rcma[i] = s / sp;
    }
    rcmas.push(rcma);
  }

  // Weighted-sum KST per bar (only where every RCMA is defined).
  const kstSeries = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let ok = true;
    for (let c = 0; c < k; c++) {
      const v = rcmas[c][i];
      if (Number.isNaN(v)) {
        ok = false;
        break;
      }
      sum += weights[c] * v;
    }
    if (ok) kstSeries[i] = sum;
  }

  const last = n - 1;
  if (Number.isNaN(kstSeries[last])) return null;

  // Signal = SMA of the last signalPeriod KST values.
  let s = 0;
  for (let j = last - signalPeriod + 1; j <= last; j++) {
    if (j < 0 || Number.isNaN(kstSeries[j])) return null;
    s += kstSeries[j];
  }
  const signal = s / signalPeriod;
  const kst = kstSeries[last];
  const hist = kst - signal;
  return { kst, signal, hist, dir: kst >= signal ? 'up' : 'down', side: kst >= 0 ? 'pos' : 'neg', n };
}

/** Build a sorted per-symbol KST board, skipping symbols with too little history. */
export function kstBoard(
  series: { symbol: string; closes: number[] }[],
  sort: KstSort = 'kst',
  signalPeriod = KST_SIGNAL,
): KstRow[] {
  const rows: KstRow[] = [];
  for (const sym of series) {
    const stats = computeKst(sym.closes, KST_ROC_PERIODS, KST_SMA_PERIODS, KST_WEIGHTS, signalPeriod);
    if (stats) rows.push({ symbol: sym.symbol, ...stats });
  }
  return sortKst(rows, sort);
}

export function sortKst(rows: KstRow[], sort: KstSort): KstRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'hist':
      out.sort((a, b) => b.hist - a.hist);
      break;
    case 'kst':
    default:
      out.sort((a, b) => b.kst - a.kst);
      break;
  }
  return out;
}
