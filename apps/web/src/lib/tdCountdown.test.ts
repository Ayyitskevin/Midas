import { describe, it, expect } from 'vitest';
import {
  computeTdCountdown,
  tdCountdownBoard,
  sortTdCountdown,
  type TdBar,
  type TdCountdownRow,
} from './tdCountdown';

const mk = (rows: [number, number, number][]): TdBar[] =>
  rows.map(([high, low, close]) => ({ high, low, close }));
// Monotonic decline / rise (high = close + 0.5, low = close − 0.5).
const decline = (n: number): TdBar[] => mk(Array.from({ length: n }, (_, i) => [100 - i + 0.5, 100 - i - 0.5, 100 - i]));
const rise = (n: number): TdBar[] => mk(Array.from({ length: n }, (_, i) => [100 + i + 0.5, 100 + i - 0.5, 100 + i]));

describe('computeTdCountdown', () => {
  it('completes a TD Buy Countdown at 13 on a sustained decline', () => {
    const r = computeTdCountdown(decline(30))!;
    expect(r.direction).toBe('buy');
    expect(r.count).toBe(13);
    expect(r.completed).toBe(true);
    expect(r.deferred).toBe(false);
  });

  it('completes a TD Sell Countdown at 13 on a sustained rise', () => {
    const r = computeTdCountdown(rise(30))!;
    expect(r.direction).toBe('sell');
    expect(r.count).toBe(13);
    expect(r.completed).toBe(true);
  });

  it('reports a partial in-progress countdown', () => {
    const r = computeTdCountdown(decline(16))!;
    expect(r.direction).toBe('buy');
    expect(r.count).toBe(4);
    expect(r.completed).toBe(false);
  });

  it('cancels and flips when the opposite setup completes', () => {
    // 16 down bars (arms a buy countdown), then 14 up bars → a sell setup completes.
    const cancel = mk([
      ...Array.from({ length: 16 }, (_, i) => [100 - i + 0.5, 100 - i - 0.5, 100 - i] as [number, number, number]),
      ...Array.from({ length: 14 }, (_, i) => [85 + i + 0.5, 85 + i - 0.5, 85 + i] as [number, number, number]),
    ]);
    const r = computeTdCountdown(cancel)!;
    expect(r.direction).toBe('sell');
    expect(r.completed).toBe(false);
  });

  it('defers the 13th count until the bar-8 qualifier is met', () => {
    // Decline to count 12, then a qualifying bar whose low sits above countdown bar 8's close.
    const defer = decline(24);
    defer.push({ high: 86, low: 85, close: 70 }); // close ≤ low[22] (qualifies) but low 85 > cd8close 81
    const r = computeTdCountdown(defer)!;
    expect(r.count).toBe(12);
    expect(r.deferred).toBe(true);
    expect(r.completed).toBe(false);
  });

  it('returns null with fewer than 5 bars', () => {
    expect(computeTdCountdown(mk([[1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4]]))).toBeNull();
  });
});

describe('tdCountdownBoard / sortTdCountdown', () => {
  const series = [
    { symbol: 'P4', bars: decline(16) }, // buy 4
    { symbol: 'S13', bars: rise(30) }, // sell 13
    { symbol: 'B13', bars: decline(30) }, // buy 13
  ];

  it('sorts by count descending (completed countdowns first)', () => {
    const rows = tdCountdownBoard(series, 'count');
    expect(rows[rows.length - 1].symbol).toBe('P4');
    expect(rows.slice(0, 2).every((r) => r.count === 13)).toBe(true);
  });

  it('sorts by symbol', () => {
    const rows = tdCountdownBoard(series, 'symbol');
    expect(rows.map((r) => r.symbol)).toEqual(['B13', 'P4', 'S13']);
  });

  it('skips symbols with too little history', () => {
    const rows = tdCountdownBoard(
      [
        { symbol: 'OK', bars: decline(30) },
        { symbol: 'THIN', bars: mk([[1, 1, 1], [2, 2, 2], [3, 3, 3]]) },
      ],
      'count',
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });

  it('sortTdCountdown puts completed ahead among equal counts', () => {
    const rows = [
      { symbol: 'A', count: 13, completed: false },
      { symbol: 'B', count: 13, completed: true },
      { symbol: 'C', count: 7, completed: false },
    ] as TdCountdownRow[];
    expect(sortTdCountdown(rows, 'count').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
