/**
 * TTM Squeeze (John Carter).
 *
 * A volatility-compression scanner that combines the two band families:
 *
 *   midline = SMA(close, N)
 *   BB      = midline ± bbMult · stdev(close, N)       // Bollinger (stdev)
 *   KC      = midline ± kcMult · ATR(N)                // Keltner (avg true range)
 *
 * The squeeze is **on** while the Bollinger bands sit *inside* the Keltner
 * channel (low volatility, coiling); it **fires** when the bands expand back
 * outside (a release). Carter's de-trended momentum gives the direction:
 *
 *   mom = close − ( (highestHigh(N) + lowestLow(N)) / 2 + SMA(close, N) ) / 2
 *
 * A genuine BB-meets-KELT setup scanner. Pure and synchronous so it can be
 * unit-tested with exact, hand-computed bars.
 */

/** Minimal OHLC bar (no open needed). */
export interface TtmBar {
  high: number;
  low: number;
  close: number;
}

export type SqueezeState = 'on' | 'off';
export type MomDir = 'up' | 'down';

export interface TtmStats {
  /** BB inside KC (compression) or not. */
  squeeze: SqueezeState;
  /** The squeeze released on the latest bar (on → off). */
  fired: boolean;
  /** Bollinger band width as a % of the midline. */
  bbWidth: number;
  /** Keltner channel width as a % of the midline. */
  kcWidth: number;
  /** Carter de-trended momentum (price units). */
  mom: number;
  /** Momentum as a % of the close. */
  momPct: number;
  /** Momentum sign. */
  momDir: MomDir;
  /** Momentum rising vs the prior bar. */
  momRising: boolean;
  /** Number of bars supplied. */
  n: number;
}

export interface TtmRow extends TtmStats {
  symbol: string;
}

export type TtmSort = 'squeeze' | 'mom' | 'symbol';

interface TtmSeries {
  squeeze: boolean[];
  mom: number[];
  bbWidth: number[];
  kcWidth: number[];
}

/**
 * Compute the per-bar squeeze / momentum series. Returns null with too little
 * history (needs more than `period` bars).
 */
export function ttmSeries(bars: TtmBar[], period = 20, bbMult = 2, kcMult = 1.5): TtmSeries | null {
  const n = bars.length;
  if (period < 2 || n < period + 1) return null;

  // True range per bar (the first bar has no predecessor → high − low seed).
  const tr: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) tr.push(bars[0].high - bars[0].low);
    else
      tr.push(
        Math.max(
          bars[i].high - bars[i].low,
          Math.abs(bars[i].high - bars[i - 1].close),
          Math.abs(bars[i].low - bars[i - 1].close),
        ),
      );
  }

  const squeeze: boolean[] = [];
  const mom: number[] = [];
  const bbWidth: number[] = [];
  const kcWidth: number[] = [];

  for (let i = period - 1; i < n; i++) {
    let sumC = 0;
    let sumTR = 0;
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      sumC += bars[j].close;
      sumTR += tr[j];
      if (bars[j].high > hh) hh = bars[j].high;
      if (bars[j].low < ll) ll = bars[j].low;
    }
    const sma = sumC / period;
    const atr = sumTR / period;
    let varSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = bars[j].close - sma;
      varSum += d * d;
    }
    const sd = Math.sqrt(varSum / period); // population stdev

    const bbUpper = sma + bbMult * sd;
    const bbLower = sma - bbMult * sd;
    const kcUpper = sma + kcMult * atr;
    const kcLower = sma - kcMult * atr;

    squeeze.push(bbUpper < kcUpper && bbLower > kcLower);
    bbWidth.push(sma !== 0 ? ((bbUpper - bbLower) / sma) * 100 : 0);
    kcWidth.push(sma !== 0 ? ((kcUpper - kcLower) / sma) * 100 : 0);
    mom.push(bars[i].close - ((hh + ll) / 2 + sma) / 2);
  }

  return { squeeze, mom, bbWidth, kcWidth };
}

/**
 * Compute the latest TTM squeeze reading for one symbol. Needs more than
 * `period` bars; returns null otherwise.
 */
export function computeTtm(bars: TtmBar[], period = 20, bbMult = 2, kcMult = 1.5): TtmStats | null {
  const s = ttmSeries(bars, period, bbMult, kcMult);
  if (!s) return null;

  const last = s.squeeze.length - 1;
  const sqzNow = s.squeeze[last];
  const sqzPrev = last >= 1 ? s.squeeze[last - 1] : false;
  const momNow = s.mom[last];
  const momPrev = last >= 1 ? s.mom[last - 1] : momNow;
  const close = bars[bars.length - 1].close;

  return {
    squeeze: sqzNow ? 'on' : 'off',
    fired: sqzPrev && !sqzNow,
    bbWidth: s.bbWidth[last],
    kcWidth: s.kcWidth[last],
    mom: momNow,
    momPct: close !== 0 ? (momNow / close) * 100 : 0,
    momDir: momNow >= 0 ? 'up' : 'down',
    momRising: momNow > momPrev,
    n: bars.length,
  };
}

/** Build a sorted per-symbol TTM squeeze board, skipping symbols with too little history. */
export function ttmBoard(
  series: { symbol: string; bars: TtmBar[] }[],
  sort: TtmSort = 'squeeze',
  period = 20,
  bbMult = 2,
  kcMult = 1.5,
): TtmRow[] {
  const rows: TtmRow[] = [];
  for (const s of series) {
    const stats = computeTtm(s.bars, period, bbMult, kcMult);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortTtm(rows, sort);
}

export function sortTtm(rows: TtmRow[], sort: TtmSort): TtmRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'mom':
      out.sort((a, b) => b.momPct - a.momPct);
      break;
    case 'squeeze':
    default:
      // Squeezing names first, then by momentum strength.
      out.sort((a, b) => {
        const sa = a.squeeze === 'on' ? 0 : 1;
        const sb = b.squeeze === 'on' ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return b.momPct - a.momPct;
      });
      break;
  }
  return out;
}
