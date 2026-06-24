import { describe, it, expect } from 'vitest';
import type { Candle } from '@midas/shared';
import { combineSeries } from '@/lib/ratio';

/** Build candles from [time, close] pairs. */
const series = (xs: Array<[number, number]>): Candle[] =>
  xs.map(([time, close]) => ({ time, open: close, high: close, low: close, close, volume: 0 }));

describe('combineSeries', () => {
  it('computes the ratio A/B at aligned timestamps', () => {
    const a = series([[0, 100], [1, 200]]);
    const b = series([[0, 50], [1, 50]]);
    expect(combineSeries(a, b, 'ratio')).toEqual([
      { time: 0, value: 2 },
      { time: 1, value: 4 },
    ]);
  });

  it('computes the spread A−B', () => {
    const a = series([[0, 100], [1, 200]]);
    const b = series([[0, 50], [1, 50]]);
    expect(combineSeries(a, b, 'spread')).toEqual([
      { time: 0, value: 50 },
      { time: 1, value: 150 },
    ]);
  });

  it('only emits points present in both series', () => {
    const a = series([[0, 10], [1, 20], [2, 30]]);
    const b = series([[1, 5]]); // only time 1 overlaps
    expect(combineSeries(a, b, 'ratio')).toEqual([{ time: 1, value: 4 }]);
  });

  it('drops ratio points where the denominator is non-positive', () => {
    const a = series([[0, 10], [1, 20]]);
    const b = series([[0, 0], [1, 5]]);
    expect(combineSeries(a, b, 'ratio')).toEqual([{ time: 1, value: 4 }]);
  });
});
