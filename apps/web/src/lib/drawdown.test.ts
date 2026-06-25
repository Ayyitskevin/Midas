import { describe, it, expect } from 'vitest';
import {
  drawdownSeries,
  drawdownStats,
  drawdownBoard,
  sortDrawdown,
  type DrawdownRow,
} from '@/lib/drawdown';

describe('drawdownSeries', () => {
  it('is zero at new highs and peak-relative below them', () => {
    const dd = drawdownSeries([100, 110, 99, 108]);
    expect(dd[0]).toBe(0);
    expect(dd[1]).toBe(0); // new high
    expect(dd[2]).toBeCloseTo(99 / 110 - 1, 9); // ≈ −0.0909
    expect(dd[3]).toBeCloseTo(108 / 110 - 1, 9); // ≈ −0.0182
  });
});

describe('drawdownStats', () => {
  it('finds the worst and current drawdown and counts time underwater', () => {
    const s = drawdownStats([100, 110, 99, 108]);
    expect(s.maxDD).toBeCloseTo(99 / 110 - 1, 9);
    expect(s.curDD).toBeCloseTo(108 / 110 - 1, 9);
    expect(s.underwater).toBe(2); // last two points are below the 110 peak
    expect(s.longestUW).toBe(2);
  });

  it('reports zero current drawdown at a fresh high', () => {
    const s = drawdownStats([100, 95, 101]);
    expect(s.curDD).toBe(0);
    expect(s.underwater).toBe(0);
    expect(s.maxDD).toBeCloseTo(95 / 100 - 1, 9);
  });

  it('tracks the longest underwater run separately from the trailing one', () => {
    // dips, recovers to a high, dips once at the end
    const s = drawdownStats([100, 90, 80, 120, 118]);
    expect(s.longestUW).toBe(2); // the 90,80 stretch
    expect(s.underwater).toBe(1); // only the final 118
  });
});

describe('drawdownBoard / sortDrawdown', () => {
  const series = [
    { symbol: 'DEEP/USDT', closes: [100, 60, 70] }, // −40% worst
    { symbol: 'MILD/USDT', closes: [100, 98, 102, 101] }, // shallow
    { symbol: 'SHORT/USDT', closes: [100] }, // too short
  ];

  it('skips short series and ranks worst drawdown first', () => {
    const rows = drawdownBoard(series, 'maxDD');
    expect(rows.map((r) => r.symbol)).toEqual(['DEEP/USDT', 'MILD/USDT']);
    expect(rows[0].maxDD).toBeCloseTo(-0.4, 9);
  });

  const rows: DrawdownRow[] = [
    { symbol: 'A', dd: [], maxDD: -0.1, curDD: -0.05, underwater: 3, longestUW: 5 },
    { symbol: 'B', dd: [], maxDD: -0.4, curDD: 0, underwater: 0, longestUW: 8 },
    { symbol: 'C', dd: [], maxDD: -0.2, curDD: -0.2, underwater: 10, longestUW: 10 },
  ];

  it('sorts by the chosen key without mutating input', () => {
    expect(sortDrawdown(rows, 'maxDD').map((r) => r.symbol)).toEqual(['B', 'C', 'A']);
    expect(sortDrawdown(rows, 'curDD').map((r) => r.symbol)).toEqual(['C', 'A', 'B']);
    expect(sortDrawdown(rows, 'underwater').map((r) => r.symbol)).toEqual(['C', 'A', 'B']);
    const before = rows.map((r) => r.symbol);
    sortDrawdown(rows, 'symbol');
    expect(rows.map((r) => r.symbol)).toEqual(before);
  });
});
