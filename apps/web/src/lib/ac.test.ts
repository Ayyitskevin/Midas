import { describe, it, expect } from 'vitest';
import { acRawSeries, computeAc, acBoard, sortAc, type AcBar, type AcRow } from './ac';

const mk = (meds: number[]): AcBar[] => meds.map((m) => ({ high: m + 1, low: m - 1 }));

describe('acRawSeries', () => {
  it('builds AC = AO − SMA(AO, signal) aligned to input, NaN until it exists', () => {
    // median [10,10,16,16,22], fast 2 / slow 3: AO = [_,_,1,2,1]; SMA(AO,2) over
    // the valid tail → AC[3] = 2 − 1.5 = 0.5, AC[4] = 1 − 1.5 = −0.5; rest NaN.
    const ac = acRawSeries([10, 10, 16, 16, 22], 2, 3, 2);
    expect(ac.slice(0, 3).every(Number.isNaN)).toBe(true);
    expect(ac[3]).toBeCloseTo(0.5, 10);
    expect(ac[4]).toBeCloseTo(-0.5, 10);
  });
});

describe('computeAc', () => {
  it('matches the hand-computed fixture (fast 2 / slow 3 / signal 2)', () => {
    const r = computeAc(mk([10, 10, 16, 16, 22]), 2, 3, 2)!;
    expect(r.ac).toBeCloseTo(-0.5, 10);
    expect(r.acPct).toBeCloseTo(-2.272727272727273, 10);
    expect(r.bar).toBe('down'); // AC fell from 0.5 to −0.5
    expect(r.n).toBe(5);
  });

  it('is positive when momentum accelerates and negative when it decelerates', () => {
    const up = mk(Array.from({ length: 40 }, (_, i) => 100 + i * i)); // convex ↑ (accelerating)
    const down = mk(Array.from({ length: 40 }, (_, i) => 2000 - i * i)); // concave ↓ (accelerating down)
    expect(computeAc(up)!.acPct).toBeGreaterThan(0);
    expect(computeAc(down)!.acPct).toBeLessThan(0);
  });

  it('reads ~0 on a steady (constant-slope) trend and exactly 0 on a flat market', () => {
    // A linear ramp has a constant AO, so its acceleration is zero.
    expect(computeAc(mk(Array.from({ length: 40 }, (_, i) => 100 + i)))!.acPct).toBeCloseTo(0, 9);
    expect(computeAc(mk(new Array(40).fill(100)))!.acPct).toBe(0);
  });

  it('is scale-invariant (acPct unchanged when prices are scaled)', () => {
    const up = mk(Array.from({ length: 40 }, (_, i) => 100 + i * i));
    const big = mk(Array.from({ length: 40 }, (_, i) => (100 + i * i) * 1000));
    expect(computeAc(big)!.acPct).toBeCloseTo(computeAc(up)!.acPct, 9);
  });

  it('returns null with fewer than slow + signal bars or bad params', () => {
    expect(computeAc(mk([10, 10, 16, 16]), 2, 3, 2)).toBeNull(); // need ≥ 5
    expect(computeAc([], 5, 34, 5)).toBeNull();
    expect(computeAc(mk(Array.from({ length: 40 }, (_, i) => 100 + i)), 5, 5)).toBeNull(); // fast ≥ slow
  });
});

describe('acBoard / sortAc', () => {
  const up = mk(Array.from({ length: 40 }, (_, i) => 100 + i * i)); // +AC
  const down = mk(Array.from({ length: 40 }, (_, i) => 2000 - i * i)); // −AC
  const flat = mk(new Array(40).fill(100)); // 0
  const series = [
    { symbol: 'UP', bars: up },
    { symbol: 'DN', bars: down },
    { symbol: 'FL', bars: flat },
  ];

  it('sorts by AC% descending by default', () => {
    const rows = acBoard(series, 'ac');
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'FL', 'DN']);
  });

  it('sorts by symbol', () => {
    const rows = acBoard(series, 'symbol');
    expect(rows.map((r) => r.symbol)).toEqual(['DN', 'FL', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = acBoard(
      [
        { symbol: 'OK', bars: up },
        { symbol: 'THIN', bars: up.slice(0, 30) },
      ],
      'ac',
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });

  it('sortAc orders a plain row set by AC% descending', () => {
    const rows = [
      { symbol: 'A', acPct: -2 },
      { symbol: 'B', acPct: 6 },
      { symbol: 'C', acPct: 1 },
    ] as AcRow[];
    expect(sortAc(rows, 'ac').map((r) => r.symbol)).toEqual(['B', 'C', 'A']);
  });
});
