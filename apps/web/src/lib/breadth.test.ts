import { describe, it, expect } from 'vitest';
import { breadth } from './breadth';

const times = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('breadth', () => {
  it('reports 100% when every symbol rises above its MA', () => {
    const b = breadth([[1, 2, 3, 4, 5]], times(5), 2);
    expect(b.points).toHaveLength(4); // t = 1..4
    expect(b.points.every((p) => p.pct === 100)).toBe(true);
    expect(b.points[0].above).toBe(1);
    expect(b.points[0].total).toBe(1);
  });

  it('tracks the fraction above the MA across symbols and time', () => {
    const alwaysAbove = [1, 2, 3, 4, 5];
    const choppy = [1, 2, 1, 2, 1]; // alternates above / below its 2-day MA
    const b = breadth([alwaysAbove, choppy], times(5), 2);
    expect(b.points.map((p) => p.pct)).toEqual([100, 50, 100, 50]);
    expect(b.current).toBe(50);
    expect(b.max).toBe(100);
    expect(b.min).toBe(50);
    expect(b.mean).toBeCloseTo(75, 10);
  });

  it('trailing-aligns symbols of unequal length', () => {
    const long = [9, 9, 1, 2, 3, 4, 5]; // last 5 match the basket above
    const choppy = [1, 2, 1, 2, 1];
    const b = breadth([long, choppy], times(7), 2);
    expect(b.points.map((p) => p.pct)).toEqual([100, 50, 100, 50]);
    expect(b.points[0].time).toBe(3); // aligned to the trailing window
  });

  it('returns an empty result without symbols or a fitting window', () => {
    expect(breadth([], times(5), 2).points).toHaveLength(0);
    expect(breadth([[1, 2, 3]], times(3), 1).current).toBeNull(); // window < 2
    expect(breadth([[1, 2]], times(2), 5).current).toBeNull(); // length < window
  });
});
