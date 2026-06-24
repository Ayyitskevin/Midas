import { describe, it, expect } from 'vitest';
import { toReturns, pearson, correlationMatrix, corrColor } from '@/lib/correlation';

describe('toReturns', () => {
  it('computes period-over-period returns', () => {
    const r = toReturns([100, 110, 99]);
    expect(r[0]).toBeCloseTo(0.1, 10);
    expect(r[1]).toBeCloseTo(-0.1, 10);
  });

  it('is empty for fewer than two points', () => {
    expect(toReturns([5])).toEqual([]);
  });
});

describe('pearson', () => {
  it('is 1 for identical series', () => {
    expect(pearson([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1, 10);
  });

  it('is 1 for a positive linear relation', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
  });

  it('is -1 for a perfect inverse', () => {
    expect(pearson([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 10);
  });

  it('is 0 when a series is constant or too short', () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBe(0);
    expect(pearson([1], [1])).toBe(0);
  });
});

describe('correlationMatrix', () => {
  const m = correlationMatrix([
    { symbol: 'A', closes: [100, 110, 105, 120] },
    { symbol: 'B', closes: [200, 220, 210, 240] }, // 2×A → identical returns
    { symbol: 'C', closes: [100, 95, 100, 95] },
  ]);

  it('has a unit diagonal', () => {
    expect(m[0][0]).toBe(1);
    expect(m[1][1]).toBe(1);
    expect(m[2][2]).toBe(1);
  });

  it('scores identically-moving assets at +1', () => {
    expect(m[0][1]).toBeCloseTo(1, 6);
  });

  it('is symmetric', () => {
    expect(m[0][2]).toBeCloseTo(m[2][0], 12);
    expect(m[1][2]).toBeCloseTo(m[2][1], 12);
  });
});

describe('corrColor', () => {
  it('greens positives and reds negatives', () => {
    expect(corrColor(0.8)).toContain('38,194,129');
    expect(corrColor(-0.8)).toContain('239,77,86');
  });
});
