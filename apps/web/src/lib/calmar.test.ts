import { describe, it, expect } from 'vitest';
import { computeCalmar, calmarBoard } from './calmar';

describe('computeCalmar', () => {
  it('divides annualized return by the worst drawdown', () => {
    // returns +10% / −20% / +25% → mean 5%; drawdown 88/110 = −20%.
    const r = computeCalmar([100, 110, 88, 110], 100)!;
    expect(r.annReturn).toBeCloseTo(5, 10); // 0.05 × 100
    expect(r.maxDD).toBeCloseTo(0.2, 10);
    expect(r.calmar).toBeCloseTo(25, 10); // 5 / 0.2
    expect(r.n).toBe(3);
  });

  it('leaves Calmar null when the series never draws down', () => {
    const r = computeCalmar([100, 110, 120], 100)!;
    expect(r.maxDD).toBe(0);
    expect(r.calmar).toBeNull();
    expect(r.annReturn).toBeGreaterThan(0);
  });

  it('returns null without enough history', () => {
    expect(computeCalmar([100, 110], 100)).toBeNull();
    expect(computeCalmar([], 100)).toBeNull();
  });
});

describe('calmarBoard', () => {
  it('sorts by Calmar with no-drawdown names last', () => {
    const board = calmarBoard(
      [
        { symbol: 'A', closes: [100, 110, 88, 110] }, // calmar 25
        { symbol: 'B', closes: [100, 110, 120] }, // no drawdown → null
        { symbol: 'C', closes: [100, 90, 99] }, // mean 0 → calmar 0
        { symbol: 'D', closes: [100, 110] }, // too short
      ],
      100,
      'calmar',
    );
    expect(board.map((r) => r.symbol)).toEqual(['A', 'C', 'B']);
    expect(board[0].calmar).toBeCloseTo(25, 10);
    expect(board[1].calmar).toBeCloseTo(0, 10);
    expect(board[2].calmar).toBeNull();
  });

  it('sorts alphabetically on request', () => {
    const board = calmarBoard(
      [
        { symbol: 'SOL', closes: [100, 110, 88, 110] },
        { symbol: 'BTC', closes: [100, 90, 99] },
      ],
      100,
      'symbol',
    );
    expect(board.map((r) => r.symbol)).toEqual(['BTC', 'SOL']);
  });
});
