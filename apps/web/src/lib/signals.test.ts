import { describe, it, expect } from 'vitest';
import { rsi, smaLast, computeSignals, signalBoard } from './signals';

const rng = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('rsi', () => {
  it('is 100 all-up, 0 all-down, 50 flat/alternating', () => {
    expect(rsi(rng(1, 15), 14)).toBe(100); // 14 up changes
    expect(rsi(rng(1, 15).reverse(), 14)).toBe(0); // 14 down changes
    const alt = Array.from({ length: 15 }, (_, i) => (i % 2 === 0 ? 10 : 11));
    expect(rsi(alt, 14)).toBeCloseTo(50, 10); // 7 up / 7 down
    expect(rsi(new Array(15).fill(10), 14)).toBe(50); // flat
    expect(rsi([1, 2, 3], 14)).toBeNull(); // too short
  });
});

describe('smaLast', () => {
  it('averages the trailing window, or null when short', () => {
    expect(smaLast(rng(1, 60), 20)).toBeCloseTo(50.5, 10); // mean 41..60
    expect(smaLast(rng(1, 60), 50)).toBeCloseTo(35.5, 10); // mean 11..60
    expect(smaLast([1, 2, 3], 5)).toBeNull();
  });
});

describe('computeSignals', () => {
  it('flags an extended uptrend as up / overbought / near-high', () => {
    const s = computeSignals(rng(1, 60))!;
    expect(s.trend).toBe('up');
    expect(s.rsiState).toBe('overbought');
    expect(s.rsi).toBe(100);
    expect(s.rangePct).toBeCloseTo(100, 10);
    expect(s.rangeState).toBe('high');
  });

  it('flags a sustained downtrend as down / oversold / near-low', () => {
    const s = computeSignals(rng(1, 60).reverse())!;
    expect(s.trend).toBe('down');
    expect(s.rsiState).toBe('oversold');
    expect(s.rangeState).toBe('low');
  });

  it('returns nulls for signals it cannot compute on thin history', () => {
    const s = computeSignals(rng(1, 10))!;
    expect(s).not.toBeNull();
    expect(s.trend).toBeNull(); // needs 50 closes
    expect(s.rsi).toBeNull(); // needs 15 closes
  });
});

describe('signalBoard', () => {
  const upFlat = [...rng(1, 50), ...new Array(14).fill(50)]; // up trend, flat RSI → score +1
  const dnFlat = [...rng(1, 50).reverse(), ...new Array(14).fill(1)]; // down trend → score −1

  it('scores aligned signals and sorts most-bullish first', () => {
    expect(computeSignals(upFlat)!.score).toBe(1);
    expect(computeSignals(upFlat)!.trend).toBe('up');
    expect(computeSignals(upFlat)!.rsiState).toBe('neutral');
    expect(computeSignals(dnFlat)!.score).toBe(-1);
    const board = signalBoard(
      [
        { symbol: 'DN', closes: dnFlat },
        { symbol: 'UP', closes: upFlat },
      ],
      'score',
    );
    expect(board.map((r) => r.symbol)).toEqual(['UP', 'DN']);
  });

  it('drops empty series and can sort alphabetically', () => {
    const board = signalBoard(
      [
        { symbol: 'B', closes: upFlat },
        { symbol: 'A', closes: dnFlat },
        { symbol: 'Z', closes: [] },
      ],
      'symbol',
    );
    expect(board.map((r) => r.symbol)).toEqual(['A', 'B']);
  });
});
