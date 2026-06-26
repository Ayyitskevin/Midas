import { describe, it, expect } from 'vitest';
import { computeTrix, trixBoard, sortTrix, type TrixRow } from './trix';

// Fixtures + expected values derived under the pinned EMA convention
// (first-value seed, full recursion) and adversarially verified — 2/2
// independent recomputations, one with BigInt exact-rational arithmetic.
// Params N=2, signal=2.

const rising = [100, 102, 104, 107, 110, 114, 119, 125];
const turnCross = [100, 104, 108, 112, 116, 120, 124, 121];
const falling = [125, 119, 114, 110, 107, 104, 102, 100];

describe('computeTrix', () => {
  it('reads positive momentum on a rising series, no cross', () => {
    const r = computeTrix(rising, 2, 2)!;
    expect(r.trix).toBeCloseTo(4.093539, 5);
    expect(r.signal).toBeCloseTo(3.778609, 5);
    expect(r.side).toBe('up');
    expect(r.cross).toBe('none'); // TRIX already above signal
    expect(r.hist).toBeCloseTo(4.093539 - 3.778609, 5);
    expect(r.n).toBe(8);
  });

  it('fires a bearish TRIX×signal cross when momentum turns down', () => {
    const r = computeTrix(turnCross, 2, 2)!;
    expect(r.trix).toBeCloseTo(1.603311, 5);
    expect(r.signal).toBeCloseTo(2.205255, 5);
    expect(r.cross).toBe('bear');
    // side and cross are independent axes: a bear cross while TRIX is still > 0.
    expect(r.side).toBe('up');
  });

  it('reads negative momentum on a falling series', () => {
    const r = computeTrix(falling, 2, 2)!;
    expect(r.trix).toBeLessThan(0);
    expect(r.side).toBe('down');
  });

  it('returns null with fewer than 2 closes', () => {
    expect(computeTrix([100], 2, 2)).toBeNull();
    expect(computeTrix([], 2, 2)).toBeNull();
  });
});

describe('trixBoard', () => {
  const series = [
    { symbol: 'UP', closes: rising },
    { symbol: 'DOWN', closes: falling },
  ];

  it('defaults to sorting by TRIX descending', () => {
    const rows = trixBoard(series, 'trix', 2, 2);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'DOWN']);
    expect(rows[0].side).toBe('up');
    expect(rows[1].side).toBe('down');
  });

  it('sorts by symbol', () => {
    const rows = trixBoard(series, 'symbol', 2, 2);
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = trixBoard(
      [
        { symbol: 'OK', closes: rising },
        { symbol: 'THIN', closes: [100] },
      ],
      'trix',
      2,
      2,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortTrix', () => {
  it('orders by histogram descending', () => {
    const rows = [
      { symbol: 'A', hist: 0.3 },
      { symbol: 'B', hist: 0.9 },
      { symbol: 'C', hist: -0.4 },
    ] as TrixRow[];
    expect(sortTrix(rows, 'hist').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
