import { describe, it, expect } from 'vitest';
import { volCones } from './volCones';

const ANN = Math.sqrt(365);

describe('volCones', () => {
  it('collapses to a point when every window has the same vol', () => {
    // Alternating ±1% returns → every 2-window has population stdev 1%.
    const r = [0.01, -0.01, 0.01, -0.01, 0.01, -0.01];
    const { points } = volCones(r, [2]);
    expect(points).toHaveLength(1);
    const p = points[0];
    expect(p.horizon).toBe(2);
    expect(p.samples).toBe(5);
    expect(p.min).toBeCloseTo(0.01 * ANN, 8);
    expect(p.max).toBeCloseTo(0.01 * ANN, 8);
    expect(p.p50).toBeCloseTo(0.01 * ANN, 8);
    expect(p.current).toBeCloseTo(0.01 * ANN, 8);
    expect(p.rank).toBe(1);
  });

  it('ranks the current window inside the cone', () => {
    const r = [0.04, -0.04, 0, 0, 0.02, -0.02];
    const p = volCones(r, [2]).points[0];
    expect(p.samples).toBe(5);
    expect(p.min).toBeCloseTo(0, 10);
    expect(p.max).toBeCloseTo(0.04 * ANN, 8);
    expect(p.p50).toBeCloseTo(0.02 * ANN, 8);
    // Last window is [0.02,−0.02] → vol 2%, with 4 of 5 windows at or below it.
    expect(p.current).toBeCloseTo(0.02 * ANN, 8);
    expect(p.rank).toBeCloseTo(0.8, 10);
    expect(p.min).toBeLessThanOrEqual(p.p25);
    expect(p.p25).toBeLessThanOrEqual(p.p50);
    expect(p.p50).toBeLessThanOrEqual(p.p75);
    expect(p.p75).toBeLessThanOrEqual(p.max);
  });

  it('drops, dedupes and sorts horizons', () => {
    const r = [0.01, -0.02, 0.015, -0.01, 0.02, -0.015];
    const { points } = volCones(r, [10, 2, 2, 3]); // 10 too long, 2 duplicated
    expect(points.map((p) => p.horizon)).toEqual([2, 3]);
    expect(points[1].samples).toBe(4); // 6 − 3 + 1
  });

  it('scales with the annualization factor', () => {
    const r = [0.01, -0.01, 0.01, -0.01, 0.01, -0.01];
    const p252 = volCones(r, [2], 252).points[0];
    expect(p252.p50).toBeCloseTo(0.01 * Math.sqrt(252), 8);
  });

  it('returns no points when nothing can be measured', () => {
    expect(volCones([], [10]).points).toHaveLength(0);
    expect(volCones([0.01, 0.02], [10]).points).toHaveLength(0); // shorter than horizon
    expect(volCones([0.01, -0.01, 0.02], [1, 0, -5]).points).toHaveLength(0); // all horizons < 2
  });
});
