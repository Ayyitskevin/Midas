import { describe, it, expect } from 'vitest';
import { walkBook, cumulativeDepth, type Level } from '@/lib/slippage';

const lvl = (price: number, size: number): Level => ({ price, size });

describe('walkBook — buy', () => {
  const asks = [lvl(100, 1), lvl(101, 2), lvl(102, 5)];

  it('averages across consumed levels and measures slippage vs the touch', () => {
    const r = walkBook(asks, 'buy', 2, 'base');
    expect(r.filledBase).toBeCloseTo(2);
    expect(r.filledQuote).toBeCloseTo(201); // 100 + 101
    expect(r.avgPrice).toBeCloseTo(100.5);
    expect(r.bestPrice).toBe(100);
    expect(r.slippagePct).toBeCloseTo(0.5);
    expect(r.exhausted).toBe(false);
    expect(r.levelsUsed).toBe(2);
  });

  it('flags exhaustion when the book is too thin', () => {
    const r = walkBook(asks, 'buy', 10, 'base'); // only 8 available
    expect(r.filledBase).toBeCloseTo(8);
    expect(r.exhausted).toBe(true);
  });

  it('fills a quote budget, taking a partial last level', () => {
    const r = walkBook([lvl(100, 1), lvl(101, 2)], 'buy', 150, 'quote');
    expect(r.filledQuote).toBeCloseTo(150);
    expect(r.filledBase).toBeCloseTo(1 + 50 / 101);
    expect(r.exhausted).toBe(false);
  });

  it('sorts defensively regardless of input order', () => {
    const r = walkBook([lvl(102, 5), lvl(100, 1), lvl(101, 2)], 'buy', 1, 'base');
    expect(r.bestPrice).toBe(100);
    expect(r.avgPrice).toBeCloseTo(100);
  });
});

describe('walkBook — sell', () => {
  it('walks bids high→low and reports positive slippage below the touch', () => {
    const r = walkBook([lvl(99, 1), lvl(98, 2)], 'sell', 2, 'base');
    expect(r.filledQuote).toBeCloseTo(197); // 99 + 98
    expect(r.avgPrice).toBeCloseTo(98.5);
    expect(r.bestPrice).toBe(99);
    expect(r.slippagePct).toBeCloseTo((99 - 98.5) / 99 * 100);
  });
});

describe('walkBook — edges', () => {
  it('returns nulls for an empty book', () => {
    const r = walkBook([], 'buy', 5, 'base');
    expect(r.avgPrice).toBeNull();
    expect(r.bestPrice).toBeNull();
    expect(r.slippagePct).toBeNull();
    expect(r.exhausted).toBe(true);
  });

  it('does nothing for a non-positive target', () => {
    const r = walkBook([lvl(100, 1)], 'buy', 0, 'base');
    expect(r.filledBase).toBe(0);
    expect(r.exhausted).toBe(false);
  });
});

describe('cumulativeDepth', () => {
  it('accumulates size by level in order', () => {
    expect(cumulativeDepth([lvl(100, 1), lvl(101, 2), lvl(102, 0.5)])).toEqual([
      { price: 100, cum: 1 },
      { price: 101, cum: 3 },
      { price: 102, cum: 3.5 },
    ]);
  });

  it('skips non-positive levels', () => {
    expect(cumulativeDepth([lvl(100, 1), lvl(0, 5), lvl(101, 1)])).toEqual([
      { price: 100, cum: 1 },
      { price: 101, cum: 2 },
    ]);
  });
});
