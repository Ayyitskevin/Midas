import { describe, it, expect } from 'vitest';
import { computeWilliamsR, williamsBoard, williamsZone, sortWr, type WrBar, type WrRow } from './williamsR';

// With high=100 / low=0 over the window, HH=100 and LL=0, so %R = close − 100.
const bar = (close: number, high = 100, low = 0): WrBar => ({ high, low, close });
const bars = (closes: number[]): WrBar[] => closes.map((c) => bar(c));

describe('williamsZone', () => {
  it('classifies on the −20 / −80 thresholds (inclusive)', () => {
    expect(williamsZone(-10)).toBe('overbought');
    expect(williamsZone(-20)).toBe('overbought');
    expect(williamsZone(-50)).toBe('neutral');
    expect(williamsZone(-80)).toBe('oversold');
    expect(williamsZone(-90)).toBe('oversold');
  });
});

describe('computeWilliamsR', () => {
  it('is 0 at the top and −100 at the bottom of the range', () => {
    expect(computeWilliamsR(bars([90, 90, 100]), 3)).toBeCloseTo(0, 6); // close 100 = HH → top → 0
    expect(computeWilliamsR(bars([50, 50, 0]), 3)).toBeCloseTo(-100, 6); // close 0 = LL → −100
  });

  it('locates the close within a varying window', () => {
    // HH = 15, LL = 8, close = 13 → (15−13)/(15−8)·−100 = −200/7
    const r = computeWilliamsR([{ high: 12, low: 8, close: 10 }, { high: 15, low: 9, close: 11 }, { high: 14, low: 10, close: 13 }], 3)!;
    expect(r).toBeCloseTo(-200 / 7, 6);
    expect(williamsZone(r)).toBe('neutral');
  });

  it('flags overbought / oversold', () => {
    expect(williamsZone(computeWilliamsR(bars([50, 50, 90]), 3)!)).toBe('overbought'); // %R −10
    expect(williamsZone(computeWilliamsR(bars([50, 50, 10]), 3)!)).toBe('oversold'); // %R −90
  });

  it('maps a flat (zero-range) window to the −50 midpoint', () => {
    expect(computeWilliamsR([bar(100, 100, 100), bar(100, 100, 100), bar(100, 100, 100)], 3)).toBe(-50);
  });

  it('returns null with too little history', () => {
    expect(computeWilliamsR(bars([90, 90]), 3)).toBeNull();
    expect(computeWilliamsR([], 3)).toBeNull();
  });
});

describe('williamsBoard', () => {
  const series = [
    { symbol: 'HOT', bars: bars([50, 50, 90]) }, // %R −10 (overbought)
    { symbol: 'COLD', bars: bars([50, 50, 10]) }, // %R −90 (oversold)
  ];

  it('defaults to sorting by %R descending (overbought first)', () => {
    const rows = williamsBoard(series, 'wr', 3);
    expect(rows.map((r) => r.symbol)).toEqual(['HOT', 'COLD']);
    expect(rows[0].zone).toBe('overbought');
    expect(rows[1].zone).toBe('oversold');
  });

  it('sorts by symbol', () => {
    const rows = williamsBoard(series, 'symbol', 3);
    expect(rows.map((r) => r.symbol)).toEqual(['COLD', 'HOT']);
  });

  it('skips symbols with too little history', () => {
    const rows = williamsBoard(
      [
        { symbol: 'OK', bars: bars([50, 50, 90]) },
        { symbol: 'THIN', bars: bars([50, 50]) },
      ],
      'wr',
      3,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortWr', () => {
  it('orders by %R descending', () => {
    const rows = [
      { symbol: 'A', wr: -30 },
      { symbol: 'B', wr: -5 },
      { symbol: 'C', wr: -70 },
    ] as WrRow[];
    expect(sortWr(rows, 'wr').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
