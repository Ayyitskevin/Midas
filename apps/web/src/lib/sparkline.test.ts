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

  // A gap must break the stroke and keep every later point at its own x.
  // Compressing the series instead would redraw the window shorter than it is.
  it('breaks the stroke at a gap without shifting later points left', () => {
    // 5 slots over width 40 → x = 0,10,20,30,40. Slot 2 is missing, so the
    // stroke ends at x10 and restarts at x30 — slots 3 and 4 do NOT slide left.
    // min/max span the present values (1..5): range 4, pad 1, usableH 10.
    const d = sparklinePath([1, 2, null, 4, 5], 40, 12);
    expect(d).toBe('M0 11 L10 8.5 M30 3.5 L40 1');
    expect(d).toContain('L40 1'); // last point still reaches the right edge
    // Contrast: dropping the gap would pull slot 3 to x13.33 and slot 4 to x20.
    expect(sparklinePath([1, 2, 4, 5], 40, 12)).not.toContain('M30 ');
  });

  it('drops runs too short to stroke and returns empty when nothing is adjacent', () => {
    // Every other slot present → no two adjacent points → nothing to draw.
    expect(sparklinePath([1, null, 3, null, 5], 40, 12)).toBe('');
    expect(sparklinePath([null, null], 40, 12)).toBe('');
    // A single trailing pair still draws, anchored at its real x positions.
    expect(sparklinePath([null, null, 0, 10], 30, 10)).toBe('M20 9 L30 1');
  });

  it('ignores non-finite values like gaps', () => {
    expect(sparklinePath([0, Number.NaN, 10], 20, 10)).toBe('');
    expect(sparklinePath([0, 10, Number.POSITIVE_INFINITY], 20, 10)).toBe('M0 9 L10 1');
  });
});
