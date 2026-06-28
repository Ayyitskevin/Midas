import { describe, it, expect } from 'vitest';
import { computeTdSetup, tdSetupBoard, sortTdSetup, type TdBar, type TdSetupRow } from './tdSetup';

// Build bars from closes; default low = close − 1, high = close + 1.
const mk = (closes: number[], lows?: number[], highs?: number[]): TdBar[] =>
  closes.map((c, i) => ({ close: c, low: lows ? lows[i] : c - 1, high: highs ? highs[i] : c + 1 }));

describe('computeTdSetup', () => {
  it('counts a completed, perfected TD Buy Setup (9 down-closes, fresh low)', () => {
    // 4 flat bars then 9 closes each below the close 4 bars earlier; lows decline.
    const r = computeTdSetup(mk([100, 100, 100, 100, 99, 98, 97, 96, 95, 94, 93, 92, 91]))!;
    expect(r.direction).toBe('buy');
    expect(r.count).toBe(9);
    expect(r.completed).toBe(true);
    expect(r.perfected).toBe(true);
    expect(r.n).toBe(13);
  });

  it('completes but is NOT perfected when the tail low fails the geometry', () => {
    const closes = [100, 100, 100, 100, 99, 98, 97, 96, 95, 94, 93, 92, 91];
    const lows = closes.map((c) => c - 1);
    lows[11] = 100; // bar 8 low
    lows[12] = 100; // bar 9 low — both above bars 6 & 7 lows
    const r = computeTdSetup(mk(closes, lows))!;
    expect(r.completed).toBe(true);
    expect(r.perfected).toBe(false);
  });

  it('counts a completed, perfected TD Sell Setup (9 up-closes, fresh high)', () => {
    const r = computeTdSetup(mk([100, 100, 100, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109]))!;
    expect(r.direction).toBe('sell');
    expect(r.count).toBe(9);
    expect(r.completed).toBe(true);
    expect(r.perfected).toBe(true);
  });

  it('reports a mid-setup count and resets/flips on a break', () => {
    expect(computeTdSetup(mk([100, 100, 100, 100, 99, 98, 97, 96, 95]))!.count).toBe(5);
    // a down run broken by an up bar flips to a fresh sell count of 1
    const flip = computeTdSetup(mk([100, 100, 100, 100, 99, 98, 97, 96, 101]))!;
    expect(flip.direction).toBe('sell');
    expect(flip.count).toBe(1);
  });

  it('reads none when the latest close equals the close 4 bars ago, and null when too short', () => {
    const none = computeTdSetup(mk([100, 100, 100, 100, 100]))!;
    expect(none.direction).toBe('none');
    expect(none.count).toBe(0);
    expect(computeTdSetup(mk([1, 2, 3, 4]))).toBeNull();
  });
});

describe('tdSetupBoard / sortTdSetup', () => {
  const buy9 = mk([100, 100, 100, 100, 99, 98, 97, 96, 95, 94, 93, 92, 91]); // buy 9 perfected
  const sell9 = mk([100, 100, 100, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109]); // sell 9 perfected
  const buy5 = mk([100, 100, 100, 100, 99, 98, 97, 96, 95]); // buy 5
  const series = [
    { symbol: 'B5', bars: buy5 },
    { symbol: 'S9', bars: sell9 },
    { symbol: 'B9', bars: buy9 },
  ];

  it('sorts by count descending (completed setups first)', () => {
    const rows = tdSetupBoard(series, 'count');
    expect(rows[rows.length - 1].symbol).toBe('B5'); // the count-5 is last
    expect(rows.slice(0, 2).every((r) => r.count === 9)).toBe(true);
  });

  it('sorts by symbol', () => {
    const rows = tdSetupBoard(series, 'symbol');
    expect(rows.map((r) => r.symbol)).toEqual(['B5', 'B9', 'S9']);
  });

  it('skips symbols with too little history', () => {
    const rows = tdSetupBoard(
      [
        { symbol: 'OK', bars: buy9 },
        { symbol: 'THIN', bars: mk([1, 2, 3, 4]) },
      ],
      'count',
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });

  it('sortTdSetup puts perfected ahead among equal counts', () => {
    const rows = [
      { symbol: 'A', count: 9, perfected: false },
      { symbol: 'B', count: 9, perfected: true },
      { symbol: 'C', count: 4, perfected: false },
    ] as TdSetupRow[];
    expect(sortTdSetup(rows, 'count').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
