import { describe, it, expect } from 'vitest';
import { computeQstick, qstickBoard, sortQstick, type QstickBar, type QstickRow } from './qstick';

const bar = (open: number, close: number): QstickBar => ({ open, close });

describe('computeQstick', () => {
  it('is positive when closes lead opens (buying bias)', () => {
    // bodies +2, +2 → Qstick 2; close 11 → 2/11·100
    const r = computeQstick([bar(8, 10), bar(9, 11)], 2)!;
    expect(r.qstick).toBeCloseTo(2, 6);
    expect(r.qstickPct).toBeCloseTo((2 / 11) * 100, 6);
    expect(r.side).toBe('up');
    expect(r.n).toBe(2);
  });

  it('is negative when closes trail opens (selling bias)', () => {
    // bodies −2, −2 → Qstick −2; close 9 → −2/9·100
    const r = computeQstick([bar(10, 8), bar(11, 9)], 2)!;
    expect(r.qstick).toBeCloseTo(-2, 6);
    expect(r.qstickPct).toBeCloseTo((-2 / 9) * 100, 6);
    expect(r.side).toBe('down');
  });

  it('nets to zero with mixed bodies', () => {
    // bodies +2, −2 → Qstick 0
    const r = computeQstick([bar(10, 12), bar(12, 10)], 2)!;
    expect(r.qstick).toBe(0);
    expect(r.qstickPct).toBe(0);
    expect(r.side).toBe('up'); // 0 → up (≥ 0)
  });

  it('returns null with too little history', () => {
    expect(computeQstick([bar(8, 10)], 2)).toBeNull();
    expect(computeQstick([], 2)).toBeNull();
  });
});

describe('qstickBoard', () => {
  const series = [
    { symbol: 'BULL', bars: [bar(8, 10), bar(9, 11)] }, // +18.2%
    { symbol: 'BEAR', bars: [bar(10, 8), bar(11, 9)] }, // −22.2%
  ];

  it('defaults to sorting by Qstick% descending', () => {
    const rows = qstickBoard(series, 'qstick', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['BULL', 'BEAR']);
    expect(rows[0].side).toBe('up');
    expect(rows[1].side).toBe('down');
  });

  it('sorts by symbol', () => {
    const rows = qstickBoard(series, 'symbol', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['BEAR', 'BULL']);
  });

  it('skips symbols with too little history', () => {
    const rows = qstickBoard(
      [
        { symbol: 'OK', bars: [bar(8, 10), bar(9, 11)] },
        { symbol: 'THIN', bars: [bar(8, 10)] },
      ],
      'qstick',
      2,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortQstick', () => {
  it('orders by Qstick% descending', () => {
    const rows = [
      { symbol: 'A', qstickPct: 1 },
      { symbol: 'B', qstickPct: 5 },
      { symbol: 'C', qstickPct: -3 },
    ] as QstickRow[];
    expect(sortQstick(rows, 'qstick').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
