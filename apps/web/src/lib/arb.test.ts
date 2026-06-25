import { describe, it, expect } from 'vitest';
import { computeArb, type VenueLevel } from '@/lib/arb';

const v = (exchange: string, bid: number | null, ask: number | null, price: number): VenueLevel => ({
  exchange,
  bid,
  ask,
  price,
});

describe('computeArb', () => {
  it('finds the highest bid and lowest ask and flags a crossed book', () => {
    const r = computeArb([
      v('A', 100, 101, 100.5),
      v('B', 102, 103, 102.5),
      v('C', 99, 100, 99.5),
    ]);
    expect(r.bestBid).toEqual({ exchange: 'B', value: 102 }); // sell here
    expect(r.bestAsk).toEqual({ exchange: 'C', value: 100 }); // buy here
    expect(r.spread).toBeCloseTo(2);
    expect(r.spreadPct).toBeCloseTo(2); // 2 / 100
    expect(r.crossed).toBe(true);
    expect(r.dispersionPct).toBeCloseTo(((102.5 - 99.5) / 99.5) * 100);
  });

  it('reports a non-crossed book with a negative spread', () => {
    const r = computeArb([v('A', 100, 101, 100.5), v('B', 100.5, 101.5, 101)]);
    expect(r.bestBid).toEqual({ exchange: 'B', value: 100.5 });
    expect(r.bestAsk).toEqual({ exchange: 'A', value: 101 });
    expect(r.spread).toBeCloseTo(-0.5);
    expect(r.crossed).toBe(false);
  });

  it('ignores null/non-positive bids and asks', () => {
    const r = computeArb([v('A', null, 101, 100.5), v('B', 100, null, 100), v('C', 99, 100, 99.5)]);
    expect(r.bestBid).toEqual({ exchange: 'B', value: 100 });
    expect(r.bestAsk).toEqual({ exchange: 'C', value: 100 });
  });

  it('returns nulls for an empty venue set', () => {
    const r = computeArb([]);
    expect(r.venues).toBe(0);
    expect(r.bestBid).toBeNull();
    expect(r.bestAsk).toBeNull();
    expect(r.spread).toBeNull();
    expect(r.crossed).toBe(false);
    expect(r.dispersionPct).toBeNull();
  });

  it('has zero dispersion for a single venue', () => {
    const r = computeArb([v('A', 100, 101, 100.5)]);
    expect(r.dispersionPct).toBeCloseTo(0);
    expect(r.spread).toBeCloseTo(-1); // its own bid − ask
  });
});
