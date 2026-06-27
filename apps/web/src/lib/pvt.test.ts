import { describe, it, expect } from 'vitest';
import { computePvt, pvtBoard, sortPvt, type PvtBar, type PvtRow } from './pvt';

const bar = (close: number, volume: number): PvtBar => ({ close, volume });

describe('computePvt', () => {
  it('rises on up-moves and flags a new PVT high', () => {
    // inc = (0.1)·100 each → PVT line = 0, 10, 20
    const r = computePvt([bar(100, 100), bar(110, 100), bar(121, 100)], 2)!;
    expect(r.pvt).toBeCloseTo(20, 6);
    expect(r.slopePct).toBeCloseTo(10, 6); // (20−0)/(100+100)·100
    expect(r.trend).toBe('up');
    expect(r.extreme).toBe('high');
    expect(r.n).toBe(3);
  });

  it('falls on down-moves and flags a new PVT low', () => {
    // inc = (−10/121)·100, (−10/110)·100 → PVT ≈ 0, −9.0909, −18.1818
    const r = computePvt([bar(121, 100), bar(110, 100), bar(100, 100)], 2)!;
    expect(r.pvt).toBeCloseTo(-18.181818, 5);
    expect(r.slopePct).toBeCloseTo(-9.090909, 5);
    expect(r.trend).toBe('down');
    expect(r.extreme).toBe('low');
  });

  it('is flat with unchanged prices (no slope, no new extreme)', () => {
    const r = computePvt([bar(100, 100), bar(100, 100), bar(100, 100)], 2)!;
    expect(r.pvt).toBe(0);
    expect(r.slopePct).toBe(0);
    expect(r.extreme).toBe('none');
  });

  it('returns null with too little history', () => {
    expect(computePvt([bar(100, 100), bar(110, 100)], 2)).toBeNull(); // n < period + 1
    expect(computePvt([], 2)).toBeNull();
  });
});

describe('pvtBoard', () => {
  const series = [
    { symbol: 'UP', bars: [bar(100, 100), bar(110, 100), bar(121, 100)] }, // +10%
    { symbol: 'DOWN', bars: [bar(121, 100), bar(110, 100), bar(100, 100)] }, // −9.1%
  ];

  it('defaults to sorting by slope% descending', () => {
    const rows = pvtBoard(series, 'slope', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'DOWN']);
    expect(rows[0].extreme).toBe('high');
    expect(rows[1].extreme).toBe('low');
  });

  it('sorts by symbol', () => {
    const rows = pvtBoard(series, 'symbol', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = pvtBoard(
      [
        { symbol: 'OK', bars: [bar(100, 100), bar(110, 100), bar(121, 100)] },
        { symbol: 'THIN', bars: [bar(100, 100), bar(110, 100)] },
      ],
      'slope',
      2,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortPvt', () => {
  it('orders by slope% descending', () => {
    const rows = [
      { symbol: 'A', slopePct: 4 },
      { symbol: 'B', slopePct: 11 },
      { symbol: 'C', slopePct: -2 },
    ] as PvtRow[];
    expect(sortPvt(rows, 'slope').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
