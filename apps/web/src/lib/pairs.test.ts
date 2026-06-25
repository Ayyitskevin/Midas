import { describe, it, expect } from 'vitest';
import { rollingStats, halfLife, pairStats } from '@/lib/pairs';

describe('rollingStats', () => {
  it('is NaN through the warm-up, then a trailing mean/std/z', () => {
    const s = rollingStats([2, 4, 6, 8], 3);
    expect(Number.isNaN(s[1].mean)).toBe(true);
    // window [2,4,6]: mean 4, sd √(8/3)≈1.633; z of 6 = (6−4)/1.633 ≈ 1.2247
    expect(s[2].mean).toBeCloseTo(4, 6);
    expect(s[2].std).toBeCloseTo(Math.sqrt(8 / 3), 6);
    expect(s[2].z).toBeCloseTo(1.224745, 5);
  });

  it('reports z = 0 for a flat window', () => {
    expect(rollingStats([5, 5, 5], 3)[2].z).toBe(0);
  });
});

describe('halfLife', () => {
  it('recovers ~1 period from a geometric decay toward a mean (β = −0.5)', () => {
    const xs = [10];
    for (let i = 1; i < 20; i++) xs.push(5 + (xs[i - 1] - 5) * 0.5);
    expect(halfLife(xs)).toBeCloseTo(1, 4);
  });

  it('is null for a pure trend (not mean-reverting)', () => {
    expect(halfLife(Array.from({ length: 20 }, (_, i) => i))).toBeNull();
  });

  it('is null for a constant series', () => {
    expect(halfLife([3, 3, 3, 3, 3])).toBeNull();
  });
});

describe('pairStats', () => {
  it('flags a stretched-high ratio as rich and a stretched-low as cheap', () => {
    const lowVar = [10, 10.1, 9.9, 10, 10.05, 9.95, 10]; // tight band…
    const rich = pairStats([...lowVar, 11], 7); // …then a big spike up
    expect(rich.z).toBeGreaterThanOrEqual(2);
    expect(rich.signal).toBe('rich');

    const cheap = pairStats([...lowVar, 9], 7);
    expect(cheap.z).toBeLessThanOrEqual(-2);
    expect(cheap.signal).toBe('cheap');
  });

  it('stays neutral inside the band and exposes the latest level', () => {
    const xs = [10, 10.1, 9.9, 10, 10.05, 9.95, 10.02];
    const r = pairStats(xs, 7);
    expect(r.signal).toBe('neutral');
    expect(r.ratio).toBe(10.02);
    expect(Number.isFinite(r.mean)).toBe(true);
  });
});
