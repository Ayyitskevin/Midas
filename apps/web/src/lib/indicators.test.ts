import { describe, it, expect } from 'vitest';
import { sma, ema, bollinger, rsi, macd, vwap, volumeProfile } from '@/lib/indicators';
import type { Candle } from '@midas/shared';

/** Build flat OHLCV candles from a close-price series. */
const candles = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({ time: i, open: close, high: close, low: close, close, volume: 0 }));

/** Build candles from [high, low, close, volume] rows (open = previous close). */
const ohlcv = (rows: Array<[number, number, number, number]>): Candle[] =>
  rows.map(([high, low, close, volume], i) => ({ time: i, open: close, high, low, close, volume }));

describe('sma', () => {
  it('averages over the trailing window', () => {
    const out = sma(candles([1, 2, 3, 4, 5]), 3);
    expect(out.map((p) => p.value)).toEqual([2, 3, 4]);
    expect(out[0].time).toBe(2); // first full window ends at index 2
  });

  it('emits nothing until the window fills', () => {
    expect(sma(candles([1, 2]), 3)).toEqual([]);
  });
});

describe('ema', () => {
  it('holds a flat series at the constant', () => {
    for (const p of ema(candles([5, 5, 5, 5]), 2)) expect(p.value).toBeCloseTo(5);
  });

  it('weights recent closes more heavily than the SMA', () => {
    const out = ema(candles([1, 2, 3, 4, 5]), 3);
    expect(out[out.length - 1].value).toBeGreaterThan(4); // last SMA(3) is 4
  });
});

describe('bollinger', () => {
  it('collapses to the mean when prices are flat', () => {
    const { upper, middle, lower } = bollinger(candles([10, 10, 10, 10]), 3, 2);
    expect(middle.every((p) => p.value === 10)).toBe(true);
    expect(upper.every((p) => p.value === 10)).toBe(true);
    expect(lower.every((p) => p.value === 10)).toBe(true);
  });

  it('brackets the mean by ±mult·σ (population)', () => {
    const { upper, middle, lower } = bollinger(candles([2, 4, 6]), 3, 2);
    const sd = Math.sqrt(8 / 3); // var = ((-2)²+0+2²)/3 = 8/3
    expect(middle[0].value).toBeCloseTo(4);
    expect(upper[0].value).toBeCloseTo(4 + 2 * sd);
    expect(lower[0].value).toBeCloseTo(4 - 2 * sd);
  });
});

describe('rsi', () => {
  it('is 100 when every change is a gain', () => {
    expect(rsi(candles([1, 2, 3, 4, 5, 6]), 3)[0].value).toBe(100);
  });

  it('stays within 0–100 on a choppy series', () => {
    const out = rsi(candles([5, 4, 6, 3, 7, 2, 8, 1]), 3);
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) {
      expect(p.value).toBeGreaterThanOrEqual(0);
      expect(p.value).toBeLessThanOrEqual(100);
    }
  });
});

describe('macd', () => {
  it('returns empty parts for no candles', () => {
    expect(macd([])).toEqual({ macd: [], signal: [], histogram: [] });
  });

  it('aligns the three parts and keeps histogram = macd − signal', () => {
    const series = candles(Array.from({ length: 60 }, (_, i) => 100 + i));
    const out = macd(series);
    expect(out.macd.length).toBe(out.signal.length);
    expect(out.macd.length).toBe(out.histogram.length);
    for (let i = 0; i < out.macd.length; i++) {
      expect(out.histogram[i].value).toBeCloseTo(out.macd[i].value - out.signal[i].value);
      expect(out.histogram[i].time).toBe(out.macd[i].time);
    }
  });

  it('is positive on a steadily rising series (fast EMA leads slow)', () => {
    const out = macd(candles(Array.from({ length: 60 }, (_, i) => 100 + i)));
    expect(out.macd[out.macd.length - 1].value).toBeGreaterThan(0);
  });
});

describe('vwap', () => {
  it('weights by volume cumulatively', () => {
    // typical prices 10 and 20; volumes 1 and 3 → (10·1)/1 then (10·1+20·3)/4.
    const out = vwap(ohlcv([
      [10, 10, 10, 1],
      [20, 20, 20, 3],
    ]));
    expect(out[0].value).toBeCloseTo(10);
    expect(out[1].value).toBeCloseTo(17.5);
  });

  it('falls back to typical price when there is no volume', () => {
    const out = vwap(ohlcv([[12, 6, 9, 0]])); // typical = (12+6+9)/3 = 9
    expect(out[0].value).toBeCloseTo(9);
  });
});

describe('volumeProfile', () => {
  it('is empty for no candles', () => {
    expect(volumeProfile([])).toEqual({ bins: [], pocIndex: -1, maxVolume: 0 });
  });

  it('conserves total volume across the bins', () => {
    const rows: Array<[number, number, number, number]> = [
      [10, 10, 10, 5],
      [20, 20, 20, 3],
      [30, 30, 30, 8],
    ];
    const { bins } = volumeProfile(ohlcv(rows), 8);
    const total = bins.reduce((s, b) => s + b.volume, 0);
    expect(total).toBe(16);
  });

  it('marks the heaviest bucket as the point of control', () => {
    const { bins, pocIndex, maxVolume } = volumeProfile(
      ohlcv([
        [10, 10, 10, 1],
        [50, 50, 50, 9], // dominant level
        [30, 30, 30, 2],
      ]),
      8,
    );
    expect(maxVolume).toBe(9);
    expect(bins[pocIndex].priceLow).toBeLessThanOrEqual(50);
    expect(bins[pocIndex].priceHigh).toBeGreaterThanOrEqual(50);
  });
});
