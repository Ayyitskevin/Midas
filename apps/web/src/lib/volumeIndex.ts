/**
 * Negative & Positive Volume Index (Fosback / Dysart).
 *
 * Two cumulative index lines that compound the daily return only on the days
 * that matter to each:
 *
 *   NVI updates only when volume FELL vs the prior bar ("smart money" — the
 *       quiet days the informed accumulate on);
 *   PVI updates only when volume ROSE ("the crowd" — high-volume days).
 *
 *   line[i] = volumeQualifies ? line[i-1] · (1 + return_i) : line[i-1]
 *
 * Both start at a common base (1000), so the levels are comparable across
 * symbols. The signal is each line vs its own EMA (classically 255-bar): NVI
 * above its EMA is the strongest bull-market tell, PVI above its EMA a weaker
 * one. The board reports NVI's distance from its EMA and the bull/bear regime
 * of both. Reuses the shared `emaSeries()`.
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed bars.
 */
import { emaSeries } from './indicators';

/** Bar with close + volume. */
export interface VolIdxBar {
  close: number;
  volume: number;
}

export type Regime = 'bull' | 'bear';

export interface VolIdxStats {
  /** Latest Negative Volume Index. */
  nvi: number;
  /** NVI's EMA signal. */
  nviSignal: number;
  /** NVI distance from its EMA, as a %. */
  nviDist: number;
  /** NVI regime (above its EMA = bull). */
  nviRegime: Regime;
  /** Latest Positive Volume Index. */
  pvi: number;
  /** PVI's EMA signal. */
  pviSignal: number;
  /** PVI regime. */
  pviRegime: Regime;
  /** Number of bars supplied. */
  n: number;
}

export interface VolIdxRow extends VolIdxStats {
  symbol: string;
}

export type VolIdxSort = 'nvi' | 'symbol';

/**
 * Compute the latest NVI/PVI reading for one symbol. Needs `signalPeriod` bars
 * for a meaningful EMA signal; returns null otherwise.
 */
export function computeVolumeIndex(bars: VolIdxBar[], signalPeriod = 255, base = 1000): VolIdxStats | null {
  const n = bars.length;
  if (signalPeriod < 1 || n < signalPeriod) return null;

  const nvi: number[] = [base];
  const pvi: number[] = [base];
  for (let i = 1; i < n; i++) {
    const prevClose = bars[i - 1].close;
    const ret = prevClose !== 0 ? (bars[i].close - prevClose) / prevClose : 0;
    const volDown = bars[i].volume < bars[i - 1].volume;
    const volUp = bars[i].volume > bars[i - 1].volume;
    nvi.push(volDown ? nvi[i - 1] * (1 + ret) : nvi[i - 1]);
    pvi.push(volUp ? pvi[i - 1] * (1 + ret) : pvi[i - 1]);
  }

  const nviLast = nvi[n - 1];
  const pviLast = pvi[n - 1];
  const nviSignal = emaSeries(nvi, signalPeriod)[n - 1];
  const pviSignal = emaSeries(pvi, signalPeriod)[n - 1];

  return {
    nvi: nviLast,
    nviSignal,
    nviDist: nviSignal !== 0 ? ((nviLast - nviSignal) / nviSignal) * 100 : 0,
    nviRegime: nviLast >= nviSignal ? 'bull' : 'bear',
    pvi: pviLast,
    pviSignal,
    pviRegime: pviLast >= pviSignal ? 'bull' : 'bear',
    n,
  };
}

/** Build a sorted per-symbol NVI/PVI board, skipping symbols with too little history. */
export function volumeIndexBoard(
  series: { symbol: string; bars: VolIdxBar[] }[],
  sort: VolIdxSort = 'nvi',
  signalPeriod = 255,
  base = 1000,
): VolIdxRow[] {
  const rows: VolIdxRow[] = [];
  for (const s of series) {
    const stats = computeVolumeIndex(s.bars, signalPeriod, base);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortVolumeIndex(rows, sort);
}

export function sortVolumeIndex(rows: VolIdxRow[], sort: VolIdxSort): VolIdxRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'nvi':
    default:
      out.sort((a, b) => b.nviDist - a.nviDist);
      break;
  }
  return out;
}
