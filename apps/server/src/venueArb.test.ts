import { describe, it, expect } from 'vitest';
import { computeVenueArbRow, type VenueQuote } from '@midas/shared';

const q = (exchange: string, price: number, bid: number | null, ask: number | null): VenueQuote => ({
  exchange,
  price,
  bid,
  ask,
  changePercent: 0,
  volume: 1_000,
  timestamp: 0,
});

describe('computeVenueArbRow', () => {
  it('finds the sell-here / buy-here legs, dispersion and spread across venues', () => {
    // Per-venue spread (0.20) wider than the cross-venue price gap (0.04) → not crossed.
    const row = computeVenueArbRow('BTC/USDT', [
      q('binance', 100.0, 99.9, 100.1),
      q('okx', 100.02, 99.92, 100.12),
      q('kraken', 99.98, 99.88, 100.08),
    ]);
    expect(row.bestBid).toEqual({ exchange: 'okx', value: 99.92 }); // highest bid → sell here
    expect(row.bestAsk).toEqual({ exchange: 'kraken', value: 100.08 }); // lowest ask → buy here
    expect(row.crossed).toBe(false); // bestBid < bestAsk
    expect(row.spreadBps).toBeLessThan(0);
    expect(row.priceMin).toBe(99.98);
    expect(row.priceMax).toBe(100.02);
    // dispersion = (100.02 − 99.98) / 99.98 × 10000 ≈ 4.0 bps
    expect(row.dispersionBps).toBeCloseTo(4.0, 1);
    // venues sorted dearest → cheapest by last price
    expect(row.venues.map((v) => v.exchange)).toEqual(['okx', 'binance', 'kraken']);
  });

  it('flags a crossed book (a gross-of-fees arb) with a positive spread', () => {
    const row = computeVenueArbRow('ETH/USDT', [
      q('a', 100, 100.5, 100.6), // bids high
      q('b', 100, 99.4, 99.5), // asks low
    ]);
    expect(row.crossed).toBe(true);
    expect(row.spreadBps).toBeGreaterThan(0);
    expect(row.bestBid?.exchange).toBe('a');
    expect(row.bestAsk?.exchange).toBe('b');
  });

  it('needs ≥ 2 venues for a dispersion/spread', () => {
    const one = computeVenueArbRow('SOL/USDT', [q('binance', 100, 99.9, 100.1)]);
    expect(one.dispersionBps).toBeNull();
    expect(one.spreadBps).toBeNull();
    expect(one.crossed).toBe(false);
    expect(one.bestBid?.exchange).toBe('binance'); // legs still resolved
  });

  it('still computes price dispersion when bid/ask legs are missing', () => {
    const row = computeVenueArbRow('DOGE/USDT', [q('a', 0.1, null, null), q('b', 0.11, null, null)]);
    expect(row.bestBid).toBeNull();
    expect(row.bestAsk).toBeNull();
    expect(row.spreadBps).toBeNull(); // no legs → no spread
    expect(row.crossed).toBe(false);
    expect(row.dispersionBps).toBeCloseTo(1000, 0); // (0.11 − 0.1)/0.1 × 10000
  });

  it('ignores non-positive prices and legs', () => {
    const row = computeVenueArbRow('X/USDT', [q('a', 100, 99, 101), q('b', 0, -1, 0)]);
    // only venue a has a valid price → < 2 priced venues → no dispersion
    expect(row.dispersionBps).toBeNull();
    expect(row.bestBid?.exchange).toBe('a');
    expect(row.bestAsk?.exchange).toBe('a');
  });
});
