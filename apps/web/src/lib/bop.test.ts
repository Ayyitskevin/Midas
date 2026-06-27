import { describe, it, expect } from 'vitest';
import { computeBop, bopBoard, barBop, sortBop, type BopBar, type BopRow } from './bop';

const bar = (open: number, high: number, low: number, close: number): BopBar => ({ open, high, low, close });

describe('barBop', () => {
  it('is +1 when the close finishes at the high from the low (full buyers)', () => {
    expect(barBop(bar(8, 10, 8, 10))).toBe(1); // (10−8)/(10−8)
  });
  it('is −1 when the close finishes at the low from the high (full sellers)', () => {
    expect(barBop(bar(10, 10, 8, 8))).toBe(-1); // (8−10)/(10−8)
  });
  it('is 0 on a zero-range bar', () => {
    expect(barBop(bar(10, 10, 10, 10))).toBe(0);
  });
});

describe('computeBop', () => {
  it('averages the per-bar BOP over the window', () => {
    // bops: 1 and 0.5 → SMA = 0.75; raw = latest = 0.5
    const r = computeBop([bar(8, 10, 8, 10), bar(9, 11, 9, 10)], 2)!;
    expect(r.bop).toBeCloseTo(0.75, 6);
    expect(r.raw).toBeCloseTo(0.5, 6);
    expect(r.side).toBe('buyers');
    expect(r.n).toBe(2);
  });

  it('reads sellers in control when smoothed BOP is negative', () => {
    const r = computeBop([bar(10, 10, 8, 8), bar(10, 11, 9, 9)], 2)!;
    // bops: −1 and (9−10)/(11−9)=−0.5 → SMA = −0.75
    expect(r.bop).toBeCloseTo(-0.75, 6);
    expect(r.side).toBe('sellers');
  });

  it('returns null with too little history', () => {
    expect(computeBop([bar(8, 10, 8, 10)], 2)).toBeNull();
    expect(computeBop([], 2)).toBeNull();
  });
});

describe('bopBoard', () => {
  const series = [
    { symbol: 'BUY', bars: [bar(8, 10, 8, 10), bar(9, 11, 9, 10)] }, // +0.75
    { symbol: 'SELL', bars: [bar(10, 10, 8, 8), bar(10, 11, 9, 9)] }, // −0.75
  ];

  it('defaults to sorting by smoothed BOP descending', () => {
    const rows = bopBoard(series, 'bop', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['BUY', 'SELL']);
    expect(rows[0].side).toBe('buyers');
    expect(rows[1].side).toBe('sellers');
  });

  it('sorts by symbol', () => {
    const rows = bopBoard(series, 'symbol', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['BUY', 'SELL']);
  });

  it('skips symbols with too little history', () => {
    const rows = bopBoard(
      [
        { symbol: 'OK', bars: [bar(8, 10, 8, 10), bar(9, 11, 9, 10)] },
        { symbol: 'THIN', bars: [bar(8, 10, 8, 10)] },
      ],
      'bop',
      2,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortBop', () => {
  it('orders by smoothed BOP descending', () => {
    const rows = [
      { symbol: 'A', bop: 0.2 },
      { symbol: 'B', bop: 0.8 },
      { symbol: 'C', bop: -0.4 },
    ] as BopRow[];
    expect(sortBop(rows, 'bop').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
