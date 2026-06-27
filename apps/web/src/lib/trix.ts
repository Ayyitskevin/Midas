/**
 * TRIX (triple-smoothed EMA rate-of-change).
 *
 * The 1-period percent rate-of-change of a triple-smoothed EMA of price:
 *
 *   EMA1 = EMA(close, N), EMA2 = EMA(EMA1, N), EMA3 = EMA(EMA2, N)
 *   TRIX = (EMA3[i] − EMA3[i-1]) / EMA3[i-1] · 100
 *   signal = EMA(TRIX, M)
 *
 * Triple smoothing filters the noise that a single EMA leaves, so TRIX is a
 * cleaner momentum-of-momentum gauge: above zero is up-momentum, a TRIX×signal
 * cross is the trigger. A zero-line oscillator, distinct from MACD (dual EMA).
 *
 * Reuses the shared `emaSeries()` (first-value seed, full recursion) so the
 * smoothing matches the chart's EMA. Pure and synchronous for exact unit
 * testing. (The triple-EMA chaining and fixtures were adversarially verified.)
 */
import { emaSeries } from './indicators';

export type TrixSide = 'up' | 'down';
export type TrixCross = 'bull' | 'bear' | 'none';

export interface TrixStats {
  /** Latest TRIX value (% ROC of the triple EMA). */
  trix: number;
  /** Latest signal-line value (EMA of TRIX). */
  signal: number;
  /** TRIX − signal. */
  hist: number;
  /** TRIX vs the zero line. */
  side: TrixSide;
  /** Fresh TRIX × signal crossover on the latest bar. */
  cross: TrixCross;
  /** Number of closes supplied. */
  n: number;
}

export interface TrixRow extends TrixStats {
  symbol: string;
}

export type TrixSort = 'trix' | 'hist' | 'symbol';

/**
 * Compute the latest TRIX reading for one symbol from a close series. Needs at
 * least 2 closes (the triple EMA needs two points for one rate-of-change);
 * returns null otherwise.
 */
export function computeTrix(closes: number[], period = 15, signalPeriod = 9): TrixStats | null {
  const n = closes.length;
  if (period < 1 || signalPeriod < 1 || n < 2) return null;

  const ema3 = emaSeries(emaSeries(emaSeries(closes, period), period), period);

  const trixSeries: number[] = [];
  for (let i = 1; i < ema3.length; i++) {
    const prev = ema3[i - 1];
    trixSeries.push(prev !== 0 ? ((ema3[i] - prev) / prev) * 100 : 0);
  }
  if (trixSeries.length === 0) return null;

  const sigSeries = emaSeries(trixSeries, signalPeriod);
  const trix = trixSeries[trixSeries.length - 1];
  const signal = sigSeries[sigSeries.length - 1];

  let cross: TrixCross = 'none';
  if (trixSeries.length >= 2) {
    const tPrev = trixSeries[trixSeries.length - 2];
    const sPrev = sigSeries[sigSeries.length - 2];
    if (tPrev <= sPrev && trix > signal) cross = 'bull';
    else if (tPrev >= sPrev && trix < signal) cross = 'bear';
  }

  return { trix, signal, hist: trix - signal, side: trix >= 0 ? 'up' : 'down', cross, n };
}

/** Build a sorted per-symbol TRIX board, skipping symbols with too little history. */
export function trixBoard(
  series: { symbol: string; closes: number[] }[],
  sort: TrixSort = 'trix',
  period = 15,
  signalPeriod = 9,
): TrixRow[] {
  const rows: TrixRow[] = [];
  for (const s of series) {
    const stats = computeTrix(s.closes, period, signalPeriod);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortTrix(rows, sort);
}

export function sortTrix(rows: TrixRow[], sort: TrixSort): TrixRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'hist':
      out.sort((a, b) => b.hist - a.hist);
      break;
    case 'trix':
    default:
      out.sort((a, b) => b.trix - a.trix);
      break;
  }
  return out;
}
