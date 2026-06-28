import { describe, it, expect } from 'vitest';
import { computeCoral, coralBoard, sortCoral, type CoralRow } from './coral';

// Primary fixture — independently verified by a multi-agent workflow against
// LazyBear's published Coral source (reference impl + two adversarial
// recomputations, all machine-zero). Zero-seeded 6-stage cascade, L=3, cd=0.4:
// rising closes 10→17 give a steadily rising coral, so direction = up.
const up = [10, 11, 12, 13, 14, 15, 16, 17];
// Same climb then one lower close → the (lagging) coral turns down on the last
// bar: a fresh down flip (age 1).
const flipDown = [10, 11, 12, 13, 14, 15, 16, 17, 15];
// Extended decline → an older (age 4) downtrend.
const down = [10, 11, 12, 13, 14, 15, 16, 17, 15, 12, 9, 6];

describe('computeCoral', () => {
  it('matches the workflow-verified coral value on a rising series', () => {
    const r = computeCoral(up, 3, 0.4)!;
    expect(r.coral).toBeCloseTo(16.108376, 6);
    expect(r.direction).toBe('up');
    expect(r.age).toBe(7);
    expect(r.flip).toBe(false);
    expect(r.distPct).toBeCloseTo(5.5352, 3);
    expect(r.n).toBe(8);
  });

  it('fires a fresh down flip when the coral turns over', () => {
    const r = computeCoral(flipDown, 3, 0.4)!;
    expect(r.coral).toBeCloseTo(15.8101, 3);
    expect(r.direction).toBe('down');
    expect(r.age).toBe(1);
    expect(r.flip).toBe(true);
  });

  it('ages an established downtrend', () => {
    const r = computeCoral(down, 3, 0.4)!;
    expect(r.direction).toBe('down');
    expect(r.age).toBe(4);
    expect(r.flip).toBe(false);
  });

  it('keeps direction and distPct scale-invariant', () => {
    const r = computeCoral(up, 3, 0.4)!;
    const scaled = computeCoral(
      up.map((c) => c * 1000),
      3,
      0.4,
    )!;
    expect(scaled.direction).toBe(r.direction);
    expect(scaled.distPct).toBeCloseTo(r.distPct, 9);
  });

  it('returns null with fewer than 2 closes or bad params', () => {
    expect(computeCoral([10], 3, 0.4)).toBeNull();
    expect(computeCoral(up, 0, 0.4)).toBeNull();
    expect(computeCoral(up, 3, 0)).toBeNull();
  });
});

describe('coralBoard', () => {
  const series = [
    { symbol: 'UP', closes: up }, // up, age 7 → score +7
    { symbol: 'FLIPDN', closes: flipDown }, // down, age 1 → score −1
    { symbol: 'DOWN', closes: down }, // down, age 4 → score −4
  ];

  it('defaults to sorting by signed trend persistence (longest uptrends first)', () => {
    const rows = coralBoard(series, 'trend', 3, 0.4);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'FLIPDN', 'DOWN']);
  });

  it('sorts by distance from the coral line', () => {
    const rows = coralBoard(series, 'dist', 3, 0.4);
    expect(rows[0].symbol).toBe('UP'); // most positive distPct
  });

  it('sorts by symbol', () => {
    const rows = coralBoard(series, 'symbol', 3, 0.4);
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'FLIPDN', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = coralBoard(
      [
        { symbol: 'OK', closes: up },
        { symbol: 'THIN', closes: [10] },
      ],
      'trend',
      3,
      0.4,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortCoral', () => {
  it('orders up-trends (by age) above down-trends', () => {
    const rows = [
      { symbol: 'A', direction: 'up', age: 2, distPct: 1 },
      { symbol: 'B', direction: 'up', age: 9, distPct: 1 },
      { symbol: 'C', direction: 'down', age: 5, distPct: 1 },
    ] as CoralRow[];
    expect(sortCoral(rows, 'trend').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
