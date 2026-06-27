/**
 * Elder Impulse System screener helpers.
 *
 * Dr. Alexander Elder's Impulse System ("Come Into My Trading Room") colours
 * each bar by combining two gauges measured bar over bar:
 *   - a 13-period EMA of close — trend / inertia, and
 *   - the MACD histogram (12/26/9) — momentum.
 *
 *   GREEN / bull    when the 13-EMA is rising  AND the histogram is rising,
 *   RED   / bear    when the 13-EMA is falling AND the histogram is falling,
 *   BLUE  / neutral otherwise (the two disagree, or either is flat).
 *
 * The comparisons are strict, so a flat EMA or histogram (equal to the prior
 * bar) confirms neither direction and the bar falls through to neutral. Elder
 * treats the system as a censor — green forbids shorting, red forbids buying,
 * blue permits both — so the actionable event is a fresh flip on the latest bar.
 *
 * Reuses the shared seeded `emaSeries` (the 13-EMA) and `macd()` (the same
 * 12/26/9 the chart and MACD board draw), so the screener always agrees with
 * the chart.
 */
import type { Candle } from '@midas/shared';
import { emaSeries, macd } from './indicators';

export type Impulse = 'bull' | 'bear' | 'neutral';

export interface ImpulseStats {
  /** Impulse colour at the latest bar. */
  impulse: Impulse;
  /** Impulse colour at the prior bar. */
  prevImpulse: Impulse;
  /** True when the latest impulse differs from the prior bar (a fresh flip). */
  changed: boolean;
  /** 13-EMA slope on the latest bar (ema[last] − ema[last-1]). */
  emaSlope: number;
  /** True when the 13-EMA is rising on the latest bar. */
  emaUp: boolean;
  /** Latest MACD histogram value. */
  hist: number;
  /** MACD histogram slope on the latest bar (hist[last] − hist[last-1]). */
  histSlope: number;
  /** True when the histogram is rising on the latest bar. */
  histUp: boolean;
  /** 13-EMA slope as a % of price, for ranking across symbols. */
  emaSlopePct: number;
  /** Histogram as a % of price, for ranking across symbols. */
  histPct: number;
  /** Number of candles supplied. */
  n: number;
}

export interface ImpulseRow extends ImpulseStats {
  symbol: string;
}

export type ImpulseSort = 'impulse' | 'histPct' | 'emaSlopePct' | 'symbol';

/** Bull ranks above neutral above bear when sorting the board. */
const IMPULSE_RANK: Record<Impulse, number> = { bull: 2, neutral: 1, bear: 0 };

/**
 * Classify one bar's impulse from its trend-EMA slope and histogram slope.
 * Strict comparisons: a flat (zero) slope confirms neither side → neutral.
 */
export function classifyImpulse(emaSlope: number, histSlope: number): Impulse {
  if (emaSlope > 0 && histSlope > 0) return 'bull';
  if (emaSlope < 0 && histSlope < 0) return 'bear';
  return 'neutral';
}

/**
 * Compute Elder Impulse stats for one symbol. Needs enough candles for three
 * MACD-histogram bars, so the latest and prior impulse both exist; returns
 * null on bad params or too little history.
 */
export function computeImpulse(
  candles: Candle[],
  emaPeriod = 13,
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): ImpulseStats | null {
  if (emaPeriod < 1 || fast < 1 || slow < 1 || signalPeriod < 1) return null;
  const n = candles.length;
  const closes = candles.map((c) => c.close);
  const ema = emaSeries(closes, emaPeriod);
  const hist = macd(candles, fast, slow, signalPeriod).histogram;
  // Three histogram bars (and three EMA points) are needed to slope both the
  // latest and the prior bar. The EMA is full-length and the histogram starts
  // at bar slow-1, so their last points reference the same candles.
  if (hist.length < 3 || ema.length < 3) return null;

  const e = ema.length - 1;
  const h = hist.length - 1;
  const emaSlope = ema[e] - ema[e - 1];
  const emaSlopePrev = ema[e - 1] - ema[e - 2];
  const histSlope = hist[h].value - hist[h - 1].value;
  const histSlopePrev = hist[h - 1].value - hist[h - 2].value;

  const impulse = classifyImpulse(emaSlope, histSlope);
  const prevImpulse = classifyImpulse(emaSlopePrev, histSlopePrev);
  const hLast = hist[h].value;
  const close = closes[n - 1];
  return {
    impulse,
    prevImpulse,
    changed: impulse !== prevImpulse,
    emaSlope,
    emaUp: emaSlope > 0,
    hist: hLast,
    histSlope,
    histUp: histSlope > 0,
    emaSlopePct: close > 0 ? (emaSlope / close) * 100 : 0,
    histPct: close > 0 ? (hLast / close) * 100 : 0,
    n,
  };
}

/** Build a sorted per-symbol Elder Impulse board, skipping thin history. */
export function impulseBoard(
  series: { symbol: string; candles: Candle[] }[],
  sort: ImpulseSort = 'impulse',
  emaPeriod = 13,
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): ImpulseRow[] {
  const rows: ImpulseRow[] = [];
  for (const s of series) {
    const stats = computeImpulse(s.candles, emaPeriod, fast, slow, signalPeriod);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortImpulse(rows, sort);
}

export function sortImpulse(rows: ImpulseRow[], sort: ImpulseSort): ImpulseRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'histPct':
      out.sort((a, b) => b.histPct - a.histPct);
      break;
    case 'emaSlopePct':
      out.sort((a, b) => b.emaSlopePct - a.emaSlopePct);
      break;
    case 'impulse':
    default:
      // Bull → neutral → bear, then by momentum (histogram %) within a colour.
      out.sort((a, b) => IMPULSE_RANK[b.impulse] - IMPULSE_RANK[a.impulse] || b.histPct - a.histPct);
      break;
  }
  return out;
}
