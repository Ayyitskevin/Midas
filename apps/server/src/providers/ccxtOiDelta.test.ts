import { describe, it, expect } from 'vitest';
import type { Exchange } from 'ccxt';
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

// Aligned to a whole 5m bucket so floor-alignment is deterministic.
const T0 = 1_700_000_100_000; // …000 mod 300_000 === 0
const BUCKET = 300_000; // 5m — the '1h' window's OI timeframe
const NOW = T0 + 12 * BUCKET;

const makeProvider = (exchange: Record<string, unknown>): CcxtProvider =>
  new CcxtProvider(undefined, {
    exchange: exchange as unknown as Exchange,
    compareExchanges: [],
    now: () => NOW,
  });

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
    return [0, 6, 12].map((i) => ({
      timestamp: T0 + i * BUCKET,
      openInterestValue: 1_000_000 * (1 + (0.05 * i) / 12),
    }));
  },
  fetchOHLCV: async (_symbol: string, _timeframe: string) =>
    [0, 6, 12].map((i) => [T0 + i * BUCKET, 50_000, 51_000, 49_500, 50_000 * (1 + (0.02 * i) / 12), 10]),
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
    expect(d.asOf).toBe(NOW);
    expect(d.receipt?.coverage).toContain('3600000ms actual');
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
        { timestamp: T0, openInterestValue: 1_000_000 },
        { timestamp: NOW, openInterestValue: 900_000 },
      ],
      fetchOHLCV: async () => [
        [T0, 50_000, 51_000, 49_500, 50_000, 10],
        [NOW - BUCKET, 50_500, 51_500, 50_000, 51_000, 12],
      ],
    };
    const p = makeProvider(venue);
    const d = await p.getOiDelta('BTC/USDT', '1h');
    expect(d.points[0].price).toBe(50_000); // exact start bucket
    expect(d.points[1].price).toBe(51_000); // fallback to the previous close
    expect(d.priceChangePct).toBeCloseTo(2, 10);
    expect(d.classification).toBe('short-covering');
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

  it('throws a sanitized system failure when OI history errors, while empty success is unavailable', async () => {
    const throwing = makeProvider({
      id: 'binance',
      has: { fetchOpenInterestHistory: true },
      fetchOpenInterestHistory: async () => {
        const err = new Error('GET https://fapi.binance.com/futures/data/openInterestHist?signature=deadbeef 418');
        err.name = 'RateLimitExceeded';
        throw err;
      },
    });
    const err = await throwing.getOiDelta('BTC/USDT', '1h').catch((error: unknown) => error);
    expect(err).toMatchObject({ name: 'ProviderError', statusCode: 502 });
    expect((err as Error).message).toContain('RateLimitExceeded');
    expect((err as Error).message).not.toContain('signature=');

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

  it('records mixed malformed OI/price row counts and rejects wholly malformed OI history', async () => {
    const partial = makeProvider({
      id: 'binance', name: 'Binance', has: { fetchOpenInterestHistory: true },
      fetchOpenInterestHistory: async () => [
        { timestamp: T0, openInterestValue: 1_000_000 },
        { timestamp: T0 + 6 * BUCKET, openInterestValue: Number.NaN },
        { timestamp: NOW, openInterestValue: 1_100_000 },
      ],
      fetchOHLCV: async () => [
        [T0, 1, 1, 1, 50_000, 1],
        [T0 + 6 * BUCKET, 1, 1, 1, Number.NaN, 1],
        [NOW, 1, 1, 1, 51_000, 1],
      ],
    });
    const result = await partial.getOiDelta('BTC/USDT', '1h');
    const limitations = result.receipt?.limitations.join(' ') ?? '';
    expect(limitations).toMatch(/Open-interest history attempted 3.*2 returned.*1.*malformed/i);
    expect(limitations).toMatch(/Price-history alignment attempted 3.*2 returned.*1.*malformed/i);

    const malformed = makeProvider({
      id: 'binance', name: 'Binance', has: { fetchOpenInterestHistory: true },
      fetchOpenInterestHistory: async () => [{ timestamp: T0, openInterestValue: Number.NaN }],
    });
    await expect(malformed.getOiDelta('BTC/USDT', '1h')).rejects.toMatchObject({
      name: 'ProviderError', statusCode: 502, message: expect.stringMatching(/malformed open-interest history/i),
    });
  });

  it('refuses to label a short or future series as the requested window', async () => {
    const short = makeProvider({
      id: 'binance', name: 'Binance', has: { fetchOpenInterestHistory: true },
      fetchOpenInterestHistory: async () => [
        { timestamp: NOW - 2 * BUCKET, openInterestValue: 1_000_000 },
        { timestamp: NOW, openInterestValue: 1_100_000 },
      ],
    });
    const shortResult = await short.getOiDelta('BTC/USDT', '1h');
    expect(shortResult.provenance).toBe('unavailable');
    expect(shortResult.classification).toBeNull();
    expect(shortResult.note).toMatch(/did not cover the requested 1h window/i);

    const future = makeProvider({
      id: 'binance', name: 'Binance', has: { fetchOpenInterestHistory: true },
      fetchOpenInterestHistory: async () => [
        { timestamp: T0, openInterestValue: 1_000_000 },
        { timestamp: NOW + 1, openInterestValue: 1_100_000 },
      ],
    });
    await expect(future.getOiDelta('BTC/USDT', '1h')).rejects.toMatchObject({
      name: 'ProviderError', statusCode: 502, message: expect.stringMatching(/out-of-window/i),
    });
  });
});
