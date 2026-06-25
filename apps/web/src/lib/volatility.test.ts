import { describe, it, expect } from 'vitest';
import { trueRange, atr, realizedVolPct, computeVolStats, type VolCandle } from '@/lib/volatility';

const c = (high: number, low: number, close: number): VolCandle => ({ high, low, close });

describe('trueRange', () => {
  it('is the plain range when there is no gap', () => {
    expect(trueRange(10, 8, 9)).toBe(2);
  });
  it('accounts for gaps against the previous close', () => {
    expect(trueRange(10, 8, 6)).toBe(4); // |high - prevClose| dominates
    expect(trueRange(12, 10, 14)).toBe(4); // |low - prevClose| dominates
  });
});

describe('atr', () => {
  it('averages true range over the period', () => {
    const candles = [c(0, 0, 10), c(12, 9, 11), c(13, 10, 12)];
    // TR1 = max(3, |12-10|, |9-10|) = 3; TR2 = max(3, |13-11|, |10-11|) = 3.
    expect(atr(candles, 2)).toBe(3);
  });
  it('returns null with fewer than period+1 candles', () => {
    expect(atr([c(12, 9, 11), c(13, 10, 12)], 2)).toBeNull();
  });
});

describe('realizedVolPct', () => {
  it('is zero for a flat series', () => {
    expect(realizedVolPct([c(0, 0, 100), c(0, 0, 100), c(0, 0, 100)], 365)).toBe(0);
  });

  it('is null for fewer than three closes', () => {
    expect(realizedVolPct([c(0, 0, 100), c(0, 0, 110)], 365)).toBeNull();
  });

  it('scales with the square root of the annualization factor', () => {
    const series = [c(0, 0, 100), c(0, 0, 101), c(0, 0, 99), c(0, 0, 102), c(0, 0, 98)];
    const a = realizedVolPct(series, 365)!;
    const b = realizedVolPct(series, 730)!;
    expect(b / a).toBeCloseTo(Math.sqrt(2));
  });

  it('rejects non-positive closes', () => {
    expect(realizedVolPct([c(0, 0, 100), c(0, 0, 0), c(0, 0, 100)], 365)).toBeNull();
  });
});

describe('computeVolStats', () => {
  it('assembles the dashboard row metrics', () => {
    const candles = [c(102, 98, 100), c(108, 99, 105), c(112, 104, 110)];
    const s = computeVolStats(candles, { atrPeriod: 2, periodsPerYear: 365 });
    expect(s.samples).toBe(3);
    expect(s.lastClose).toBe(110);
    expect(s.changePct).toBeCloseTo(10); // 100 → 110
    expect(s.highLowPct).toBeCloseTo(((112 - 98) / 110) * 100);
    expect(s.atr).not.toBeNull();
    expect(s.atrPct).toBeCloseTo((s.atr! / 110) * 100);
  });

  it('degrades gracefully on an empty series', () => {
    const s = computeVolStats([], { periodsPerYear: 365 });
    expect(s.samples).toBe(0);
    expect(s.atr).toBeNull();
    expect(s.realizedVolPct).toBeNull();
    expect(s.changePct).toBeNull();
    expect(s.highLowPct).toBeNull();
  });
});
