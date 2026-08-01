import { describe, it, expect } from 'vitest';
import { computeVenueArbRow, type VenueQuote } from '@midas/shared';

// Coverage for the ARB panel's math, ported from the deleted lib/arb onto the
// shared implementation (bps units, same-venue-leg guard) it now uses — the
// same computation the XARB screener renders.
const v = (exchange: string, bid: number | null, ask: number | null, price: number): VenueQuote => ({
  exchange,
  bid,
  ask,
  price,
  changePercent: 0,
  volume: null,
  timestamp: 0,
});

describe('computeVenueArbRow (ARB panel)', () => {
  it('finds the highest bid and lowest ask and flags a crossed book', () => {
    const r = computeVenueArbRow('BTC/USDT', [
      v('A', 100, 101, 100.5),
      v('B', 102, 103, 102.5),
      v('C', 99, 100, 99.5),
    ]);
    expect(r.bestBid).toEqual({ exchange: 'B', value: 102 }); // sell here
    expect(r.bestAsk).toEqual({ exchange: 'C', value: 100 }); // buy here
    expect(r.spreadBps).toBeCloseTo(200); // (102 − 100) / 100 × 10 000
    expect(r.crossed).toBe(true);
    expect(r.dispersionBps).toBeCloseTo(((102.5 - 99.5) / 99.5) * 10_000);
  });

  it('reports a non-crossed book with a negative spread', () => {
    const r = computeVenueArbRow('BTC/USDT', [v('A', 100, 101, 100.5), v('B', 100.5, 101.5, 101)]);
    expect(r.bestBid).toEqual({ exchange: 'B', value: 100.5 });
    expect(r.bestAsk).toEqual({ exchange: 'A', value: 101 });
    expect(r.spreadBps).toBeCloseTo((-0.5 / 101) * 10_000);
    expect(r.crossed).toBe(false);
  });

  it('never flags an arb whose legs are the same venue', () => {
    // One venue's own crossed book is not a cross-venue arb.
    const single = computeVenueArbRow('BTC/USDT', [v('A', 100, 99, 99.5)]);
    expect(single.spreadBps).toBeNull();
    expect(single.crossed).toBe(false);

    // Same when one venue holds both the best bid and the best ask.
    const r = computeVenueArbRow('BTC/USDT', [v('A', 105, 100, 102), v('B', 101, 102, 101.5)]);
    expect(r.bestBid?.exchange).toBe('A');
    expect(r.bestAsk?.exchange).toBe('A');
    expect(r.spreadBps).toBeNull();
    expect(r.crossed).toBe(false);
  });

  it('ignores null/non-positive bids and asks; a zero spread is not crossed', () => {
    const r = computeVenueArbRow('BTC/USDT', [
      v('A', null, 101, 100.5),
      v('B', 100, null, 100),
      v('C', 99, 100, 99.5),
    ]);
    expect(r.bestBid).toEqual({ exchange: 'B', value: 100 });
    expect(r.bestAsk).toEqual({ exchange: 'C', value: 100 });
    expect(r.spreadBps).toBeCloseTo(0);
    expect(r.crossed).toBe(false);
  });

  it('drops venues with a missing price leg instead of fabricating 0', () => {
    const r = computeVenueArbRow('BTC/USDT', [v('A', 100, 101, 0), v('B', 99, 100, 100.5)]);
    // Only one priced venue — dispersion is unavailable, not 0 bp.
    expect(r.dispersionBps).toBeNull();
    expect(r.priceMin).toBe(100.5);
    expect(r.priceMax).toBe(100.5);
  });

  it('returns nulls for an empty venue set', () => {
    const r = computeVenueArbRow('BTC/USDT', []);
    expect(r.venues).toHaveLength(0);
    expect(r.bestBid).toBeNull();
    expect(r.bestAsk).toBeNull();
    expect(r.spreadBps).toBeNull();
    expect(r.crossed).toBe(false);
    expect(r.dispersionBps).toBeNull();
  });
});
