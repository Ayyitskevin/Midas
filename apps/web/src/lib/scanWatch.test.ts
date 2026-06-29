import { describe, it, expect } from 'vitest';
import { matchingSymbols, newMatches, watchHeadline, watchBody } from './scanWatch';
import { ANY_CRITERIA, type SignalRow } from './signals';

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

describe('matchingSymbols', () => {
  const rows = [
    mkRow({ symbol: 'SOL/USDT', trend: 'up', score: 2 }),
    mkRow({ symbol: 'BTC/USDT', trend: 'up', score: 1 }),
    mkRow({ symbol: 'ETH/USDT', trend: 'down', score: -1 }),
  ];

  it('filters by criteria and returns symbols sorted (stable for diffing)', () => {
    expect(matchingSymbols(rows, { ...ANY_CRITERIA, trend: 'up' })).toEqual(['BTC/USDT', 'SOL/USDT']);
    expect(matchingSymbols(rows, { ...ANY_CRITERIA, minScore: 2 })).toEqual(['SOL/USDT']);
    expect(matchingSymbols(rows, ANY_CRITERIA)).toEqual(['BTC/USDT', 'ETH/USDT', 'SOL/USDT']);
  });
});

describe('newMatches', () => {
  it('returns only symbols present now but not before', () => {
    expect(newMatches(['BTC/USDT'], ['BTC/USDT', 'SOL/USDT'])).toEqual(['SOL/USDT']);
    expect(newMatches([], ['BTC/USDT'])).toEqual(['BTC/USDT']);
    expect(newMatches(['BTC/USDT'], ['BTC/USDT'])).toEqual([]);
    // dropping out is not a "new" match
    expect(newMatches(['BTC/USDT', 'SOL/USDT'], ['BTC/USDT'])).toEqual([]);
  });
});

describe('watch notification text', () => {
  it('pluralizes the headline and bases/truncates the body', () => {
    expect(watchHeadline('dips', ['BTC/USDT'])).toBe('Scan “dips”: 1 new match');
    expect(watchHeadline('dips', ['BTC/USDT', 'ETH/USDT'])).toBe('Scan “dips”: 2 new matches');
    expect(watchBody(['BTC/USDT', 'ETH/USDT'])).toBe('BTC, ETH');
    expect(watchBody(['A/USDT', 'B/USDT', 'C/USDT'], 2)).toBe('A, B +1 more');
  });
});
