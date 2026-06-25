import { describe, it, expect } from 'vitest';
import { rollingBeta, meanOf } from '@/lib/rollingBeta';

describe('rollingBeta', () => {
  const bench = [0.01, -0.02, 0.03, -0.01, 0.02, 0.0, 0.015, -0.005];

  it('tracks beta/correlation over each trailing window', () => {
    const asset = bench.map((r) => 2 * r); // perfectly 2× the benchmark
    const pts = rollingBeta(asset, bench, 4);
    expect(pts).toHaveLength(bench.length - 4 + 1); // 5 windows
    expect(pts[0].index).toBe(3);
    for (const p of pts) {
      expect(p.beta).toBeCloseTo(2, 6);
      expect(p.correlation).toBeCloseTo(1, 6);
    }
  });

  it('reflects a regime change between window slices', () => {
    // first half moves with the benchmark, second half inverts
    const asset = bench.map((r, i) => (i < 4 ? r : -r));
    const pts = rollingBeta(asset, bench, 4);
    expect(pts[0].beta).toBeCloseTo(1, 6); // window [0..3]: asset == bench
    expect(pts[pts.length - 1].beta).toBeCloseTo(-1, 6); // window [4..7]: asset == −bench
  });

  it('returns nothing when the window is larger than the data or < 2', () => {
    expect(rollingBeta([0.01, 0.02], [0.01, 0.02], 5)).toEqual([]);
    expect(rollingBeta(bench, bench, 1)).toEqual([]);
  });
});

describe('meanOf', () => {
  it('averages the chosen field', () => {
    const pts = [
      { index: 0, beta: 1, correlation: 0.5 },
      { index: 1, beta: 3, correlation: 0.9 },
    ];
    expect(meanOf(pts, (p) => p.beta)).toBe(2);
    expect(meanOf(pts, (p) => p.correlation)).toBeCloseTo(0.7, 9);
    expect(meanOf([], (p) => p.beta)).toBe(0);
  });
});
