import { describe, it, expect } from 'vitest';
import { monthEndCloses, monthlyReturns, monthlyGrid } from '@/lib/monthlyReturns';
import type { Candle } from '@midas/shared';

// Candle at a UTC date (seconds), only close matters here.
const c = (y: number, m: number, d: number, close: number): Candle => ({
  time: Date.UTC(y, m, d) / 1000,
  open: close,
  high: close,
  low: close,
  close,
  volume: 0,
});

describe('monthEndCloses', () => {
  it('keeps the last close of each calendar month, in order', () => {
    const ends = monthEndCloses([c(2024, 0, 15, 95), c(2024, 0, 31, 100), c(2024, 1, 28, 110)]);
    expect(ends).toEqual([
      { year: 2024, month: 0, close: 100 },
      { year: 2024, month: 1, close: 110 },
    ]);
  });
});

describe('monthlyReturns', () => {
  it('computes month-over-month returns and skips the first month', () => {
    const r = monthlyReturns([c(2024, 0, 31, 100), c(2024, 1, 28, 110), c(2024, 2, 31, 99)]);
    expect(r).toEqual([
      { year: 2024, month: 1, ret: expect.closeTo(0.1, 9) },
      { year: 2024, month: 2, ret: expect.closeTo(-0.1, 9) },
    ]);
  });
});

describe('monthlyGrid', () => {
  const candles = [
    c(2023, 11, 31, 100), // Dec 2023 anchor
    c(2024, 0, 31, 110), // Jan +10%
    c(2024, 1, 29, 99), // Feb −10%
    c(2024, 2, 31, 99), // Mar 0%
  ];

  it('lays returns into a year × month grid with a compounded total', () => {
    const g = monthlyGrid(candles);
    expect(g.years).toHaveLength(1);
    const y = g.years[0];
    expect(y.year).toBe(2024);
    expect(y.months[0]).toBeCloseTo(0.1, 9); // Jan
    expect(y.months[1]).toBeCloseTo(-0.1, 9); // Feb
    expect(y.months[2]).toBeCloseTo(0, 9); // Mar
    expect(y.months[11]).toBeNull(); // Dec 2024 has no data
    expect(y.total).toBeCloseTo(1.1 * 0.9 * 1.0 - 1, 9); // −0.01
    expect(g.best).toBeCloseTo(0.1, 9);
    expect(g.worst).toBeCloseTo(-0.1, 9);
  });

  it('orders multiple years most-recent first and is empty-safe', () => {
    const multi = monthlyGrid([c(2022, 10, 30, 50), c(2022, 11, 31, 55), ...candles]);
    expect(multi.years.map((r) => r.year)).toEqual([2024, 2023, 2022]);
    expect(monthlyGrid([]).years).toEqual([]);
  });
});
