import { describe, it, expect } from 'vitest';
import type { Candle } from '@midas/shared';
import { rebasePercent, totalReturnPct } from '@/lib/compare';

/** Build candles from a close-price series. */
const candles = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({ time: i, open: close, high: close, low: close, close, volume: 0 }));

describe('rebasePercent', () => {
  it('rebases closes to percent change from the first bar', () => {
    const out = rebasePercent(candles([100, 110, 90, 100]));
    const values = out.map((p) => p.value);
    expect(values).toHaveLength(4);
    [0, 10, -10, 0].forEach((expected, i) => expect(values[i]).toBeCloseTo(expected));
    expect(out[0].time).toBe(0);
  });

  it('returns nothing for an empty series or a non-positive base', () => {
    expect(rebasePercent([])).toEqual([]);
    expect(rebasePercent(candles([0, 5]))).toEqual([]);
  });
});

describe('totalReturnPct', () => {
  it('measures first→last percent change', () => {
    expect(totalReturnPct(candles([100, 120, 150]))).toBeCloseTo(50);
    expect(totalReturnPct(candles([200, 100]))).toBeCloseTo(-50);
  });

  it('is 0 with fewer than two points or a bad base', () => {
    expect(totalReturnPct(candles([100]))).toBe(0);
    expect(totalReturnPct([])).toBe(0);
    expect(totalReturnPct(candles([0, 100]))).toBe(0);
  });
});
