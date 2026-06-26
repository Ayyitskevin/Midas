import { describe, it, expect } from 'vitest';
import { computeDonchian, donchianBoard, sortDon, type DonBar, type DonRow } from './donchian';

const bar = (high: number, low: number, close: number): DonBar => ({ high, low, close });

// Prior 3 bars set the channel (upper 12 / lower 7); the 4th bar is the current one.
const breakoutUp: DonBar[] = [bar(10, 8, 9), bar(11, 7, 10), bar(12, 9, 11), bar(20, 11, 18)];
const breakoutDown: DonBar[] = [bar(12, 9, 11), bar(11, 8, 10), bar(10, 7, 9), bar(8, 3, 5)];
const inside: DonBar[] = [bar(12, 7, 10), bar(11, 8, 9), bar(13, 6, 10), bar(11, 9, 10)];

describe('computeDonchian', () => {
  it('flags an upside breakout with pos above 100', () => {
    const r = computeDonchian(breakoutUp, 3)!;
    expect(r.upper).toBe(12);
    expect(r.lower).toBe(7);
    expect(r.mid).toBe(9.5);
    expect(r.breakout).toBe('up');
    expect(r.pos).toBeCloseTo(220, 6); // (18 − 7) / 5 · 100
    expect(r.n).toBe(4);
  });

  it('flags a downside breakout with pos below 0', () => {
    const r = computeDonchian(breakoutDown, 3)!;
    expect(r.upper).toBe(12);
    expect(r.lower).toBe(7);
    expect(r.breakout).toBe('down');
    expect(r.pos).toBeCloseTo(-40, 6); // (5 − 7) / 5 · 100
  });

  it('reports an in-channel close with no breakout', () => {
    const r = computeDonchian(inside, 3)!;
    expect(r.upper).toBe(13);
    expect(r.lower).toBe(6);
    expect(r.breakout).toBe('none');
    expect(r.pos).toBeCloseTo((4 / 7) * 100, 6); // (10 − 6) / 7 · 100
    expect(r.width).toBeCloseTo((7 / 9.5) * 100, 6);
  });

  it('handles a flat channel without dividing by zero', () => {
    const flat = [bar(100, 100, 100), bar(100, 100, 100), bar(100, 100, 100), bar(100, 100, 100)];
    const r = computeDonchian(flat, 3)!;
    expect(r.pos).toBe(50);
    expect(r.width).toBe(0);
    expect(r.breakout).toBe('none');
  });

  it('returns null with too little history', () => {
    expect(computeDonchian([bar(10, 8, 9), bar(11, 7, 10), bar(12, 9, 11)], 3)).toBeNull(); // n < period + 1
    expect(computeDonchian([], 3)).toBeNull();
  });
});

describe('donchianBoard', () => {
  const series = [
    { symbol: 'UP', bars: breakoutUp },
    { symbol: 'DOWN', bars: breakoutDown },
  ];

  it('defaults to sorting by channel position descending', () => {
    const rows = donchianBoard(series, 'pos', 3);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'DOWN']);
    expect(rows[0].breakout).toBe('up');
    expect(rows[1].breakout).toBe('down');
  });

  it('sorts by symbol', () => {
    const rows = donchianBoard(series, 'symbol', 3);
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = donchianBoard(
      [
        { symbol: 'OK', bars: breakoutUp },
        { symbol: 'THIN', bars: [bar(10, 8, 9), bar(11, 7, 10)] },
      ],
      'pos',
      3,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortDon', () => {
  it('orders by width descending', () => {
    const rows = [
      { symbol: 'A', width: 4 },
      { symbol: 'B', width: 9 },
      { symbol: 'C', width: 2 },
    ] as DonRow[];
    expect(sortDon(rows, 'width').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
