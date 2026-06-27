/**
 * SMI Ergodic screener helpers.
 *
 * William Blau's SMI Ergodic Indicator is identically the True Strength Index —
 * a double-EMA-smoothed momentum — paired with an EMA signal line; the SMI
 * Ergodic Oscillator is the histogram (indicator − signal):
 *
 *   pc     = close[i] − close[i−1]
 *   smi    = 100 · EMA(EMA(pc, long), short) / EMA(EMA(|pc|, long), short)
 *   signal = EMA(smi, signalLen)
 *   hist   = smi − signal
 *
 * The inner smoothing uses `long`, the outer uses `short` (the load-bearing
 * order). Above zero is net bullish momentum; the signal-line cross (a sign
 * flip of the histogram) is the trigger. Reuses the shared seeded `emaSeries`,
 * so the indicator matches the TSI board's `computeTsi` exactly. Defaults follow
 * the TradingView build: long 20, short 5, signal 5.
 */
import { emaSeries } from './indicators';

export type SmieCross = 'bull' | 'bear' | 'none';

export interface SmieStats {
  /** SMI Ergodic indicator (the True Strength Index) at the latest bar. */
  smi: number;
  /** Signal line (EMA of the indicator) at the latest bar. */
  signal: number;
  /** Histogram (indicator − signal), the SMI Ergodic Oscillator. */
  hist: number;
  /** Fresh signal-line cross on the latest bar. */
  cross: SmieCross;
  /** Indicator above (pos) or below (neg) the zero line. */
  side: 'pos' | 'neg';
  /** Number of closes supplied. */
  n: number;
}

export interface SmieRow extends SmieStats {
  symbol: string;
}

export type SmieSort = 'smi' | 'hist' | 'symbol';

/** Classify a signal-line cross between two consecutive histogram bars. */
export function smieCross(prevHist: number, hist: number): SmieCross {
  if (prevHist <= 0 && hist > 0) return 'bull';
  if (prevHist >= 0 && hist < 0) return 'bear';
  return 'none';
}

/**
 * Compute the latest SMI Ergodic for one symbol. Returns null with bad params
 * or too little history (needs ≥ long + short + 1 closes, matching the TSI
 * building block, which also gives a prior histogram bar for the cross).
 */
export function computeSmie(
  closes: number[],
  long = 20,
  short = 5,
  signalPeriod = 5,
): SmieStats | null {
  if (long < 1 || short < 1 || signalPeriod < 1) return null;
  if (closes.length < long + short + 1) return null;

  const pc: number[] = [];
  const apc: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    pc.push(d);
    apc.push(Math.abs(d));
  }

  // Double smoothing: long period first (inner), short period second (outer).
  const dsPc = emaSeries(emaSeries(pc, long), short);
  const dsApc = emaSeries(emaSeries(apc, long), short);
  const smiSeries = dsPc.map((v, i) => (dsApc[i] !== 0 ? (100 * v) / dsApc[i] : 0));
  const signalSeries = emaSeries(smiSeries, signalPeriod);

  const last = smiSeries.length - 1;
  const smi = smiSeries[last];
  const signal = signalSeries[last];
  const hist = smi - signal;
  const prevHist = smiSeries[last - 1] - signalSeries[last - 1];
  return {
    smi,
    signal,
    hist,
    cross: smieCross(prevHist, hist),
    side: smi >= 0 ? 'pos' : 'neg',
    n: closes.length,
  };
}

/** Build a sorted per-symbol SMI Ergodic board, skipping symbols with too little history. */
export function smieBoard(
  series: { symbol: string; closes: number[] }[],
  sort: SmieSort = 'smi',
  long = 20,
  short = 5,
  signalPeriod = 5,
): SmieRow[] {
  const rows: SmieRow[] = [];
  for (const s of series) {
    const stats = computeSmie(s.closes, long, short, signalPeriod);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortSmie(rows, sort);
}

export function sortSmie(rows: SmieRow[], sort: SmieSort): SmieRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'hist':
      out.sort((a, b) => b.hist - a.hist);
      break;
    case 'smi':
    default:
      out.sort((a, b) => b.smi - a.smi);
      break;
  }
  return out;
}
