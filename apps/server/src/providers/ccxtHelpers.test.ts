import { describe, it, expect } from 'vitest';
import { timeframeSeconds, tickerPrice } from './ccxt/helpers';

describe('timeframeSeconds', () => {
  it('parses ccxt timeframe strings to seconds (m is minute, M is month)', () => {
    expect(timeframeSeconds('1m')).toBe(60);
    expect(timeframeSeconds('5m')).toBe(300);
    expect(timeframeSeconds('1h')).toBe(3600);
    expect(timeframeSeconds('4h')).toBe(14400);
    expect(timeframeSeconds('1d')).toBe(86400);
    expect(timeframeSeconds('1w')).toBe(604800);
    expect(timeframeSeconds('1M')).toBe(2592000);
  });
  it('returns 0 for unparseable input (callers fall back)', () => {
    expect(timeframeSeconds('')).toBe(0);
    expect(timeframeSeconds('nope')).toBe(0);
    expect(timeframeSeconds('m1')).toBe(0);
  });
});

describe('tickerPrice', () => {
  it('prefers last, then close', () => {
    expect(tickerPrice({ last: 100, close: 99 })).toBe(100);
    expect(tickerPrice({ last: null, close: 99 })).toBe(99);
  });
  it('falls back to the bid/ask mid when last and close are missing', () => {
    expect(tickerPrice({ last: null, close: null, bid: 10, ask: 12 })).toBe(11);
    expect(tickerPrice({ bid: 10, ask: 12 })).toBe(11);
  });
  it('returns null (never 0) when no usable price exists', () => {
    expect(tickerPrice({})).toBeNull();
    expect(tickerPrice({ last: null, close: null, bid: null, ask: null })).toBeNull();
  });
  it('treats non-positive last/close as absent and uses the mid', () => {
    expect(tickerPrice({ last: 0, close: 0, bid: 10, ask: 12 })).toBe(11);
    expect(tickerPrice({ last: -5 })).toBeNull(); // negative, no bid/ask
  });
});
