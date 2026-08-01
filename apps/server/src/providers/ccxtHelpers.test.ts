import { describe, it, expect } from 'vitest';
import { fundingIntervalHours, readFunding, readOpenInterest, timeframeSeconds, tickerPrice } from './ccxt/helpers';
import type { Exchange } from 'ccxt';

describe('timeframeSeconds', () => {
  it('parses ccxt timeframe strings to seconds (m is minute, M is month)', () => {
    expect(timeframeSeconds('1m')).toBe(60);
    expect(timeframeSeconds('5m')).toBe(300);
    expect(timeframeSeconds('1h')).toBe(3600);
    expect(timeframeSeconds('4h')).toBe(14400);
    expect(timeframeSeconds('1d')).toBe(86400);
    expect(timeframeSeconds('1w')).toBe(604800);
    expect(timeframeSeconds('1M')).toBe(2592000);
  });
  it('returns 0 for unparseable input (callers fall back)', () => {
    expect(timeframeSeconds('')).toBe(0);
    expect(timeframeSeconds('nope')).toBe(0);
    expect(timeframeSeconds('m1')).toBe(0);
  });
});

describe('tickerPrice', () => {
  it('prefers last, then close', () => {
    expect(tickerPrice({ last: 100, close: 99 })).toBe(100);
    expect(tickerPrice({ last: null, close: 99 })).toBe(99);
  });
  it('falls back to the bid/ask mid when last and close are missing', () => {
    expect(tickerPrice({ last: null, close: null, bid: 10, ask: 12 })).toBe(11);
    expect(tickerPrice({ bid: 10, ask: 12 })).toBe(11);
  });
  it('returns null (never 0) when no usable price exists', () => {
    expect(tickerPrice({})).toBeNull();
    expect(tickerPrice({ last: null, close: null, bid: null, ask: null })).toBeNull();
  });
  it('treats non-positive last/close as absent and uses the mid', () => {
    expect(tickerPrice({ last: 0, close: 0, bid: 10, ask: 12 })).toBe(11);
    expect(tickerPrice({ last: -5 })).toBeNull(); // negative, no bid/ask
  });
});

describe('fundingIntervalHours', () => {
  it('parses cadence strings in any supported unit', () => {
    expect(fundingIntervalHours('1h')).toBe(1);
    expect(fundingIntervalHours('4h')).toBe(4);
    expect(fundingIntervalHours('8h')).toBe(8);
    expect(fundingIntervalHours('30m')).toBe(0.5);
    expect(fundingIntervalHours('1d')).toBe(24);
  });
  it('normalizes millisecond numbers (some venues report ms)', () => {
    expect(fundingIntervalHours(3_600_000)).toBe(1);
    expect(fundingIntervalHours(28_800_000)).toBe(8);
  });
  it('returns null — never an assumed 8h — for missing or unrecognized input', () => {
    expect(fundingIntervalHours(null)).toBeNull();
    expect(fundingIntervalHours(undefined)).toBeNull();
    expect(fundingIntervalHours('nope')).toBeNull();
    expect(fundingIntervalHours('')).toBeNull();
    expect(fundingIntervalHours(0)).toBeNull();
    expect(fundingIntervalHours(-1)).toBeNull();
  });
});

describe('readFunding', () => {
  const fakeExchange = (funding: Record<string, unknown>): Exchange =>
    ({
      has: { fetchFundingRate: true },
      fetchFundingRate: async () => funding,
    }) as unknown as Exchange;

  it('reads the funding interval from the unified `interval` field', async () => {
    const f = await readFunding(
      fakeExchange({ fundingRate: 0.0001, interval: '1h', markPrice: 100, fundingTimestamp: 1_000 }),
      'BTC/USDT:USDT',
    );
    expect(f.fundingRate).toBe(0.0001);
    expect(f.fundingIntervalHours).toBe(1);
    expect(f.nextFundingTime).toBe(1_000);
    expect(f.state).toBe('ok');
  });

  it('falls back to a millisecond `fundingInterval` when `interval` is absent', async () => {
    const f = await readFunding(
      fakeExchange({ fundingRate: 0.0002, fundingInterval: 14_400_000 }), // 4h in ms
      'ETH/USDT:USDT',
    );
    expect(f.fundingIntervalHours).toBe(4);
  });

  it('leaves the interval null when the venue does not report one', async () => {
    const f = await readFunding(fakeExchange({ fundingRate: 0.0001 }), 'BTC/USDT:USDT');
    expect(f.fundingRate).toBe(0.0001);
    expect(f.fundingIntervalHours).toBeNull(); // honest — not fabricated as 8
  });

  it('distinguishes unsupported from upstream failure and never fabricates numerics', async () => {
    const f = await readFunding({ has: {} } as unknown as Exchange, 'BTC/USDT:USDT');
    expect(f).toEqual({
      state: 'unsupported',
      sourceAsOf: null,
      fundingRate: null,
      fundingIntervalHours: null,
      nextFundingTime: null,
      markPrice: null,
      indexPrice: null,
    });
    const failed = await readFunding({
      has: { fetchFundingRate: true },
      fetchFundingRate: async () => { throw new Error('network'); },
    } as unknown as Exchange, 'BTC/USDT:USDT');
    expect(failed.state).toBe('error');
    expect(failed.fundingRate).toBeNull();
  });

  it('maps malformed funding/mark/index values to null, preserving a real zero funding rate', async () => {
    const f = await readFunding(fakeExchange({
      fundingRate: 0,
      markPrice: 0,
      indexPrice: Number.NaN,
      timestamp: 1_700_000_000_000,
    }), 'BTC/USDT:USDT');
    expect(f).toMatchObject({
      state: 'ok',
      sourceAsOf: 1_700_000_000_000,
      fundingRate: 0,
      markPrice: null,
      indexPrice: null,
    });
  });
});

describe('readOpenInterest', () => {
  it('keeps missing/malformed OI null rather than zero and carries source time', async () => {
    const ex = {
      has: { fetchOpenInterest: true },
      fetchOpenInterest: async () => ({
        timestamp: 1_700_000_000_000,
        openInterestAmount: undefined,
        openInterestValue: Number.NaN,
      }),
    } as unknown as Exchange;
    await expect(readOpenInterest(ex, 'BTC/USDT:USDT')).resolves.toMatchObject({
      state: 'ok',
      sourceAsOf: 1_700_000_000_000,
      openInterest: null,
      openInterestValue: null,
    });
  });
});
