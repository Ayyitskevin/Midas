import { describe, it, expect } from 'vitest';
import { regress } from '@/lib/scatter';

describe('regress', () => {
  const x = [-0.02, -0.01, 0, 0.01, 0.02, 0.03];

  it('recovers slope, intercept and a perfect fit for y = 2x + 0.5', () => {
    const y = x.map((v) => 2 * v + 0.5);
    const r = regress(x, y)!;
    expect(r.slope).toBeCloseTo(2, 9);
    expect(r.intercept).toBeCloseTo(0.5, 9);
    expect(r.correlation).toBeCloseTo(1, 9);
    expect(r.r2).toBeCloseTo(1, 9);
    expect(r.n).toBe(6);
  });

  it('handles an inverse relationship', () => {
    const y = x.map((v) => -v);
    const r = regress(x, y)!;
    expect(r.slope).toBeCloseTo(-1, 9);
    expect(r.correlation).toBeCloseTo(-1, 9);
    expect(r.r2).toBeCloseTo(1, 9);
  });

  it('gives a partial r² for a noisy relationship', () => {
    const y = [-0.018, -0.013, 0.002, 0.008, 0.025, 0.022];
    const r = regress(x, y)!;
    expect(r.slope).toBeGreaterThan(0);
    expect(r.r2).toBeGreaterThan(0.5);
    expect(r.r2).toBeLessThan(1);
  });

  it('returns null for constant x or too few points', () => {
    expect(regress([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(regress([0.01], [0.02])).toBeNull();
  });
});
