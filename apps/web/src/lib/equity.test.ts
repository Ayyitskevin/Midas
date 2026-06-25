import { describe, it, expect } from 'vitest';
import { buildEquityCurve, type RPoint } from '@/lib/equity';

const pts = (rs: number[]): RPoint[] => rs.map((r, i) => ({ at: i, r }));

describe('buildEquityCurve', () => {
  it('accumulates R and tracks the peak', () => {
    const c = buildEquityCurve(pts([1, 2, -1, 3]));
    expect(c.points.map((p) => p.cumR)).toEqual([1, 3, 2, 5]);
    expect(c.totalR).toBeCloseTo(5);
    expect(c.peakR).toBeCloseTo(5);
    expect(c.maxDrawdownR).toBeCloseTo(1); // 3 → 2
  });

  it('measures the largest peak-to-trough drawdown', () => {
    const c = buildEquityCurve(pts([2, -1, -2, 1])); // cum: 2,1,-1,0; peak 2
    expect(c.maxDrawdownR).toBeCloseTo(3); // 2 → -1
    expect(c.totalR).toBeCloseTo(0);
  });

  it('counts an opening loss as drawdown from the 0 baseline', () => {
    const c = buildEquityCurve(pts([-1, -2, -1]));
    expect(c.peakR).toBe(0);
    expect(c.maxDrawdownR).toBeCloseTo(4);
    expect(c.totalR).toBeCloseTo(-4);
  });

  it('reports current and longest streaks', () => {
    const c = buildEquityCurve(pts([1, 2, -1, 3]));
    expect(c.currentStreak).toEqual({ type: 'win', count: 1 });
    expect(c.longestWinStreak).toBe(2); // [1, 2]
    expect(c.longestLossStreak).toBe(1);
    expect(c.wins).toBe(3);
    expect(c.losses).toBe(1);

    const losing = buildEquityCurve(pts([-1, -2, -1]));
    expect(losing.currentStreak).toEqual({ type: 'loss', count: 3 });
  });

  it('orders by close time before accumulating', () => {
    const c = buildEquityCurve([
      { at: 30, r: 3 },
      { at: 10, r: 1 },
      { at: 20, r: -1 },
    ]);
    expect(c.points.map((p) => p.cumR)).toEqual([1, 0, 3]);
  });

  it('handles an empty journal', () => {
    const c = buildEquityCurve([]);
    expect(c.points).toEqual([]);
    expect(c.totalR).toBe(0);
    expect(c.maxDrawdownR).toBe(0);
    expect(c.currentStreak).toEqual({ type: 'none', count: 0 });
  });
});
