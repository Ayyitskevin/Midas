import { describe, it, expect } from 'vitest';
import { sumDepth, bookImbalance, meanImbalance } from '@/lib/imbalance';
import type { OrderBook } from '@midas/shared';

function book(bids: [number, number][], asks: [number, number][], t = 1): OrderBook {
  return {
    symbol: 'BTC/USDT',
    bids: bids.map(([price, amount]) => ({ price, amount })),
    asks: asks.map(([price, amount]) => ({ price, amount })),
    timestamp: t,
  };
}

describe('sumDepth', () => {
  it('sums the first n level sizes', () => {
    const levels = [
      { price: 100, amount: 2 },
      { price: 99, amount: 3 },
      { price: 98, amount: 5 },
    ];
    expect(sumDepth(levels, 2)).toBe(5);
    expect(sumDepth(levels, 10)).toBe(10); // capped at length
  });
});

describe('bookImbalance', () => {
  it('is positive when bids outweigh asks, negative when asks dominate', () => {
    const heavyBid = bookImbalance(book([[100, 8]], [[101, 2]]), 5)!;
    expect(heavyBid.imbalance).toBeCloseTo((8 - 2) / 10, 9); // +0.6
    expect(heavyBid.mid).toBeCloseTo(100.5, 9);

    const heavyAsk = bookImbalance(book([[100, 2]], [[101, 8]]), 5)!;
    expect(heavyAsk.imbalance).toBeCloseTo(-0.6, 9);
  });

  it('is zero when both sides are balanced', () => {
    expect(bookImbalance(book([[100, 5]], [[101, 5]]), 5)!.imbalance).toBe(0);
  });

  it('only counts the top N levels', () => {
    const b = bookImbalance(
      book(
        [[100, 5], [99, 100]], // the 100-size level is beyond N=1
        [[101, 5], [102, 1]],
        7,
      ),
      1,
    )!;
    expect(b.bidDepth).toBe(5);
    expect(b.askDepth).toBe(5);
    expect(b.imbalance).toBe(0);
  });

  it('returns null for a one-sided book', () => {
    expect(bookImbalance(book([], [[101, 5]]), 5)).toBeNull();
    expect(bookImbalance(book([[100, 5]], []), 5)).toBeNull();
  });
});

describe('meanImbalance', () => {
  it('averages the imbalance across snapshots', () => {
    const snaps = [
      bookImbalance(book([[100, 8]], [[101, 2]]), 5)!, // +0.6
      bookImbalance(book([[100, 2]], [[101, 8]]), 5)!, // −0.6
      bookImbalance(book([[100, 5]], [[101, 5]]), 5)!, // 0
    ];
    expect(meanImbalance(snaps)).toBeCloseTo(0, 9);
    expect(meanImbalance([])).toBe(0);
  });
});
