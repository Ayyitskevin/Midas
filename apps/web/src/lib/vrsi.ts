/**
 * Vervoort Smoothed RSI (Inverse Fisher Transform) screener helpers.
 *
 * Sylvain Vervoort's "A Smoothed RSI Inverse Fisher Transform" (Stocks &
 * Commodities, Oct 2010) sharpens RSI timing by smoothing the price first, then
 * compressing the RSI through an inverse Fisher transform. The full pipeline:
 *
 *   close
 *     → SVE_RainbowAverage : a 10-deep cascade of 2-period weighted MAs of
 *        close, blended with weights 5,4,3,2,1,1,1,1,1,1 / 20
 *     → Wilder RSI(rsiPeriod)            (on the rainbow-smoothed price)
 *     → x = 0.1 · (RSI − 50)             (centre/scale into roughly [−5,+5])
 *     → ZeroLagEMA(zlPeriod) : EMA1 = EMA(x); EMA2 = EMA(EMA1); zl = 2·EMA1 − EMA2
 *     → inverse Fisher : vrsi = tanh(zl) = (e^2zl − 1)/(e^2zl + 1)
 *
 * The output is bounded to (−1, +1) and, because the inverse Fisher saturates,
 * snaps quickly between the extremes. Vervoort's bands sit at ±0.5: ≥ +0.5 is
 * overbought, ≤ −0.5 oversold (his entries cross up through −0.5 / down through
 * +0.5). Defaults are 4 bars for both the RSI and the zero-lag EMA.
 *
 * Reuses the repo's seeded `emaSeries`; the Wilder RSI mirrors `indicators.ts`'s
 * `rsi()` exactly but over a plain number series. Pure and synchronous so the
 * whole chain can be unit-tested against hand-computed values.
 */
import { emaSeries } from './indicators';

export type VrsiZone = 'overbought' | 'oversold' | 'neutral';
export type VrsiDir = 'up' | 'down' | 'flat';

/** Overbought / oversold band (Vervoort's native ±0.5 on the [−1,+1] line). */
export const VRSI_BAND = 0.5;

export interface VrsiStats {
  /** Vervoort smoothed RSI (inverse Fisher), in (−1, +1). */
  vrsi: number;
  /** Previous-bar value, for the rising/falling read. */
  prev: number;
  /** Direction on the latest bar. */
  dir: VrsiDir;
  /** Band zone from the latest value. */
  zone: VrsiZone;
  /** Number of closes supplied. */
  n: number;
}

export interface VrsiRow extends VrsiStats {
  symbol: string;
}

export type VrsiSort = 'vrsi' | 'symbol';

/** Period-2 weighted MA: WMA2(x)[i] = (2·x[i] + x[i−1]) / 3, with x[−1] := x[0] at the start. */
function wma2(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const prev = i === 0 ? values[0] : values[i - 1];
    out.push((2 * values[i] + prev) / 3);
  }
  return out;
}

/**
 * SVE_RainbowAverage: ten successively-cascaded WMA2 passes of close, blended
 * with weights 5,4,3,2,1,1,1,1,1,1 (sum 20). Full-length; the x[−1]:=x[0] seed
 * makes rainbow[0] === close[0] and avoids NaNs.
 */
export function sveRainbow(closes: number[]): number[] {
  const n = closes.length;
  if (n === 0) return [];
  const mas: number[][] = [];
  let cur = closes;
  for (let k = 0; k < 10; k++) {
    cur = wma2(cur);
    mas.push(cur);
  }
  const weights = [5, 4, 3, 2, 1, 1, 1, 1, 1, 1];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < 10; k++) sum += weights[k] * mas[k][i];
    out.push(sum / 20);
  }
  return out;
}

/**
 * Wilder's RSI over a plain number series — SMA seed of the first `period`
 * up/down deltas, then Wilder smoothing; RSI = 100 when avgLoss = 0. Returns the
 * defined subseries (length values.length − period), first value at index
 * `period`, matching `indicators.ts`'s `rsi()`.
 */
export function wilderRsiSeries(values: number[], period: number): number[] {
  const n = values.length;
  if (period < 1 || n <= period) return [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = values[i] - values[i - 1];
    if (ch >= 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= period;
  avgLoss /= period;
  const rsiVal = () => (avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  const out: number[] = [rsiVal()];
  for (let i = period + 1; i < n; i++) {
    const ch = values[i] - values[i - 1];
    const gain = ch >= 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push(rsiVal());
  }
  return out;
}

/** Classify a value against the ±band. */
export function vrsiZone(v: number, band = VRSI_BAND): VrsiZone {
  if (v >= band) return 'overbought';
  if (v <= -band) return 'oversold';
  return 'neutral';
}

/**
 * Compute the latest Vervoort Smoothed RSI for one symbol. Needs at least
 * `rsiPeriod + 2` closes (so the RSI subseries has ≥ 2 points for the direction
 * read); returns null on bad params or too little history.
 */
export function computeVrsi(closes: number[], rsiPeriod = 4, zlPeriod = 4): VrsiStats | null {
  if (rsiPeriod < 1 || zlPeriod < 1) return null;
  const n = closes.length;
  if (n < rsiPeriod + 2) return null;

  const rainbow = sveRainbow(closes);
  const rsiArr = wilderRsiSeries(rainbow, rsiPeriod);
  if (rsiArr.length < 2) return null;

  const x = rsiArr.map((r) => 0.1 * (r - 50));
  const ema1 = emaSeries(x, zlPeriod);
  const ema2 = emaSeries(ema1, zlPeriod);
  const ifish = ema1.map((e, i) => Math.tanh(2 * e - ema2[i]));

  const L = ifish.length;
  const vrsi = ifish[L - 1];
  const prev = ifish[L - 2];
  const dir: VrsiDir = vrsi > prev ? 'up' : vrsi < prev ? 'down' : 'flat';
  return { vrsi, prev, dir, zone: vrsiZone(vrsi), n };
}

/** Build a sorted per-symbol Vervoort Smoothed RSI board, skipping thin history. */
export function vrsiBoard(
  series: { symbol: string; closes: number[] }[],
  sort: VrsiSort = 'vrsi',
  rsiPeriod = 4,
  zlPeriod = 4,
): VrsiRow[] {
  const rows: VrsiRow[] = [];
  for (const s of series) {
    const stats = computeVrsi(s.closes, rsiPeriod, zlPeriod);
    if (stats) rows.push({ symbol: s.symbol, ...stats });
  }
  return sortVrsi(rows, sort);
}

export function sortVrsi(rows: VrsiRow[], sort: VrsiSort): VrsiRow[] {
  const out = [...rows];
  switch (sort) {
    case 'symbol':
      out.sort((a, b) => a.symbol.localeCompare(b.symbol));
      break;
    case 'vrsi':
    default:
      // Most overbought (near +1) first, most oversold (near −1) last.
      out.sort((a, b) => b.vrsi - a.vrsi);
      break;
  }
  return out;
}
