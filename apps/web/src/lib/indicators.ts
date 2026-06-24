import type { Candle } from '@midas/shared';

/** A single {time, value} point for a chart line series (time in Unix seconds). */
export interface LinePoint {
  time: number;
  value: number;
}

/** Simple moving average of closes. */
export function sma(candles: Candle[], period: number): LinePoint[] {
  const out: LinePoint[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
}

/** Exponential moving average of closes. */
export function ema(candles: Candle[], period: number): LinePoint[] {
  if (candles.length === 0) return [];
  const k = 2 / (period + 1);
  const out: LinePoint[] = [];
  let prev = candles[0].close;
  for (let i = 0; i < candles.length; i++) {
    prev = i === 0 ? candles[0].close : candles[i].close * k + prev * (1 - k);
    if (i >= period - 1) out.push({ time: candles[i].time, value: prev });
  }
  return out;
}

export interface BollingerBands {
  upper: LinePoint[];
  middle: LinePoint[];
  lower: LinePoint[];
}

/** Bollinger Bands: SMA(period) ± mult × population standard deviation. */
export function bollinger(candles: Candle[], period: number, mult: number): BollingerBands {
  const upper: LinePoint[] = [];
  const middle: LinePoint[] = [];
  const lower: LinePoint[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
    const mean = sum / period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = candles[j].close - mean;
      variance += d * d;
    }
    const sd = Math.sqrt(variance / period);
    const time = candles[i].time;
    middle.push({ time, value: mean });
    upper.push({ time, value: mean + mult * sd });
    lower.push({ time, value: mean - mult * sd });
  }
  return { upper, middle, lower };
}

/** EMA over a plain number series, seeded at the first value; full length. */
function emaSeries(values: number[], period: number): number[] {
  const out: number[] = [];
  const k = 2 / (period + 1);
  let prev = values.length ? values[0] : 0;
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export interface Macd {
  macd: LinePoint[];
  signal: LinePoint[];
  histogram: LinePoint[];
}

/**
 * MACD: fast EMA − slow EMA of closes, its signal EMA, and the histogram
 * (macd − signal). The macd line starts once the slow EMA has warmed up.
 */
export function macd(candles: Candle[], fast = 12, slow = 26, signalPeriod = 9): Macd {
  if (candles.length === 0) return { macd: [], signal: [], histogram: [] };
  const closes = candles.map((c) => c.close);
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);

  const start = Math.min(slow - 1, candles.length - 1);
  const macdLine: LinePoint[] = [];
  const macdVals: number[] = [];
  for (let i = start; i < candles.length; i++) {
    const value = emaFast[i] - emaSlow[i];
    macdVals.push(value);
    macdLine.push({ time: candles[i].time, value });
  }

  const signalVals = emaSeries(macdVals, signalPeriod);
  const signal: LinePoint[] = [];
  const histogram: LinePoint[] = [];
  for (let j = 0; j < macdLine.length; j++) {
    signal.push({ time: macdLine[j].time, value: signalVals[j] });
    histogram.push({ time: macdLine[j].time, value: macdLine[j].value - signalVals[j] });
  }
  return { macd: macdLine, signal, histogram };
}

/**
 * Anchored VWAP: the cumulative volume-weighted average of the typical price
 * (high+low+close)/3 from the first candle onward. Falls back to typical price
 * while cumulative volume is zero.
 */
export function vwap(candles: Candle[]): LinePoint[] {
  const out: LinePoint[] = [];
  let cumPV = 0;
  let cumV = 0;
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    const vol = c.volume > 0 ? c.volume : 0;
    cumPV += typical * vol;
    cumV += vol;
    out.push({ time: c.time, value: cumV > 0 ? cumPV / cumV : typical });
  }
  return out;
}

export interface VolumeBin {
  priceLow: number;
  priceHigh: number;
  mid: number;
  volume: number;
}

export interface VolumeProfile {
  bins: VolumeBin[];
  /** Index of the highest-volume bin (point of control), or -1 if empty. */
  pocIndex: number;
  maxVolume: number;
}

/**
 * Volume distributed across `binCount` equal price buckets spanning the candle
 * set's low→high, each candle's volume assigned to its typical-price bucket.
 * Identifies the point of control (the heaviest bucket).
 */
export function volumeProfile(candles: Candle[], binCount = 24): VolumeProfile {
  if (candles.length === 0) return { bins: [], pocIndex: -1, maxVolume: 0 };

  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    if (c.low < lo) lo = c.low;
    if (c.high > hi) hi = c.high;
  }
  if (!(hi > lo)) hi = lo + 1; // flat series guard
  const span = hi - lo;
  const n = Math.max(1, Math.floor(binCount));

  const bins: VolumeBin[] = [];
  for (let i = 0; i < n; i++) {
    const priceLow = lo + (span * i) / n;
    const priceHigh = lo + (span * (i + 1)) / n;
    bins.push({ priceLow, priceHigh, mid: (priceLow + priceHigh) / 2, volume: 0 });
  }

  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    let idx = Math.floor(((typical - lo) / span) * n);
    if (idx < 0) idx = 0;
    if (idx >= n) idx = n - 1;
    bins[idx].volume += c.volume > 0 ? c.volume : 0;
  }

  let pocIndex = 0;
  let maxVolume = 0;
  for (let i = 0; i < bins.length; i++) {
    if (bins[i].volume > maxVolume) {
      maxVolume = bins[i].volume;
      pocIndex = i;
    }
  }
  return { bins, pocIndex, maxVolume };
}

export interface FibLevel {
  ratio: number;
  price: number;
}

const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/**
 * Fibonacci retracement levels between two prices (order-independent): level 0
 * sits at the high, level 1 at the low, the rest interpolate between.
 */
export function fibLevels(a: number, b: number): FibLevel[] {
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  const span = high - low;
  return FIB_RATIOS.map((ratio) => ({ ratio, price: high - ratio * span }));
}

/** Wilder's RSI of closes (0–100). */
export function rsi(candles: Candle[], period: number): LinePoint[] {
  if (candles.length <= period) return [];
  const out: LinePoint[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  // Seed averages over the first `period` deltas.
  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change >= 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;

  const push = (i: number) => {
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    const value = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
    out.push({ time: candles[i].time, value });
  };
  push(period);

  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = change >= 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    push(i);
  }
  return out;
}
