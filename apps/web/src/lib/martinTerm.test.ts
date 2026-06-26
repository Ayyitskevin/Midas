import { describe, it, expect } from 'vitest';
import { martinForWindow, martinTermBoard, sortMartinTerm } from './martinTerm';
import { computeUlcer } from './ulcer';

describe('martinForWindow', () => {
  it('matches computeUlcer.martin over the trailing window (anchored)', () => {
    // [100,50,100]: ulcer = √(mean[0,.25,0]) = √(0.25/3) ≈ 0.288675; ann return 0.25
    //   → martin ≈ 0.866025.
    const closes = [100, 50, 100];
    expect(martinForWindow(closes, 999, 1)).toBeCloseTo(0.866025, 5); // window > len → whole series
    expect(martinForWindow(closes, 999, 1)).toBeCloseTo(computeUlcer(closes, 1)!.martin!, 12);
  });

  it('is null when the trailing window never drew down (∞ Martin)', () => {
    // last 3 closes monotonically rising → no drawdown → Ulcer 0 → martin null
    expect(martinForWindow([100, 50, 100, 110, 121], 3, 1)).toBeNull();
  });

  it('returns null with fewer than three closes available', () => {
    expect(martinForWindow([100, 110], 30, 1)).toBeNull();
  });
});

describe('martinTermBoard / sortMartinTerm', () => {
  it('computes a martin per window and exposes the horizon curve', () => {
    const closes = [100, 50, 100, 110, 121];
    const [row] = martinTermBoard([{ symbol: 'X', closes }], [3, 5], 1);
    expect(row.martins[0]).toBeNull(); // trailing 3 = [100,110,121], no drawdown → ∞
    expect(row.martins[1]).toBeCloseTo(0.782624, 4); // full series, with the −50% dip
    expect(row.n).toBe(5);
  });

  const series = [
    { symbol: 'A', closes: [100, 50, 100, 110, 121] }, // full-window martin ≈ 0.78
    { symbol: 'B', closes: [100, 80, 100, 120, 140] }, // full-window martin ≈ 1.16
    { symbol: 'SHORT', closes: [100, 110] }, // < 3 closes → filtered out
  ];

  it('filters short series and ranks by the chosen window (default longest)', () => {
    const board = martinTermBoard(series, [3, 5], 1);
    expect(board.map((r) => r.symbol)).toEqual(['B', 'A']); // martins[1]: B 1.16 > A 0.78
    expect(board.find((r) => r.symbol === 'B')!.martins[1]).toBeCloseTo(1.1646, 4);
  });

  it('sorts by symbol and by a specific window index', () => {
    const board = martinTermBoard(series, [3, 5], 1);
    expect(sortMartinTerm(board, 'symbol').map((r) => r.symbol)).toEqual(['A', 'B']);
    expect(sortMartinTerm(board, 1).map((r) => r.symbol)).toEqual(['B', 'A']);
  });
});
