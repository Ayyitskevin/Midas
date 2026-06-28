import { describe, it, expect } from 'vitest';
import {
  smma,
  computeAlligator,
  alligatorBoard,
  sortAlligator,
  type AlligatorBar,
  type AlligatorRow,
} from './alligator';

// median m → bar with high = m + 1, low = m − 1.
const mk = (meds: number[]): AlligatorBar[] => meds.map((m) => ({ high: m + 1, low: m - 1 }));

describe('smma', () => {
  it('seeds with an SMA then Wilder-smooths', () => {
    // [2,4,6,8,10], period 3: seed (2+4+6)/3=4; (4·2+8)/3=5.3333; (5.3333·2+10)/3=6.8889.
    const s = smma([2, 4, 6, 8, 10], 3);
    expect(Number.isNaN(s[1])).toBe(true);
    expect(s[2]).toBeCloseTo(4, 10);
    expect(s[3]).toBeCloseTo(5.333333333333333, 10);
    expect(s[4]).toBeCloseTo(6.888888888888889, 10);
  });
});

describe('computeAlligator', () => {
  it('matches the hand-computed displaced lines (small params)', () => {
    const meds = [10, 12, 11, 13, 15, 14, 16, 18, 17, 19];
    const r = computeAlligator(mk(meds), 4, 2, 3, 1, 2, 1)!;
    expect(r.jaw).toBeCloseTo(14.689453125, 9);
    expect(r.teeth).toBeCloseTo(15.943758573388203, 9);
    expect(r.lips).toBeCloseTo(16.71875, 9);
    expect(r.state).toBe('up');
    expect(r.spreadPct).toBeCloseTo(10.680509868421053, 9);
    expect(r.n).toBe(10);
  });

  it('feeds up on a rising market and down on a falling one', () => {
    const up = mk(Array.from({ length: 30 }, (_, i) => 100 + 2 * i));
    const down = mk(Array.from({ length: 30 }, (_, i) => 200 - 2 * i));
    const ru = computeAlligator(up)!;
    const rd = computeAlligator(down)!;
    expect(ru.state).toBe('up');
    expect(ru.spreadPct).toBeGreaterThan(0);
    expect(rd.state).toBe('down');
    expect(rd.spreadPct).toBeLessThan(0);
  });

  it('sleeps (sleeping, zero spread) on a flat market', () => {
    const flat = mk(new Array(30).fill(100));
    const r = computeAlligator(flat)!;
    expect(r.state).toBe('sleeping');
    expect(r.spreadPct).toBe(0);
  });

  it('returns null with fewer than jawPeriod + jawShift bars or bad params', () => {
    const up = mk(Array.from({ length: 30 }, (_, i) => 100 + 2 * i));
    expect(computeAlligator(up.slice(0, 20))).toBeNull(); // default needs ≥ 21
    expect(computeAlligator([])).toBeNull();
    expect(computeAlligator(up, 0)).toBeNull();
  });
});

describe('alligatorBoard / sortAlligator', () => {
  const up = mk(Array.from({ length: 30 }, (_, i) => 100 + 2 * i)); // wide + fan
  const down = mk(Array.from({ length: 30 }, (_, i) => 200 - 2 * i)); // wide − fan
  const flat = mk(new Array(30).fill(100)); // ~0 spread
  const series = [
    { symbol: 'UP', bars: up },
    { symbol: 'DN', bars: down },
    { symbol: 'FL', bars: flat },
  ];

  it('sorts by spread% descending by default (strongest up-fan first)', () => {
    const rows = alligatorBoard(series, 'spread');
    expect(rows[0].symbol).toBe('UP');
    expect(rows[rows.length - 1].symbol).toBe('DN');
  });

  it('sorts by symbol', () => {
    const rows = alligatorBoard(series, 'symbol');
    expect(rows.map((r) => r.symbol)).toEqual(['DN', 'FL', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = alligatorBoard(
      [
        { symbol: 'OK', bars: up },
        { symbol: 'THIN', bars: up.slice(0, 15) },
      ],
      'spread',
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });

  it('sortAlligator orders a plain row set by spread% descending', () => {
    const rows = [
      { symbol: 'A', spreadPct: -3 },
      { symbol: 'B', spreadPct: 9 },
      { symbol: 'C', spreadPct: 2 },
    ] as AlligatorRow[];
    expect(sortAlligator(rows, 'spread').map((r) => r.symbol)).toEqual(['B', 'C', 'A']);
  });
});
