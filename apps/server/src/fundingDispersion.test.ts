import { describe, it, expect } from 'vitest';
import { computeFundingDispersion, type VenueDerivatives } from '@midas/shared';
import { createTtlCache } from './ttlCache';

const venue = (
  exchange: string,
  fundingRate: number | null,
  oi: number | null = null,
  fundingIntervalHours: number | null = 8,
): VenueDerivatives => ({
  exchange,
  fundingRate,
  fundingIntervalHours,
  nextFundingTime: 1_000,
  markPrice: 100,
  openInterestValue: oi,
  timestamp: 0,
});

describe('computeFundingDispersion', () => {
  it('reduces per-venue funding to the spread, extremes, mean and aggregate OI', () => {
    const row = computeFundingDispersion('BTC/USDT', [
      venue('binance', 0.0001, 1_000),
      venue('okx', -0.0002, 2_000),
      venue('bybit', 0.0003, 3_000),
    ]);
    expect(row.symbol).toBe('BTC/USDT');
    expect(row.maxRate).toBe(0.0003);
    expect(row.minRate).toBe(-0.0002);
    expect(row.highVenue).toBe('bybit'); // dearest → short it
    expect(row.lowVenue).toBe('okx'); // cheapest → long it
    // spread = (0.0003 − −0.0002) = 0.0005 → 5 bps (all 8h venues: normalized = raw)
    expect(row.spreadBps).toBeCloseTo(5, 10);
    expect(row.meanRate).toBeCloseTo((0.0001 - 0.0002 + 0.0003) / 3, 12);
    expect(row.totalOiValue).toBe(6_000);
    // venues returned sorted by normalized rate, dearest → cheapest
    expect(row.venues.map((v) => v.exchange)).toEqual(['bybit', 'binance', 'okx']);
  });

  it('normalizes mixed funding cadences to a per-8h basis before comparing', () => {
    // hyperliquid funds hourly: a raw 0.015%/1h rate is 0.12% per 8h — 4x the
    // raw 0.03%/8h rate. Comparing raw rates would rank binance dearest; the
    // normalized comparison correctly ranks the hourly venue dearest.
    const row = computeFundingDispersion('ETH/USDT', [
      venue('hyperliquid', 0.00015, null, 1),
      venue('binance', 0.0003, null, 8),
    ]);
    expect(row.highVenue).toBe('hyperliquid'); // 0.00015 × 8 = 0.0012 normalized
    expect(row.lowVenue).toBe('binance'); // 0.0003 normalized
    expect(row.maxRate).toBeCloseTo(0.0012, 12);
    expect(row.minRate).toBeCloseTo(0.0003, 12);
    // spread = (0.0012 − 0.0003) → 9 bps on the per-8h basis
    expect(row.spreadBps).toBeCloseTo(9, 10);
    // venue points keep the RAW per-interval rate, labeled with its cadence
    expect(row.venues.find((v) => v.exchange === 'hyperliquid')).toMatchObject({
      fundingRate: 0.00015,
      fundingIntervalHours: 1,
    });
  });

  it('excludes venues with an unknown interval from the spread rather than comparing them raw', () => {
    const row = computeFundingDispersion('SOL/USDT', [
      venue('binance', 0.0001, null, 8),
      venue('okx', 0.0002, null, 8),
      venue('mystery', 0.01, null, null), // extreme raw rate, no cadence — must not skew the spread
    ]);
    expect(row.venues.map((v) => v.exchange)).toEqual(['okx', 'binance']);
    expect(row.spreadBps).toBeCloseTo(1, 10); // (0.0002 − 0.0001) → 1 bp, unmoved by 'mystery'
    // …but its OI still counts toward the aggregate
    const withOi = computeFundingDispersion('SOL/USDT', [
      venue('binance', 0.0001, 500, 8),
      venue('mystery', 0.01, 1_500, null),
    ]);
    expect(withOi.totalOiValue).toBe(2_000);
    expect(withOi.spreadBps).toBeNull(); // only one comparable venue → no arb signal
  });

  it('normalizes a 4h venue by doubling its raw rate onto the per-8h basis', () => {
    const row = computeFundingDispersion('DOGE/USDT', [
      venue('binance', 0.0002, null, 4), // 0.0004 per-8h-equivalent
      venue('okx', 0.0003, null, 8),
    ]);
    expect(row.highVenue).toBe('binance');
    expect(row.maxRate).toBeCloseTo(0.0004, 12);
    expect(row.spreadBps).toBeCloseTo(1, 10);
  });

  it('ignores venues with no funding rate and needs ≥ 2 venues for a spread', () => {
    const one = computeFundingDispersion('ETH/USDT', [venue('binance', 0.0001), venue('kraken', null)]);
    expect(one.venues).toHaveLength(1);
    expect(one.spreadBps).toBeNull(); // only one reporting venue → no arb signal
    expect(one.maxRate).toBe(0.0001);
    expect(one.minRate).toBe(0.0001);
  });

  it('returns nulls (never NaN) when no venue reports funding', () => {
    const none = computeFundingDispersion('DOGE/USDT', [venue('binance', null), venue('okx', null)]);
    expect(none.venues).toHaveLength(0);
    expect(none.spreadBps).toBeNull();
    expect(none.minRate).toBeNull();
    expect(none.maxRate).toBeNull();
    expect(none.meanRate).toBeNull();
    expect(none.highVenue).toBeNull();
    expect(none.lowVenue).toBeNull();
    expect(none.totalOiValue).toBeNull();
  });

  it('sums OI even from venues whose funding is null', () => {
    const row = computeFundingDispersion('SOL/USDT', [venue('binance', 0.0001, 500), venue('okx', null, 1_500)]);
    expect(row.totalOiValue).toBe(2_000);
  });
});

describe('createTtlCache', () => {
  it('caches within the TTL and recomputes after it expires', async () => {
    let clock = 0;
    let calls = 0;
    const cache = createTtlCache<number>(100, () => clock);
    const compute = async () => ++calls;

    expect(await cache.get('k', compute)).toBe(1);
    clock = 50;
    expect(await cache.get('k', compute)).toBe(1); // still fresh
    expect(calls).toBe(1);
    clock = 150;
    expect(await cache.get('k', compute)).toBe(2); // expired → recomputed
    expect(calls).toBe(2);
  });

  it('single-flights concurrent misses on the same key', async () => {
    let calls = 0;
    const cache = createTtlCache<number>(1_000);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const compute = async () => {
      calls++;
      await gate;
      return 42;
    };

    const a = cache.get('k', compute);
    const b = cache.get('k', compute);
    release();
    expect(await Promise.all([a, b])).toEqual([42, 42]);
    expect(calls).toBe(1); // both awaited one shared computation
  });

  it('keys are independent', async () => {
    const cache = createTtlCache<string>(1_000);
    expect(await cache.get('a', async () => 'A')).toBe('A');
    expect(await cache.get('b', async () => 'B')).toBe('B');
  });

  it('does not cache a rejected computation (next call retries)', async () => {
    let calls = 0;
    const cache = createTtlCache<number>(1_000);
    await expect(
      cache.get('k', async () => {
        calls++;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await cache.get('k', async () => ++calls)).toBe(2); // retried, not a cached rejection
  });
});
