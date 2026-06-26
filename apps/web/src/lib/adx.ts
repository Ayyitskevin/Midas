/**
 * Wilder's Directional Movement system: ADX / +DI / −DI.
 *
 * Measures trend STRENGTH (ADX) and direction (+DI vs −DI):
 *   - +DM / −DM   the larger of the up-move (high − prevHigh) or down-move
 *                 (prevLow − low) each bar, whichever dominates and is positive
 *   - TR          Wilder true range
 *   - +DI / −DI   100 · Wilder-smoothed(±DM) ÷ Wilder-smoothed(TR)
 *   - DX          100 · |+DI − −DI| ÷ (+DI + −DI)
 *   - ADX         Wilder-smoothed DX
 *
 * Conventionally ADX > 25 is a strong trend and < 20 is rangebound; +DI above
 * −DI is an up-trend, below is a down-trend.
 *
 * Pure and synchronous so it can be unit-tested with exact, hand-computed
 * candles (a no-overlap trend gives DX = 100 → ADX = 100).
 */

/** Minimal OHLC needed for ADX. */
export interface AdxBar {
  high: number;
  low: number;
  close: number;
}

export interface AdxStats {
  /** Average Directional Index, 0..100. */
  adx: number;
  /** +DI (positive directional indicator). */
  plusDI: number;
  /** −DI (negative directional indicator). */
  minusDI: number;
  /** True when ADX ≥ 25 (strong trend). */
  trending: boolean;
  /** True when +DI ≥ −DI (up-trend bias). */
  bullish: boolean;
  /** Number of bars supplied. */
  n: number;
}

export interface AdxRow extends AdxStats {
  symbol: string;
}

export type AdxSort = 'adx' | 'plusDI' | 'minusDI' | 'symbol';

/** ADX ≥ this is considered a strong trend. */
export const ADX_TREND = 25;

/** Wilder smoothing: seed with the sum of the first `period`, then recursively roll. */
function wilderSmooth(arr: number[], period: number): number[] {
  const out = new Array<number>(arr.length).fill(0);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += arr[i];
  out[period - 1] = sum;
  for (let i = period; i < arr.length; i++) {
    out[i] = out[i - 1] - out[i - 1] / period + arr[i];
  }
  return out;
}

/**
 * Compute ADX / +DI / −DI for one symbol. Needs at least 2·period + 1 bars
 * (one full pass to smooth the DIs, a second to smooth DX into ADX); returns
 * null otherwise.
 */
export function computeAdx(bars: AdxBar[], period = 14): AdxStats | null {
  const n = bars.length;
  if (period < 2 || n < 2 * period + 1) return null;

  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 1; i < n; i++) {
    const upMove = bars[i].high - bars[i - 1].high;
    const downMove = bars[i - 1].low - bars[i].low;
    const hl = bars[i].high - bars[i].low;
    const hc = Math.abs(bars[i].high - bars[i - 1].close);
    const lc = Math.abs(bars[i].low - bars[i - 1].close);
    tr.push(Math.max(hl, hc, lc));
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const sTR = wilderSmooth(tr, period);
  const sP = wilderSmooth(plusDM, period);
  const sM = wilderSmooth(minusDM, period);

  // DX series from the first smoothed point onward.
  const dx: number[] = [];
  for (let i = period - 1; i < tr.length; i++) {
    const t = sTR[i];
    const pdi = t > 0 ? (100 * sP[i]) / t : 0;
    const mdi = t > 0 ? (100 * sM[i]) / t : 0;
    const denom = pdi + mdi;
    dx.push(denom > 0 ? (100 * Math.abs(pdi - mdi)) / denom : 0);
  }
  if (dx.length < period) return null;

  // ADX = Wilder running average of DX (seed = mean of first `period`).
  let adx = 0;
  for (let i = 0; i < period; i++) adx += dx[i];
  adx /= period;
  for (let i = period; i < dx.length; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
  }

  const lastT = sTR[tr.length - 1];
  const plusDI = lastT > 0 ? (100 * sP[tr.length - 1]) / lastT : 0;
  const minusDI = lastT > 0 ? (100 * sM[tr.length - 1]) / lastT : 0;

  return { adx, plusDI, minusDI, trending: adx >= ADX_TREND, bullish: plusDI >= minusDI, n };
}

/** Build a sorted per-symbol ADX board, skipping symbols with too little history. */
export function adxBoard(
  series: { symbol: string; bars: AdxBar[] }[],
  sort: AdxSort = 'adx',
  period = 14,
): AdxRow[] {
  const rows: AdxRow[] = [];
  for (const s of series) {
    const stats = computeAdx(s.bars, period);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortAdx(rows, sort);
}

export function sortAdx(rows: AdxRow[], sort: AdxSort): AdxRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'plusDI':
      out.sort((a, b) => b.plusDI - a.plusDI);
      break;
    case 'minusDI':
      out.sort((a, b) => b.minusDI - a.minusDI);
      break;
    case 'adx':
    default:
      // Strongest trends first.
      out.sort((a, b) => b.adx - a.adx);
      break;
  }
  return out;
}
