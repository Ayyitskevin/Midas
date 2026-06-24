import { describe, it, expect } from 'vitest';
import { treemap, heatColor, type TreemapTile } from '@/lib/heatmap';

const area = (t: TreemapTile) => t.w * t.h;
const within = (t: TreemapTile, w: number, h: number) =>
  t.x >= -1e-6 && t.y >= -1e-6 && t.x + t.w <= w + 1e-6 && t.y + t.h <= h + 1e-6;

describe('treemap', () => {
  it('returns nothing for empty input or a zero box', () => {
    expect(treemap([], 100, 100)).toEqual([]);
    expect(treemap([{ key: 'a', value: 1 }], 0, 100)).toEqual([]);
  });

  it('drops non-positive / non-finite values', () => {
    const tiles = treemap(
      [
        { key: 'a', value: 1 },
        { key: 'b', value: 0 },
        { key: 'c', value: -5 },
        { key: 'd', value: NaN },
      ],
      100,
      100,
    );
    expect(tiles.map((t) => t.key)).toEqual(['a']);
  });

  it('a single item fills the whole box', () => {
    const [t] = treemap([{ key: 'a', value: 7 }], 200, 120);
    expect(t).toEqual({ key: 'a', x: 0, y: 0, w: 200, h: 120 });
  });

  it('tiles stay within bounds and exactly cover the area', () => {
    const items = [
      { key: 'a', value: 50 },
      { key: 'b', value: 30 },
      { key: 'c', value: 15 },
      { key: 'd', value: 5 },
    ];
    const W = 400;
    const H = 300;
    const tiles = treemap(items, W, H);
    expect(tiles).toHaveLength(4);
    for (const t of tiles) expect(within(t, W, H)).toBe(true);
    expect(tiles.reduce((s, t) => s + area(t), 0)).toBeCloseTo(W * H, 3);
  });

  it('tile area is proportional to value', () => {
    const W = 100;
    const H = 100;
    const byKey = Object.fromEntries(
      treemap([{ key: 'a', value: 75 }, { key: 'b', value: 25 }], W, H).map((t) => [t.key, t]),
    );
    expect(area(byKey.a) / (W * H)).toBeCloseTo(0.75, 4);
    expect(area(byKey.b) / (W * H)).toBeCloseTo(0.25, 4);
  });
});

describe('heatColor', () => {
  const alpha = (s: string) => Number(s.match(/,([0-9.]+)\)$/)![1]);

  it('is green for gains, red for losses', () => {
    expect(heatColor(5)).toContain('38,194,129');
    expect(heatColor(-5)).toContain('239,77,86');
  });

  it('scales opacity with magnitude and clamps at the cap', () => {
    expect(alpha(heatColor(7))).toBeGreaterThan(alpha(heatColor(1)));
    expect(alpha(heatColor(100))).toBeCloseTo(alpha(heatColor(8)));
  });

  it('treats 0 / non-finite as a faint gain colour', () => {
    expect(heatColor(0)).toContain('38,194,129');
    expect(heatColor(NaN)).toContain('38,194,129');
  });
});
