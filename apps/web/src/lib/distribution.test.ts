import { describe, it, expect } from 'vitest';
import {
  mean,
  stdev,
  skewness,
  kurtosis,
  quantile,
  historicalVar,
  histogram,
  returnStats,
} from '@/lib/distribution';

describe('moments', () => {
  it('mean / stdev', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 6);
  });

  it('skewness is ~0 for symmetric data and positive for a right tail', () => {
    expect(skewness([1, 2, 3, 4, 5])).toBeCloseTo(0, 9);
    expect(skewness([1, 1, 1, 2, 8])).toBeGreaterThan(0);
  });

  it('excess kurtosis of 1..5 is −1.3', () => {
    expect(kurtosis([1, 2, 3, 4, 5])).toBeCloseTo(-1.3, 9);
  });
});

describe('quantile', () => {
  it('interpolates linearly across the sorted series', () => {
    const xs = [50, 10, 40, 20, 30];
    expect(quantile(xs, 0)).toBe(10);
    expect(quantile(xs, 1)).toBe(50);
    expect(quantile(xs, 0.5)).toBe(30);
    expect(quantile(xs, 0.25)).toBe(20);
  });
});

describe('historicalVar', () => {
  const returns = [-0.1, -0.05, -0.02, 0.0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06];

  it('takes the left-tail quantile as VaR and averages the tail for ES', () => {
    const r90 = historicalVar(returns, 0.9); // p = 0.10 → between −0.10 and −0.05
    expect(r90.var).toBeCloseTo(0.055, 9);
    expect(r90.es).toBeCloseTo(0.1, 9); // only −0.10 is at/below the threshold

    const r80 = historicalVar(returns, 0.8); // p = 0.20 → between −0.05 and −0.02
    expect(r80.var).toBeCloseTo(0.026, 9);
    expect(r80.es).toBeCloseTo(0.075, 9); // mean of −0.10, −0.05
  });

  it('is zero loss when the tail is not negative', () => {
    expect(historicalVar([0.01, 0.02, 0.03], 0.95)).toEqual({ var: 0, es: 0 });
  });
});

describe('histogram', () => {
  it('covers the range and counts every point once', () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const bins = histogram(xs, 5);
    expect(bins).toHaveLength(5);
    expect(bins[0].start).toBeCloseTo(0, 9);
    expect(bins[4].end).toBeCloseTo(10, 9);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(xs.length); // max lands in last bin
  });
});

describe('returnStats', () => {
  it('assembles the moments, range and VaR', () => {
    const returns = [-0.03, -0.01, 0.0, 0.01, 0.02, 0.04];
    const s = returnStats(returns, 0.95);
    expect(s.n).toBe(6);
    expect(s.mean).toBeCloseTo(mean(returns), 9);
    expect(s.vol).toBeCloseTo(stdev(returns), 9);
    expect(s.min).toBe(-0.03);
    expect(s.max).toBe(0.04);
    expect(s.var).toBeGreaterThanOrEqual(0);
  });
});
