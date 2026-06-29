import { describe, it, expect } from 'vitest';
import {
  rsi,
  smaLast,
  computeSignals,
  signalBoard,
  matchesCriteria,
  filterSignals,
  isActiveCriteria,
  describeCriteria,
  coerceCriteria,
  sameCriteria,
  ANY_CRITERIA,
  type SignalRow,
} from './signals';

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

describe('scan criteria', () => {
  const mkRow = (over: Partial<SignalRow>): SignalRow => ({
    symbol: 'X',
    last: 100,
    sma20: null,
    sma50: null,
    trend: null,
    rsi: null,
    rsiState: null,
    rangePct: null,
    rangeState: null,
    score: 0,
    ...over,
  });
  const up = mkRow({ symbol: 'UP', trend: 'up', rsiState: 'oversold', rangeState: 'low', score: 2 });
  const dn = mkRow({ symbol: 'DN', trend: 'down', rsiState: 'overbought', rangeState: 'high', score: -2 });
  const flat = mkRow({ symbol: 'FL', trend: 'up', rsiState: 'neutral', rangeState: 'mid', score: 1 });
  const rows = [up, dn, flat];
  const codes = (rs: SignalRow[]) => rs.map((r) => r.symbol);

  it('ANY_CRITERIA matches everything and reads as inactive', () => {
    expect(isActiveCriteria(ANY_CRITERIA)).toBe(false);
    expect(rows.every((r) => matchesCriteria(r, ANY_CRITERIA))).toBe(true);
    expect(describeCriteria(ANY_CRITERIA)).toBe('all symbols');
  });

  it('filters by trend / rsi / range and a minimum score', () => {
    expect(codes(filterSignals(rows, { ...ANY_CRITERIA, trend: 'up' }))).toEqual(['UP', 'FL']);
    expect(codes(filterSignals(rows, { ...ANY_CRITERIA, rsi: 'oversold' }))).toEqual(['UP']);
    expect(codes(filterSignals(rows, { ...ANY_CRITERIA, range: 'high' }))).toEqual(['DN']);
    expect(codes(filterSignals(rows, { ...ANY_CRITERIA, minScore: 2 }))).toEqual(['UP']);
  });

  it('ANDs fields together and describes a compound set', () => {
    // up AND score ≥ 2 → only UP (FL is up but score 1)
    expect(codes(filterSignals(rows, { ...ANY_CRITERIA, trend: 'up', minScore: 2 }))).toEqual(['UP']);
    expect(isActiveCriteria({ ...ANY_CRITERIA, trend: 'up' })).toBe(true);
    expect(describeCriteria({ trend: 'up', rsi: 'oversold', range: 'any', minScore: 1 })).toBe(
      'uptrend · oversold · score ≥ 1',
    );
  });
});

describe('coerceCriteria', () => {
  it('passes valid fields through and drops invalid ones to any/null', () => {
    expect(coerceCriteria({ trend: 'up', rsi: 'oversold', range: 'low', minScore: 2 })).toEqual({
      trend: 'up',
      rsi: 'oversold',
      range: 'low',
      minScore: 2,
    });
    expect(coerceCriteria({ trend: 'sideways', rsi: 7, range: 'XL', minScore: 'lots' })).toEqual(ANY_CRITERIA);
  });

  it('returns ANY_CRITERIA for non-objects and rejects non-finite scores', () => {
    expect(coerceCriteria(null)).toEqual(ANY_CRITERIA);
    expect(coerceCriteria('nope')).toEqual(ANY_CRITERIA);
    expect(coerceCriteria({ minScore: Infinity })).toEqual(ANY_CRITERIA);
    expect(coerceCriteria({ minScore: 0 }).minScore).toBe(0); // 0 is a valid floor
  });
});

describe('sameCriteria', () => {
  it('compares all four fields by value', () => {
    expect(sameCriteria(ANY_CRITERIA, { ...ANY_CRITERIA })).toBe(true);
    expect(sameCriteria({ ...ANY_CRITERIA, trend: 'up' }, { ...ANY_CRITERIA, trend: 'up' })).toBe(true);
    expect(sameCriteria({ ...ANY_CRITERIA, trend: 'up' }, { ...ANY_CRITERIA, trend: 'down' })).toBe(false);
    expect(sameCriteria({ ...ANY_CRITERIA, minScore: 1 }, { ...ANY_CRITERIA, minScore: null })).toBe(false);
  });
});
