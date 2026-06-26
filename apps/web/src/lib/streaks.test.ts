import { describe, it, expect } from 'vitest';
import { computeStreaks, streakBoard, sortStreaks } from './streaks';

describe('computeStreaks', () => {
  it('counts the longest up/down runs, up share, and the signed current run', () => {
    // returns [+,+,+,−,−,+,−]: up-run 3 then 1, down-run 2 then 1, last day down.
    const closes = [100, 110, 121, 133.1, 119.79, 107.811, 118.5921, 106.73289];
    const r = computeStreaks(closes)!;
    expect(r.longestUp).toBe(3);
    expect(r.longestDown).toBe(2);
    expect(r.upPct).toBeCloseTo(4 / 7, 12);
    expect(r.current).toBe(-1); // ends on a single down day
    expect(r.n).toBe(7);
  });

  it('reports a positive current run when the latest days are up', () => {
    const r = computeStreaks([100, 90, 99, 108.9])!; // returns [−,+,+]
    expect(r.current).toBe(2);
    expect(r.longestUp).toBe(2);
    expect(r.longestDown).toBe(1);
    expect(r.upPct).toBeCloseTo(2 / 3, 12);
  });

  it('treats a flat day as neither up nor down and breaks the run', () => {
    const r = computeStreaks([100, 110, 110, 121])!; // returns [+, 0, +]
    expect(r.longestUp).toBe(1); // the flat day breaks the run
    expect(r.longestDown).toBe(0);
    expect(r.current).toBe(1); // last day is up, preceded by a flat
    expect(r.upPct).toBeCloseTo(2 / 3, 12); // 2 up of 3 returns (flat is not up)
  });

  it('returns null with fewer than two closes', () => {
    expect(computeStreaks([100])).toBeNull();
    expect(computeStreaks([])).toBeNull();
  });
});

describe('streakBoard / sortStreaks', () => {
  const series = [
    { symbol: 'HOT', closes: [100, 90, 99, 108.9] }, // current +2
    { symbol: 'COLD', closes: [100, 110, 121, 133.1, 119.79, 107.811, 118.5921, 106.73289] }, // current −1
    { symbol: 'FLATEND', closes: [100, 110, 110] }, // current 0 (last day flat)
    { symbol: 'SHORT', closes: [100] }, // < 2 closes → filtered out
  ];

  it('filters short series and ranks by current streak desc (up-streaks first)', () => {
    const board = streakBoard(series);
    expect(board.map((r) => r.symbol)).toEqual(['HOT', 'FLATEND', 'COLD']); // +2, 0, −1
  });

  it('sorts by longestUp and by symbol', () => {
    const board = streakBoard(series);
    expect(sortStreaks(board, 'longestUp')[0].symbol).toBe('COLD'); // longestUp 3
    expect(sortStreaks(board, 'symbol').map((r) => r.symbol)).toEqual(['COLD', 'FLATEND', 'HOT']);
  });
});
