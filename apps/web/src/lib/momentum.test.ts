import { describe, it, expect } from 'vitest';
import { pctReturn, computeMomentum } from '@/lib/momentum';

describe('pctReturn', () => {
  it('computes the return over the given number of bars', () => {
    expect(pctReturn([100, 110], 1)).toBeCloseTo(10);
    expect(pctReturn([100, 105, 90], 2)).toBeCloseTo(-10); // 90 vs 100, two bars back
  });

  it('returns null when there are too few bars', () => {
    expect(pctReturn([100], 1)).toBeNull();
    expect(pctReturn([100, 110], 5)).toBeNull();
  });

  it('rejects non-positive prices and non-positive bars', () => {
    expect(pctReturn([0, 110], 1)).toBeNull();
    expect(pctReturn([100, 0], 1)).toBeNull();
    expect(pctReturn([100, 110], 0)).toBeNull();
  });
});

describe('computeMomentum', () => {
  it('computes look-back returns and the composite score', () => {
    const closes = Array<number>(31).fill(100);
    closes[0] = 80; // 30 bars before the last
    closes[30] = 110; // last; closes[23] (7 ago) and closes[29] (1 ago) stay 100
    const m = computeMomentum(closes);
    expect(m.lastClose).toBe(110);
    expect(m.r24h).toBeCloseTo(10); // 110 / 100
    expect(m.r7d).toBeCloseTo(10); // 110 / 100
    expect(m.r30d).toBeCloseTo(37.5); // 110 / 80
    expect(m.score).toBeCloseTo((10 + 10 + 37.5) / 3);
  });

  it('uses only the available look-backs in the score', () => {
    const m = computeMomentum([100, 110]); // only 24h is defined
    expect(m.r24h).toBeCloseTo(10);
    expect(m.r7d).toBeNull();
    expect(m.r30d).toBeNull();
    expect(m.score).toBeCloseTo(10);
  });

  it('degrades to nulls on an empty series', () => {
    const m = computeMomentum([]);
    expect(m.lastClose).toBe(0);
    expect(m.r24h).toBeNull();
    expect(m.score).toBeNull();
  });
});
