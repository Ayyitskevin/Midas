import { describe, it, expect } from 'vitest';
import { computeVortex, vortexBoard, vortexSeries, sortVtx, type VtxBar, type VtxRow } from './vortex';

const bar = (high: number, low: number, close: number): VtxBar => ({ high, low, close });

// Downtrend → sharp up (bull cross at period 2). Hand-computed:
//   +VM = [1, 2, 10], −VM = [4, 5, 1], TR = [3, 4, 9]
//   window1: +VI 3/7, −VI 9/7   (−VI leads)
//   window2: +VI 12/13, −VI 6/13 (+VI leads → bull cross)
const bullCross: VtxBar[] = [bar(20, 18, 19), bar(19, 16, 17), bar(18, 14, 15), bar(24, 17, 23)];

// Uptrend → sharp down (bear cross at period 2):
//   window1: +VI 1.5, −VI 1/3   window2: +VI 8/14, −VI 13/14 (bear cross)
const bearCross: VtxBar[] = [bar(14, 12, 13), bar(16, 13, 15), bar(18, 15, 17), bar(12, 6, 7)];

describe('vortexSeries', () => {
  it('computes +VI / −VI from VM over TR', () => {
    const s = vortexSeries(bullCross, 2)!;
    expect(s.plus.length).toBe(2);
    expect(s.plus[0]).toBeCloseTo(3 / 7, 6);
    expect(s.minus[0]).toBeCloseTo(9 / 7, 6);
    expect(s.plus[1]).toBeCloseTo(12 / 13, 6);
    expect(s.minus[1]).toBeCloseTo(6 / 13, 6);
  });

  it('maps a flat (zero-TR) window to 1 / 1', () => {
    const flat = [bar(100, 100, 100), bar(100, 100, 100), bar(100, 100, 100)];
    const s = vortexSeries(flat, 2)!;
    expect(s.plus.every((v) => v === 1)).toBe(true);
    expect(s.minus.every((v) => v === 1)).toBe(true);
  });

  it('returns null with too little history', () => {
    expect(vortexSeries([bar(10, 8, 9), bar(11, 9, 10)], 2)).toBeNull(); // n < period + 1
  });
});

describe('computeVortex', () => {
  it('flags a bullish +VI-over-−VI cross', () => {
    const r = computeVortex(bullCross, 2)!;
    expect(r.plus).toBeCloseTo(12 / 13, 6);
    expect(r.minus).toBeCloseTo(6 / 13, 6);
    expect(r.diff).toBeCloseTo(6 / 13, 6);
    expect(r.trend).toBe('up');
    expect(r.cross).toBe('bull');
    expect(r.n).toBe(4);
  });

  it('flags a bearish +VI-under-−VI cross', () => {
    const r = computeVortex(bearCross, 2)!;
    expect(r.trend).toBe('down');
    expect(r.cross).toBe('bear');
    expect(r.plus).toBeCloseTo(8 / 14, 6);
    expect(r.minus).toBeCloseTo(13 / 14, 6);
  });

  it('reports trend without a cross when only one reading exists', () => {
    // n = period + 1 → a single VI reading, so no crossover yet.
    const r = computeVortex([bar(10, 8, 9), bar(12, 9, 11), bar(14, 11, 13)], 2)!;
    expect(r.cross).toBe('none');
    expect(r.trend).toBe('up');
    expect(r.plus).toBeCloseTo(9 / 6, 6);
    expect(r.minus).toBeCloseTo(2 / 6, 6);
  });

  it('returns null with too little history', () => {
    expect(computeVortex([bar(10, 8, 9), bar(11, 9, 10)], 14)).toBeNull();
    expect(computeVortex([], 14)).toBeNull();
  });
});

describe('vortexBoard', () => {
  const series = [
    { symbol: 'UP', bars: bullCross },
    { symbol: 'DOWN', bars: bearCross },
  ];

  it('defaults to sorting by +VI−−VI diff descending', () => {
    const rows = vortexBoard(series, 'diff', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'DOWN']);
    expect(rows[0].trend).toBe('up');
    expect(rows[1].trend).toBe('down');
  });

  it('sorts by symbol', () => {
    const rows = vortexBoard(series, 'symbol', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = vortexBoard(
      [
        { symbol: 'OK', bars: bullCross },
        { symbol: 'THIN', bars: [bar(10, 8, 9), bar(11, 9, 10)] },
      ],
      'diff',
      2,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortVtx', () => {
  it('orders by +VI descending', () => {
    const rows = [
      { symbol: 'A', plus: 1.1 },
      { symbol: 'B', plus: 1.8 },
      { symbol: 'C', plus: 0.6 },
    ] as VtxRow[];
    expect(sortVtx(rows, 'plus').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
