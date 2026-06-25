import { describe, it, expect } from 'vitest';
import { depthNotional, liquidity, sortLiquidity, type LiquidityRow } from '@/lib/liquidity';
import type { OrderBook } from '@midas/shared';

function book(bids: [number, number][], asks: [number, number][]): OrderBook {
  return {
    symbol: 'X/USDT',
    bids: bids.map(([price, amount]) => ({ price, amount })),
    asks: asks.map(([price, amount]) => ({ price, amount })),
    timestamp: 1,
  };
}

describe('depthNotional', () => {
  it('sums price × size over the first n levels', () => {
    const levels = [
      { price: 100, amount: 2 }, // 200
      { price: 99, amount: 1 }, // 99
      { price: 98, amount: 5 }, // beyond n=2
    ];
    expect(depthNotional(levels, 2)).toBe(299);
  });
});

describe('liquidity', () => {
  it('computes spread (bps) and per-side depth', () => {
    // bid 99.9, ask 100.1 → mid 100, spread 0.2 → 20 bps
    const r = liquidity('ETH/USDT', book([[99.9, 10]], [[100.1, 5]]), 5)!;
    expect(r.mid).toBeCloseTo(100, 9);
    expect(r.spread).toBeCloseTo(0.2, 9);
    expect(r.spreadBps).toBeCloseTo(20, 6);
    expect(r.bidDepth).toBeCloseTo(999, 6); // 99.9 × 10
    expect(r.askDepth).toBeCloseTo(500.5, 6); // 100.1 × 5
    expect(r.totalDepth).toBeCloseTo(1499.5, 6);
  });

  it('returns null for a one-sided book', () => {
    expect(liquidity('X/USDT', book([], [[100, 1]]), 5)).toBeNull();
  });
});

describe('sortLiquidity', () => {
  const rows: LiquidityRow[] = [
    { symbol: 'A', mid: 1, spread: 0, spreadBps: 12, bidDepth: 0, askDepth: 0, totalDepth: 500 },
    { symbol: 'B', mid: 1, spread: 0, spreadBps: 3, bidDepth: 0, askDepth: 0, totalDepth: 100 },
    { symbol: 'C', mid: 1, spread: 0, spreadBps: 40, bidDepth: 0, askDepth: 0, totalDepth: 900 },
  ];

  it('ranks tightest spread first and deepest book first', () => {
    expect(sortLiquidity(rows, 'spread').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
    expect(sortLiquidity(rows, 'depth').map((r) => r.symbol)).toEqual(['C', 'A', 'B']);
    expect(sortLiquidity(rows, 'symbol').map((r) => r.symbol)).toEqual(['A', 'B', 'C']);
  });

  it('does not mutate the input', () => {
    const before = rows.map((r) => r.symbol);
    sortLiquidity(rows, 'depth');
    expect(rows.map((r) => r.symbol)).toEqual(before);
  });
});
