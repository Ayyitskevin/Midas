import { describe, it, expect } from 'vitest';
import { logReturns, projectCone } from '@/lib/montecarlo';

describe('logReturns', () => {
  it('takes natural logs of price ratios', () => {
    const lr = logReturns([100, 110, 99]);
    expect(lr[0]).toBeCloseTo(Math.log(1.1), 9);
    expect(lr[1]).toBeCloseTo(Math.log(99 / 110), 9);
  });
});

describe('projectCone', () => {
  it('starts at the spot price with a zero-width fan on day 0', () => {
    const p = projectCone([100, 101, 99, 102, 98, 103], 30)!;
    const d0 = p.points[0];
    expect(d0.day).toBe(0);
    expect(d0.p5).toBeCloseTo(p.s0, 9);
    expect(d0.p50).toBeCloseTo(p.s0, 9);
    expect(d0.p95).toBeCloseTo(p.s0, 9);
  });

  it('keeps percentiles ordered and the fan widening with the horizon', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 8 + i * 0.2);
    const p = projectCone(closes, 30)!;
    for (const pt of p.points) {
      expect(pt.p5).toBeLessThanOrEqual(pt.p25 + 1e-9);
      expect(pt.p25).toBeLessThanOrEqual(pt.p50 + 1e-9);
      expect(pt.p50).toBeLessThanOrEqual(pt.p75 + 1e-9);
      expect(pt.p75).toBeLessThanOrEqual(pt.p95 + 1e-9);
    }
    const width = (pt: { p5: number; p95: number }) => pt.p95 - pt.p5;
    expect(width(p.points[30])).toBeGreaterThan(width(p.points[1]));
  });

  it('matches the closed-form lognormal quantile at day 1', () => {
    // alternating ±1% log moves → m = 0, s = 0.01
    const closes = [100];
    for (let i = 1; i < 21; i++) closes.push(closes[i - 1] * Math.exp(i % 2 ? 0.01 : -0.01));
    const p = projectCone(closes, 10)!;
    expect(p.driftDaily).toBeCloseTo(0, 6);
    expect(p.volDaily).toBeCloseTo(0.01, 6);
    const d1 = p.points[1];
    expect(d1.p95).toBeCloseTo(p.s0 * Math.exp(0.01 * 1.6448536), 6);
    expect(d1.p5).toBeCloseTo(p.s0 * Math.exp(-0.01 * 1.6448536), 6);
    expect(d1.p50).toBeCloseTo(p.s0, 9);
  });

  it('stays flat with zero vol and is null on thin history', () => {
    const flat = projectCone([100, 100, 100, 100], 10)!;
    expect(flat.volDaily).toBe(0);
    expect(flat.points[10].p5).toBeCloseTo(100, 9);
    expect(flat.points[10].p95).toBeCloseTo(100, 9);
    expect(projectCone([100], 10)).toBeNull();
    expect(projectCone([100, 110], 0)).toBeNull();
  });
});
