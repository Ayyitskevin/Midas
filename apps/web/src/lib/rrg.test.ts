import { describe, it, expect } from 'vitest';
import { quadrantOf, rollingZScore, rrgFor } from '@/lib/rrg';

describe('quadrantOf', () => {
  it('maps the four corners (and the 100/100 boundary to leading)', () => {
    expect(quadrantOf(101, 101)).toBe('leading');
    expect(quadrantOf(101, 99)).toBe('weakening');
    expect(quadrantOf(99, 99)).toBe('lagging');
    expect(quadrantOf(99, 101)).toBe('improving');
    expect(quadrantOf(100, 100)).toBe('leading');
  });
});

describe('rollingZScore', () => {
  it('is NaN through the warm-up, then the trailing z-score', () => {
    const z = rollingZScore([1, 2, 3, 4, 5], 3);
    expect(Number.isNaN(z[0])).toBe(true);
    expect(Number.isNaN(z[1])).toBe(true);
    // window [1,2,3]: mean 2, sd √(2/3); (3−2)/sd ≈ 1.2247
    expect(z[2]).toBeCloseTo(1.224745, 5);
    expect(z[4]).toBeCloseTo(1.224745, 5);
  });

  it('yields 0 for a zero-variance window and NaN if the window spans a NaN', () => {
    expect(rollingZScore([5, 5, 5], 3)[2]).toBe(0);
    expect(Number.isNaN(rollingZScore([NaN, 1, 2], 3)[2])).toBe(true);
  });
});

describe('rrgSeries / rrgFor', () => {
  const flatBench = Array.from({ length: 30 }, () => 100);

  it('returns null without enough history for a finite point', () => {
    expect(rrgFor('X', [1, 2], [1, 2], 10, 8)).toBeNull();
  });

  it('places an accelerating out-performer on the strong (ratio>100) side', () => {
    // Asset pulls away from a flat benchmark at an increasing pace.
    const asset = Array.from({ length: 30 }, (_, i) => 100 * (1 + 0.0005 * i * i));
    const res = rrgFor('UP', asset, flatBench, 10, 8)!;
    expect(res).not.toBeNull();
    expect(res.ratio).toBeGreaterThan(100); // relative strength above its norm
    expect(res.quadrant).toBe(quadrantOf(res.ratio, res.mom));
    expect(res.tail.length).toBeLessThanOrEqual(8);
    expect(res.tail[res.tail.length - 1]).toEqual({ ratio: res.ratio, mom: res.mom });
  });

  it('places a steadily fading laggard on the weak (ratio<100) side', () => {
    // Asset bleeds vs the benchmark, faster over time.
    const asset = Array.from({ length: 30 }, (_, i) => 100 * (1 - 0.0005 * i * i));
    const res = rrgFor('DN', asset, flatBench, 10, 8)!;
    expect(res.ratio).toBeLessThan(100);
  });

  it('keeps the tail chronological and finite', () => {
    const asset = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i);
    const res = rrgFor('OSC', asset, flatBench, 10, 6)!;
    expect(res.tail.every((p) => Number.isFinite(p.ratio) && Number.isFinite(p.mom))).toBe(true);
    expect(res.tail.length).toBe(6);
  });
});
