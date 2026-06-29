import { describe, it, expect } from 'vitest';
import { previewOrder } from './orderPreview';
import type { Level } from './slippage';

// A small, well-spaced book. Best ask 100, best bid 99.
const asks: Level[] = [
  { price: 100, size: 1 },
  { price: 101, size: 2 },
  { price: 102, size: 3 },
];
const bids: Level[] = [
  { price: 99, size: 1 },
  { price: 98, size: 2 },
  { price: 97, size: 3 },
];
const book = { bids, asks };

describe('previewOrder — market', () => {
  it('walks asks for a market buy: avg fill, slippage, fee and total cost', () => {
    const p = previewOrder(book, { side: 'buy', type: 'market', amount: 2, feeBps: 5 });
    expect(p.ok).toBe(true);
    expect(p.marketable).toBe(true);
    expect(p.filledBase).toBe(2);
    expect(p.filledQuote).toBe(201); // 1@100 + 1@101
    expect(p.avgPrice).toBe(100.5);
    expect(p.bestPrice).toBe(100);
    expect(p.worstPrice).toBe(101);
    expect(p.slippagePct).toBeCloseTo(0.5); // (100.5-100)/100
    expect(p.fee).toBeCloseTo(0.10_05); // 201 * 5bps
    expect(p.cashValue).toBeCloseTo(201.1005); // buy pays notional + fee
    expect(p.exhausted).toBe(false);
  });

  it('flags a market order that runs the book dry as exhausted, with the unfilled remainder', () => {
    const p = previewOrder(book, { side: 'buy', type: 'market', amount: 100 });
    expect(p.filledBase).toBe(6); // 1+2+3
    expect(p.unfilledBase).toBe(94);
    expect(p.exhausted).toBe(true);
  });

  it('hits bids for a market sell and receives notional minus fee', () => {
    const p = previewOrder(book, { side: 'sell', type: 'market', amount: 2, feeBps: 10 });
    expect(p.filledQuote).toBe(197); // 1@99 + 1@98
    expect(p.avgPrice).toBe(98.5);
    expect(p.slippagePct).toBeCloseTo((99 - 98.5) / 99 * 100);
    expect(p.cashValue).toBeCloseTo(197 - 197 * 0.001); // sell receives notional − fee
  });
});

describe('previewOrder — limit', () => {
  it('a crossing limit buy takes only levels at/under the limit, rest rests', () => {
    const p = previewOrder(book, { side: 'buy', type: 'limit', amount: 2, limitPrice: 100 });
    expect(p.marketable).toBe(true);
    expect(p.filledBase).toBe(1); // only the 100 level qualifies
    expect(p.unfilledBase).toBe(1);
    expect(p.restingPrice).toBe(100); // remainder rests at the limit
    expect(p.exhausted).toBe(false); // a limit rests, it is not "exhausted"
  });

  it('a non-marketable limit buy (below the touch) rests fully, nothing fills', () => {
    const p = previewOrder(book, { side: 'buy', type: 'limit', amount: 2, limitPrice: 99 });
    expect(p.ok).toBe(true);
    expect(p.marketable).toBe(false);
    expect(p.filledBase).toBe(0);
    expect(p.unfilledBase).toBe(2);
    expect(p.restingPrice).toBe(99);
  });

  it('a crossing limit sell hits qualifying bids', () => {
    const p = previewOrder(book, { side: 'sell', type: 'limit', amount: 5, limitPrice: 98 });
    expect(p.marketable).toBe(true);
    expect(p.filledBase).toBe(3); // 1@99 + 2@98 (>= limit 98)
    expect(p.restingPrice).toBe(98); // remaining 2 rests
  });
});

describe('previewOrder — validation', () => {
  it('rejects a non-positive amount', () => {
    const p = previewOrder(book, { side: 'buy', type: 'market', amount: 0 });
    expect(p.ok).toBe(false);
    expect(p.errors.join(' ')).toMatch(/amount/i);
  });

  it('requires a price for a limit order', () => {
    const p = previewOrder(book, { side: 'buy', type: 'limit', amount: 1, limitPrice: null });
    expect(p.ok).toBe(false);
    expect(p.errors.join(' ')).toMatch(/limit price/i);
  });

  it('reports an empty book honestly', () => {
    const p = previewOrder({ bids: [], asks: [] }, { side: 'buy', type: 'market', amount: 1 });
    expect(p.ok).toBe(false);
    expect(p.errors.join(' ')).toMatch(/liquidity/i);
    expect(p.bestPrice).toBeNull();
  });
});
