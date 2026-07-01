import { describe, it, expect } from 'vitest';
import { fillSlippageBps, fmtBps, recordBaseline, slippageBps, type FillBaseline } from './postTradeSlippage';

const base = (orderId: string, at = 0, estPrice = 100): FillBaseline => ({
  orderId,
  symbol: 'BTC/USDT',
  side: 'buy',
  estPrice,
  at,
});

describe('slippageBps', () => {
  it('is positive when the trader did worse than the estimate, on both sides', () => {
    expect(slippageBps('buy', 100, 100.5)).toBeCloseTo(50); // paid more
    expect(slippageBps('buy', 100, 99.5)).toBeCloseTo(-50); // price improvement
    expect(slippageBps('sell', 100, 99.5)).toBeCloseTo(50); // received less
    expect(slippageBps('sell', 100, 100.5)).toBeCloseTo(-50);
  });

  it('refuses unpriceable inputs', () => {
    expect(slippageBps('buy', 0, 100)).toBeNull();
    expect(slippageBps('buy', 100, 0)).toBeNull();
  });
});

describe('fillSlippageBps', () => {
  const baselines = { a1: base('a1') };

  it('joins a fill to its order baseline', () => {
    expect(fillSlippageBps({ orderId: 'a1', price: 101, side: 'buy' }, baselines)).toBeCloseTo(100);
  });

  it('is honestly null for unknown orders and fills without an orderId', () => {
    expect(fillSlippageBps({ orderId: 'zz', price: 101, side: 'buy' }, baselines)).toBeNull();
    expect(fillSlippageBps({ orderId: null, price: 101, side: 'buy' }, baselines)).toBeNull();
  });
});

describe('recordBaseline', () => {
  it('adds immutably and evicts the oldest beyond the cap', () => {
    let map: Record<string, FillBaseline> = {};
    map = recordBaseline(map, base('a', 1));
    map = recordBaseline(map, base('b', 2));
    map = recordBaseline(map, base('c', 3), 2);
    expect(Object.keys(map).sort()).toEqual(['b', 'c']); // 'a' (oldest) evicted
  });

  it('ignores junk entries', () => {
    expect(recordBaseline({}, base('', 1))).toEqual({});
    expect(recordBaseline({}, base('x', 1, 0))).toEqual({}); // estPrice 0
  });
});

describe('fmtBps', () => {
  it('signs and rounds to a tenth', () => {
    expect(fmtBps(3.24)).toBe('+3.2bp');
    expect(fmtBps(-1.45)).toBe('-1.4bp');
    expect(fmtBps(0)).toBe('0bp');
  });
});
