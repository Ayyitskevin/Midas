import { describe, it, expect } from 'vitest';
import { CcxtProvider } from './ccxt';
import type { OiDelta } from '@midas/shared';

/**
 * Coverage for CcxtProvider.getOiDelta — the OI-change-vs-price-change
 * positioning read. The exchange client is a deterministic stub (same idiom as
 * ccxt.test.ts — the private field is swapped for a fake; no real exchange is
 * ever contacted): the fetchOpenInterestHistory has-guard, the OI/price bucket
 * alignment (including the period-end vs period-start fallback), the null
 * degradation of a failed price leg, and the honest 'unavailable' paths.
 */

const makeProvider = (exchange: Record<string, unknown>): CcxtProvider => {
  const p = new CcxtProvider({ exchange: 'binance', apiKey: 'test-key', secret: 'test-secret' });
  (p as unknown as { exchange: unknown }).exchange = exchange;
  return p;
};

// Aligned to a whole 5m bucket so floor-alignment is deterministic.
const T0 = 1_700_000_100_000; // …000 mod 300_000 === 0
const BUCKET = 300_000; // 5m — the '1h' window's OI timeframe

/** A stub venue with an OI-history read: OI rising ~5%, price rising ~2%. */
const oiVenue = () => ({
  id: 'binance',
  name: 'Binance',
  has: { fetchOpenInterestHistory: true },
  fetchOpenInterestHistory: async (symbol: string, timeframe: string, since?: number, limit?: number) => {
    expect(symbol).toBe('BTC/USDT:USDT');
    expect(timeframe).toBe('5m');
    expect(typeof since).toBe('number');
    expect(limit).toBe(500);
    return [0, 1, 2].map((i) => ({
      timestamp: T0 + i * BUCKET,
      openInterestValue: 1_000_000 * (1 + 0.025 * i),
    }));
  },
  fetchOHLCV: async (_symbol: string, _timeframe: string) =>
    [0, 1, 2].map((i) => [T0 + i * BUCKET, 50_000, 51_000, 49_500, 50_000 * (1 + 0.01 * i), 10]),
});

describe('CcxtProvider.getOiDelta', () => {
  it('pairs OI history with OHLCV closes and classifies the quadrant', async () => {
    const p = makeProvider(oiVenue());
    const d = await p.getOiDelta('BTC/USDT', '1h');
    expect(d.symbol).toBe('BTC/USDT:USDT');
    expect(d.window).toBe('1h');
    expect(d.provenance).toBe('live');
    expect(d.source).toBe('ccxt:binance');
    expect(d.note).toBeNull();
    expect(d.points).toHaveLength(3);
    expect(d.oiChangePct).toBeCloseTo(5, 5);
    expect(d.priceChangePct).toBeCloseTo(2, 5);
    expect(d.classification).toBe('long-buildup');
    expect(d.asOf).toBe(T0 + 2 * BUCKET);
  });

  it('falls back one bucket for an OI observation whose own bar is missing', async () => {
    // The newest OI observation lands a bucket past the last closed price bar
    // (period-end vs period-start conventions, or a still-forming bar) — it
    // pairs back to the previous close instead of going price-null, and the
    // flat price change honestly yields no classification.
    const venue = {
      id: 'binance',
      name: 'Binance',
      has: { fetchOpenInterestHistory: true },
      fetchOpenInterestHistory: async () => [
        { timestamp: T0 + BUCKET, openInterestValue: 1_000_000 },
        { timestamp: T0 + 2 * BUCKET, openInterestValue: 900_000 },
      ],
      fetchOHLCV: async () => [
        [T0, 50_000, 51_000, 49_500, 50_000, 10],
        [T0 + BUCKET, 50_500, 51_500, 50_000, 51_000, 12],
      ],
    };
    const p = makeProvider(venue);
    const d = await p.getOiDelta('BTC/USDT', '1h');
    expect(d.points[0].price).toBe(51_000); // exact bucket
    expect(d.points[1].price).toBe(51_000); // fallback to the previous close
    expect(d.priceChangePct).toBe(0); // flat — not a fabrication, but no quadrant
    expect(d.classification).toBeNull();
  });

  it('is honest unavailable when the venue publishes no OI history (the Deribit shape)', async () => {
    const p = makeProvider({ id: 'deribit', name: 'Deribit', has: {} });
    const d = await p.getOiDelta('BTC/USDT', '24h');
    expect(d.provenance).toBe('unavailable');
    expect(d.note).toContain('open-interest history');
    expect(d.points).toEqual([]);
    expect(d.oiChangePct).toBeNull();
    expect(d.classification).toBeNull();
  });

  it('is honest unavailable when the OI-history read throws or comes back empty', async () => {
    const throwing = makeProvider({
      id: 'binance',
      has: { fetchOpenInterestHistory: true },
      fetchOpenInterestHistory: async () => {
        const err = new Error('GET https://fapi.binance.com/futures/data/openInterestHist?signature=deadbeef 418');
        err.name = 'RateLimitExceeded';
        throw err;
      },
    });
    const d = await throwing.getOiDelta('BTC/USDT', '1h');
    expect(d.provenance).toBe('unavailable');
    // The note carries the sanitized error class, never the signed URL.
    expect(d.note).toContain('RateLimitExceeded');
    expect(d.note).not.toContain('signature=');

    const empty = makeProvider({
      id: 'binance',
      has: { fetchOpenInterestHistory: true },
      fetchOpenInterestHistory: async () => [],
    });
    const d2 = await empty.getOiDelta('BTC/USDT', '1h');
    expect(d2.provenance).toBe('unavailable');
    expect(d2.note).toContain('no open-interest history');
  });

  it('keeps the live OI change with a null price change when the price leg fails', async () => {
    const venue = oiVenue();
    venue.fetchOHLCV = async () => {
      throw new Error('no candles');
    };
    const p = makeProvider(venue);
    const d: OiDelta = await p.getOiDelta('BTC/USDT', '1h');
    expect(d.provenance).toBe('live');
    expect(d.oiChangePct).toBeCloseTo(5, 5);
    expect(d.priceChangePct).toBeNull();
    expect(d.classification).toBeNull();
    expect(d.points.every((pt) => pt.price === null)).toBe(true);
  });
});
