import { describe, it, expect } from 'vitest';
import { smaSeries, computeAo, aoBoard, sortAo, type AoBar, type AoRow } from './ao';

const mk = (meds: number[]): AoBar[] => meds.map((m) => ({ high: m + 1, low: m - 1 }));

describe('smaSeries', () => {
  it('computes a trailing SMA aligned to the input', () => {
    const s = smaSeries([2, 4, 6, 8], 2);
    expect(Number.isNaN(s[0])).toBe(true);
    expect(s[1]).toBe(3);
    expect(s[2]).toBe(5);
    expect(s[3]).toBe(7);
  });
});

describe('computeAo', () => {
  it('matches the hand-computed fixture (fast 3 / slow 5)', () => {
    // medians [10,11,13,12,14,16,15]: SMA3[6]=15, SMA5[6]=14 → AO=1; AO%=100·1/15.
    const r = computeAo(mk([10, 11, 13, 12, 14, 16, 15]), 3, 5)!;
    expect(r.ao).toBeCloseTo(1, 10);
    expect(r.aoPct).toBeCloseTo(6.666666666666667, 10);
    expect(r.bar).toBe('up');
    expect(r.n).toBe(7);
  });

  it('is positive on a rising market and negative on a falling one', () => {
    const up = mk(Array.from({ length: 40 }, (_, i) => 100 + i));
    const down = mk(Array.from({ length: 40 }, (_, i) => 140 - i));
    expect(computeAo(up)!.aoPct).toBeGreaterThan(0);
    expect(computeAo(down)!.aoPct).toBeLessThan(0);
  });

  it('reads 0 on a flat market and is scale-invariant', () => {
    expect(computeAo(mk(new Array(40).fill(100)))!.aoPct).toBe(0);
    const up = mk(Array.from({ length: 40 }, (_, i) => 100 + i));
    const big = mk(Array.from({ length: 40 }, (_, i) => (100 + i) * 1000));
    expect(computeAo(big)!.aoPct).toBeCloseTo(computeAo(up)!.aoPct, 9);
  });

  it('returns null with fewer than slow + 1 bars or bad params', () => {
    expect(computeAo(mk([10, 11, 13, 12, 14]), 3, 5)).toBeNull(); // need ≥ 6
    expect(computeAo([], 5, 34)).toBeNull();
    expect(computeAo(mk(Array.from({ length: 40 }, (_, i) => 100 + i)), 5, 5)).toBeNull(); // fast ≥ slow
  });
});

describe('aoBoard / sortAo', () => {
  const up = mk(Array.from({ length: 40 }, (_, i) => 100 + i)); // +AO
  const down = mk(Array.from({ length: 40 }, (_, i) => 140 - i)); // −AO
  const flat = mk(new Array(40).fill(100)); // 0
  const series = [
    { symbol: 'UP', bars: up },
    { symbol: 'DN', bars: down },
    { symbol: 'FL', bars: flat },
  ];

  it('sorts by AO% descending by default', () => {
    const rows = aoBoard(series, 'ao');
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'FL', 'DN']);
  });

  it('sorts by symbol', () => {
    const rows = aoBoard(series, 'symbol');
    expect(rows.map((r) => r.symbol)).toEqual(['DN', 'FL', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = aoBoard(
      [
        { symbol: 'OK', bars: up },
        { symbol: 'THIN', bars: up.slice(0, 20) },
      ],
      'ao',
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });

  it('sortAo orders a plain row set by AO% descending', () => {
    const rows = [
      { symbol: 'A', aoPct: -2 },
      { symbol: 'B', aoPct: 6 },
      { symbol: 'C', aoPct: 1 },
    ] as AoRow[];
    expect(sortAo(rows, 'ao').map((r) => r.symbol)).toEqual(['B', 'C', 'A']);
  });
});
