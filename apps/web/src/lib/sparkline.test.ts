import { describe, it, expect } from 'vitest';
import { sparklinePath } from '@/lib/sparkline';

describe('sparklinePath', () => {
  it('returns empty for fewer than two points', () => {
    expect(sparklinePath([], 60, 18)).toBe('');
    expect(sparklinePath([5], 60, 18)).toBe('');
  });

  it('maps an ascending pair from bottom-left to top-right', () => {
    // min 0, max 10, range 10, pad 1, usableH 8.
    // i0 → x0, y = 1 + (1-0)*8 = 9; i1 → x10, y = 1 + (1-1)*8 = 1.
    expect(sparklinePath([0, 10], 10, 10)).toBe('M0 9 L10 1');
  });

  it('draws a flat series along the vertical middle', () => {
    expect(sparklinePath([5, 5, 5], 8, 10)).toBe('M0 5 L4 5 L8 5');
  });

  it('spreads points evenly across the width', () => {
    const d = sparklinePath([1, 2, 3, 4, 5], 40, 12);
    expect(d.startsWith('M0 ')).toBe(true);
    expect(d).toContain('L10 ');
    expect(d).toContain('L40 '); // last point reaches the right edge
    expect(d.match(/L/g)).toHaveLength(4); // 5 points → 4 line segments
  });
});
