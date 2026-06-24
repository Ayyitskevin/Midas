import { describe, it, expect } from 'vitest';
import { sma, ema, bollinger, rsi } from '@/lib/indicators';
import type { Candle } from '@midas/shared';

/** Build flat OHLCV candles from a close-price series. */
const candles = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({ time: i, open: close, high: close, low: close, close, volume: 0 }));

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
