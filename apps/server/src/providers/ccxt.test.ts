import { describe, it, expect, vi } from 'vitest';
import * as ccxt from 'ccxt';
import { validateDataReceipt } from '@midas/shared';
import type { Exchange } from 'ccxt';
import { CcxtProvider, compareExchangeIds, safeErrorLabel, toPerpSymbol } from './ccxt';
import { ProviderError } from './types';
import { EXECUTION_SAFETY_HOLD_REASON } from '../trading';

// safeErrorLabel is the single sanitizer every ccxt read-error path routes
// through — the thrown ProviderError message on market reads and the `note`
// field of balances/openOrders/positions/fills 'unavailable' snapshots. A ccxt
// error can carry the signed request URL (HMAC signature, API key) and the raw
// response body; none of that may reach a client, so this must never surface the
// raw message.
describe('safeErrorLabel', () => {
  it('returns the error class name, never the raw message', () => {
    // A realistic ccxt error: the message embeds the signed request URL.
    const leak = new Error(
      'GET https://api.binance.com/api/v3/account?timestamp=1&signature=deadbeefcafe 401 Unauthorized {"code":-2015,"msg":"Invalid API-key"}',
    );
    leak.name = 'AuthenticationError';
    const label = safeErrorLabel(leak);
    expect(label).toBe('AuthenticationError');
    expect(label).not.toContain('signature=');
    expect(label).not.toContain('api.binance.com');
    expect(label).not.toContain('Invalid API-key');
  });

  it('preserves an explicit ProviderError message (ours, already safe)', () => {
    expect(safeErrorLabel(new ProviderError('Unsupported symbol', 400))).toBe('Unsupported symbol');
  });

  it('carries an explicit fixed data-health category independent of HTTP status', () => {
    const malformed = new ProviderError('Malformed upstream payload', 502, 'BTC/USDT', 'malformed-upstream');
    expect(malformed.dataHealthCategory).toBe('malformed-upstream');
    expect(new ProviderError('Transport failed', 502).dataHealthCategory).toBe('upstream-unavailable');
  });

  it('falls back to a generic label for a nameless or non-Error value', () => {
    const anon = new Error('secret detail');
    anon.name = '';
    expect(safeErrorLabel(anon)).toBe('error');
    expect(safeErrorLabel('signature=deadbeef')).toBe('error');
    expect(safeErrorLabel(null)).toBe('error');
  });

  it('rejects a hostile mutable Error.name instead of treating it as safe taxonomy', () => {
    const hostile = new Error('ordinary message');
    hostile.name = 'user@example.com raw auth failure';
    expect(safeErrorLabel(hostile)).toBe('error');
  });
});

// The single perp-symbol derivation shared by every derivatives read (funding,
// open interest, funding history) — extracted so the three call sites can't drift.
describe('toPerpSymbol', () => {
  it('derives the settle-margined perp from a spot pair', () => {
    expect(toPerpSymbol('BTC/USDT')).toBe('BTC/USDT:USDT');
    expect(toPerpSymbol('ETH/USDC')).toBe('ETH/USDC:USDC');
  });

  it('passes an already-perp symbol through unchanged', () => {
    expect(toPerpSymbol('BTC/USDT:USDT')).toBe('BTC/USDT:USDT');
  });

  it('falls back to a USDT settle when the pair has no quote', () => {
    expect(toPerpSymbol('BTC')).toBe('BTC:USDT');
  });
});

describe('compareExchangeIds', () => {
  it('normalizes and deduplicates configured venues before constructing clients', () => {
    expect(compareExchangeIds(' binance, Binance,OKX,okx,,kraken ')).toEqual([
      'binance',
      'okx',
      'kraken',
    ]);
  });
});

/**
 * Construct a provider with a stubbed exchange client. The ccxt constructor
 * itself does no network I/O (loadMarkets is lazy), and the private field is
 * swapped for a deterministic fake — no real exchange is ever contacted.
 */
const makeProvider = (exchange: Record<string, unknown>): CcxtProvider => {
  const p = new CcxtProvider({ exchange: 'binance', apiKey: 'test-key', secret: 'test-secret' });
  (p as unknown as { exchange: unknown }).exchange = exchange;
  return p;
};

describe('CcxtProvider.getHistory interval honesty', () => {
  // Aligned to a whole 2m bucket (1700000040 % 120 === 0) so aggregation
  // boundaries are deterministic.
  const baseMs = 1_700_000_040_000;

  it('aggregates substituted 1m bars into honestly-labeled 2m bars', async () => {
    const p = makeProvider({
      id: 'binance',
      name: 'Binance',
      timeframes: { '1m': 1 },
      fetchOHLCV: async () => [
        [baseMs, 100, 110, 90, 105, 10],
        [baseMs + 60_000, 105, 115, 95, 110, 20],
        [baseMs + 120_000, 110, 120, 100, 115, 30],
        [baseMs + 180_000, 115, 125, 105, 120, 40],
      ],
    });
    const res = await p.getHistory('BTC/USDT', { interval: '2m', range: '1d' });
    expect(res.interval).toBe('2m');
    expect(res.candles).toEqual([
      // open=first, high=max, low=min, close=last, volume=sum, time=bucket start
      { time: baseMs / 1000, open: 100, high: 115, low: 90, close: 110, volume: 30 },
      { time: baseMs / 1000 + 120, open: 110, high: 125, low: 100, close: 120, volume: 70 },
    ]);
  });

  it('labels the response with the actual timeframe when the request is not a clean multiple', async () => {
    // 90m is served from 1h bars (TIMEFRAME_MAP 90m→1h); 5400 % 3600 ≠ 0, so
    // the bars cannot be aggregated — the response must say 60m, not 90m.
    const p = makeProvider({
      id: 'binance',
      name: 'Binance',
      timeframes: { '1h': 1 },
      fetchOHLCV: async () => [
        [baseMs, 100, 110, 90, 105, 10],
        [baseMs + 3_600_000, 105, 115, 95, 110, 20],
      ],
    });
    const res = await p.getHistory('BTC/USDT', { interval: '90m', range: '1d' });
    expect(res.interval).toBe('60m');
    expect(res.candles).toHaveLength(2); // the raw 1h bars, honestly labeled
  });

  it('passes bars through unchanged when the fetched timeframe matches the interval', async () => {
    const p = makeProvider({
      id: 'binance',
      name: 'Binance',
      timeframes: { '5m': 1 },
      fetchOHLCV: async () => [[baseMs, 100, 110, 90, 105, 10]],
    });
    const res = await p.getHistory('BTC/USDT', { interval: '5m', range: '1d' });
    expect(res.interval).toBe('5m');
    expect(res.candles).toEqual([{ time: baseMs / 1000, open: 100, high: 110, low: 90, close: 105, volume: 10 }]);
  });

  it('omits a row with missing volume instead of zero-filling it', async () => {
    const p = makeProvider({
      id: 'binance', name: 'Binance', timeframes: { '5m': 1 },
      fetchOHLCV: async () => [
        [baseMs, 100, 110, 90, 105, undefined],
        [baseMs + 300_000, 105, 115, 95, 110, 0],
      ],
    });
    const res = await p.getHistory('BTC/USDT', { interval: '5m', range: '1d' });
    expect(res.candles).toEqual([
      { time: baseMs / 1000 + 300, open: 105, high: 115, low: 95, close: 110, volume: 0 },
    ]);
    expect(res.receipt?.limitations.join(' ')).toMatch(/1 malformed upstream OHLCV rows/i);
    expect(validateDataReceipt(res.receipt).ok).toBe(true);
  });

  it('distinguishes empty OHLCV from an all-malformed upstream response', async () => {
    const empty = makeProvider({
      id: 'binance', name: 'Binance', timeframes: { '5m': 1 }, fetchOHLCV: async () => [],
    });
    await expect(empty.getHistory('BTC/USDT', { interval: '5m', range: '1d' })).rejects.toMatchObject({
      name: 'ProviderError', dataHealthCategory: 'upstream-unavailable',
    });

    const malformed = makeProvider({
      id: 'binance', name: 'Binance', timeframes: { '5m': 1 },
      fetchOHLCV: async () => [[baseMs, 100, 110, 90, 105, undefined]],
    });
    await expect(malformed.getHistory('BTC/USDT', { interval: '5m', range: '1d' })).rejects.toMatchObject({
      name: 'ProviderError', dataHealthCategory: 'malformed-upstream',
    });
  });

  it('uses the served candle cadence for deterministic stale evaluation', async () => {
    const now = Date.parse('2026-08-01T12:00:00.000Z');
    const exchange = {
      id: 'binance', name: 'Binance', has: { fetchOHLCV: true }, timeframes: { '5m': 1 },
      fetchOHLCV: async () => [[now - 600_001, 100, 110, 90, 105, 0]],
    } as unknown as Exchange;
    const provider = new CcxtProvider(undefined, { exchange, compareExchanges: [], now: () => now });
    const history = await provider.getHistory('BTC/USDT', { interval: '5m', range: '1d' });
    expect(history.receipt?.expectedCadenceMs).toBe(300_000);
    expect(history.receipt?.maxAgeMs).toBe(600_000);
    expect(history.receipt?.freshness.state).toBe('stale');
  });
});

describe('CcxtProvider.getQuote zero-price honesty', () => {
  it('throws instead of fabricating $0.00 when the ticker carries no price', async () => {
    const p = makeProvider({
      id: 'binance',
      name: 'Binance',
      fetchTicker: async () => ({ symbol: 'BTC/USDT' }), // no last/close/bid/ask
    });
    await expect(p.getQuote('BTC/USDT')).rejects.toMatchObject({
      name: 'ProviderError',
      statusCode: 502,
      message: expect.stringContaining('ticker has no price'),
    });
  });

  it('still quotes a normal ticker', async () => {
    const p = makeProvider({
      id: 'binance',
      name: 'Binance',
      fetchTicker: async () => ({
        symbol: 'BTC/USDT', last: 65000, previousClose: 64000, percentage: 1.5,
        timestamp: 1_700_000_000_000,
      }),
    });
    const q = await p.getQuote('BTC/USDT');
    expect(q.price).toBe(65000);
    expect(validateDataReceipt(q.receipt).ok).toBe(true);
  });

  it('rejects a required previous-close field instead of deriving a zero change from price', async () => {
    const p = makeProvider({
      id: 'binance', name: 'Binance',
      fetchTicker: async () => ({ symbol: 'BTC/USDT', last: 65000, percentage: 1.5 }),
    });
    await expect(p.getQuote('BTC/USDT')).rejects.toMatchObject({
      name: 'ProviderError', message: expect.stringContaining('previous-close evidence'),
    });
  });

  it('keeps absent or malformed ticker volume null rather than zero', async () => {
    const p = makeProvider({
      id: 'binance', name: 'Binance',
      fetchTicker: async () => ({
        symbol: 'BTC/USDT', last: 65000, previousClose: 64000,
        percentage: 1.5, baseVolume: Number.NaN,
      }),
    });
    const q = await p.getQuote('BTC/USDT');
    expect(q.volume).toBeNull();
    expect(q.asOf).toBeNull();
    expect(q.receipt?.sourceAsOf).toBeNull();
    expect(q.receipt?.freshness.state).toBe('unknown');
  });
});

describe('CcxtProvider venue evidence honesty', () => {
  const providerWithVenue = (ticker: Record<string, unknown>): CcxtProvider => {
    const primary = { id: 'binance', name: 'Binance', has: {} } as unknown as Exchange;
    const venue = {
      id: 'kraken', name: 'Kraken', has: {}, fetchTicker: async () => ticker,
    } as unknown as Exchange;
    return new CcxtProvider(undefined, {
      exchange: primary, compareExchanges: [venue], now: () => 1_700_000_500_000,
    });
  };

  it('maps positive executable bid/ask sizes and real source timestamps', async () => {
    const p = providerWithVenue({
      last: 100, previousClose: 99, percentage: 1, bid: 101, ask: 99,
      bidVolume: 2.5, askVolume: 3.5, baseVolume: 1000, timestamp: 1_700_000_000_000,
    });
    const [quote] = await p.getExchangeQuotes('BTC/USDT');
    expect(quote).toMatchObject({
      bidSize: 2.5, askSize: 3.5, volume: 1000, timestamp: 1_700_000_000_000,
    });
    expect(quote.receipt?.sourceAsOf).toBe('2023-11-14T22:13:20.000Z');
    expect(validateDataReceipt(quote.receipt).ok).toBe(true);
  });

  it('keeps missing time/volume/size null, preventing an actionable net quote', async () => {
    const p = providerWithVenue({
      last: 100, previousClose: 99, percentage: 1, bid: 101, ask: 99,
      bidVolume: 0, askVolume: Number.NaN,
    });
    const [quote] = await p.getExchangeQuotes('BTC/USDT');
    expect(quote).toMatchObject({ bidSize: null, askSize: null, volume: null, timestamp: null });
    expect(quote.receipt?.sourceAsOf).toBeNull();
    expect(quote.receipt?.limitations.join(' ')).toMatch(/timestamp/i);
    expect(quote.receipt?.limitations.join(' ')).toMatch(/size/i);
  });

  it('stamps every surviving venue quote with sanitized fan-out completeness counts', async () => {
    const primary = { id: 'binance', name: 'Binance', has: {} } as unknown as Exchange;
    const good = {
      id: 'kraken', name: 'Kraken', has: { fetchTicker: true },
      fetchTicker: async () => ({
        last: 100, previousClose: 99, percentage: 1, bid: 99, ask: 101,
        bidVolume: 2, askVolume: 3, timestamp: 1_700_000_000_000,
      }),
    } as unknown as Exchange;
    const failed = {
      id: 'okx', name: 'OKX', has: { fetchTicker: true },
      fetchTicker: async () => { throw new Error('signature=secret-value'); },
    } as unknown as Exchange;
    const provider = new CcxtProvider(undefined, {
      exchange: primary, compareExchanges: [good, failed], now: () => 1_700_000_500_000,
    });
    const rows = await provider.getExchangeQuotes('BTC/USDT');
    expect(rows).toHaveLength(1);
    expect(rows[0].receipt?.limitations).toContain(
      'Partial evidence: Cross-venue quote fan-out attempted 2 venue(s); 1 returned usable evidence, 1 failed, and 0 returned unsupported or empty evidence.',
    );
    expect(JSON.stringify(rows[0].receipt)).not.toContain('secret-value');
    expect(validateDataReceipt(rows[0].receipt).ok).toBe(true);
  });

  it('stamps every surviving venue derivatives row with sanitized fan-out completeness counts', async () => {
    const primary = { id: 'binance', name: 'Binance', has: {} } as unknown as Exchange;
    const good = {
      id: 'kraken', name: 'Kraken', has: { fetchFundingRate: true },
      fetchFundingRate: async () => ({ fundingRate: 0.0001, timestamp: 1_700_000_000_000 }),
    } as unknown as Exchange;
    const failed = {
      id: 'okx', name: 'OKX', has: { fetchFundingRate: true },
      fetchFundingRate: async () => { throw new Error('apiKey=secret-value'); },
    } as unknown as Exchange;
    const provider = new CcxtProvider(undefined, {
      exchange: primary, compareExchanges: [good, failed], now: () => 1_700_000_500_000,
    });
    const rows = await provider.getVenueDerivatives('BTC/USDT');
    expect(rows).toHaveLength(1);
    expect(rows[0].receipt?.limitations).toContain(
      'Partial evidence: Cross-venue derivatives fan-out attempted 2 venue(s); 1 returned usable evidence, 1 failed, and 0 returned unsupported or empty evidence.',
    );
    expect(JSON.stringify(rows[0].receipt)).not.toContain('secret-value');
    expect(validateDataReceipt(rows[0].receipt).ok).toBe(true);
  });

  it('counts fulfilled spot-only venues as omitted cross-venue derivatives evidence', async () => {
    const primary = { id: 'binance', name: 'Binance', has: {} } as unknown as Exchange;
    const good = {
      id: 'kraken', name: 'Kraken', has: { fetchFundingRate: true },
      fetchFundingRate: async () => ({ fundingRate: 0.0001, timestamp: 1_700_000_000_000 }),
    } as unknown as Exchange;
    const spotOnly = { id: 'coinbase', name: 'Coinbase', has: {} } as unknown as Exchange;
    const provider = new CcxtProvider(undefined, {
      exchange: primary, compareExchanges: [good, spotOnly], now: () => 1_700_000_500_000,
    });
    const rows = await provider.getVenueDerivatives('BTC/USDT');
    expect(rows).toHaveLength(1);
    expect(rows[0].receipt?.limitations).toContain(
      'Partial evidence: Cross-venue derivatives fan-out attempted 2 venue(s); 1 returned usable evidence, 0 failed, and 1 returned unsupported or empty evidence.',
    );
  });
});

describe('CcxtProvider.getDerivatives funding interval', () => {
  it('threads the venue-reported funding interval through (never an assumed 8h)', async () => {
    const p = makeProvider({
      id: 'hyperliquid',
      name: 'Hyperliquid',
      has: { fetchFundingRate: true },
      fetchFundingRate: async () => ({
        fundingRate: 0.0001,
        interval: '1h', // hourly-funding venue
        fundingTimestamp: 1_700_000_000_000,
        markPrice: 64_000,
        indexPrice: 63_900,
      }),
    });
    const d = await p.getDerivatives('BTC/USDT');
    expect(d.fundingRate).toBe(0.0001);
    expect(d.fundingIntervalHours).toBe(1);
  });

  it('leaves the interval null when the venue does not report one', async () => {
    const p = makeProvider({
      id: 'binance',
      name: 'Binance',
      has: { fetchFundingRate: true },
      fetchFundingRate: async () => ({ fundingRate: 0.0002, markPrice: 64_000 }),
    });
    const d = await p.getDerivatives('BTC/USDT');
    expect(d.fundingRate).toBe(0.0002);
    expect(d.fundingIntervalHours).toBeNull();
  });

  it('keeps missing/malformed funding, OI, mark and index evidence null and drops malformed liquidations', async () => {
    const p = makeProvider({
      id: 'binance', name: 'Binance',
      has: { fetchFundingRate: true, fetchOpenInterest: true, fetchLiquidations: true },
      fetchFundingRate: async () => ({
        fundingRate: 0, markPrice: 0, indexPrice: Number.NaN,
        timestamp: 1_700_000_000_000,
      }),
      fetchOpenInterest: async () => ({
        openInterestAmount: undefined, openInterestValue: Number.NaN,
        timestamp: 1_700_000_000_000,
      }),
      fetchLiquidations: async () => [
        { side: 'buy', price: 100, timestamp: 1_700_000_000_000 }, // missing amount
        { side: 'sell', price: 100, amount: 2 }, // missing source time
      ],
    });
    const d = await p.getDerivatives('BTC/USDT');
    expect(d).toMatchObject({
      fundingRate: 0, markPrice: null, indexPrice: null,
      openInterest: null, openInterestValue: null, recentLiquidations: [],
    });
    expect(d.receipt?.limitations.join(' ')).toMatch(/2 malformed liquidation rows/i);
    expect(d.receipt?.limitations.join(' ')).toMatch(/Funding observation attempted 5.*1 returned.*4.*missing or malformed/i);
    expect(d.receipt?.limitations.join(' ')).toMatch(/Open-interest observation attempted 2.*0 returned.*2.*missing or malformed/i);
    expect(validateDataReceipt(d.receipt).ok).toBe(true);
  });

  it('throws when supported derivatives inputs fail instead of returning all-null live success', async () => {
    const p = makeProvider({
      id: 'binance', name: 'Binance',
      has: { fetchFundingRate: true, fetchOpenInterest: true },
      fetchFundingRate: async () => { throw new Error('network'); },
      fetchOpenInterest: async () => { throw new Error('network'); },
    });
    await expect(p.getDerivatives('BTC/USDT')).rejects.toMatchObject({
      name: 'ProviderError', message: expect.stringContaining('derivatives upstream read failed'),
    });
  });
});

describe('CcxtProvider.getFundingHistory completeness', () => {
  it('omits malformed rows, stamps every survivor with counts, and rejects wholly malformed rows', async () => {
    const partialProvider = makeProvider({
      id: 'binance', name: 'Binance', has: { fetchFundingRateHistory: true },
      fetchFundingRateHistory: async () => [
        { timestamp: 1_700_000_000_000, fundingRate: 0, interval: '8h' },
        { timestamp: 1_700_000_100_000, fundingRate: Number.NaN },
      ],
    });
    const rows = await partialProvider.getFundingHistory('BTC/USDT', 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].fundingRate).toBe(0);
    expect(rows[0].fundingIntervalHours).toBe(8);
    expect(rows[0].receipt?.expectedCadenceMs).toBe(28_800_000);
    expect(rows[0].receipt?.maxAgeMs).toBe(57_600_000);
    expect(rows[0].receipt?.limitations.join(' ')).toMatch(/attempted 2.*1 returned.*1.*malformed/i);

    const malformedProvider = makeProvider({
      id: 'binance', name: 'Binance', has: { fetchFundingRateHistory: true },
      fetchFundingRateHistory: async () => [{ timestamp: 1_700_000_000_000, fundingRate: Number.NaN }],
    });
    await expect(malformedProvider.getFundingHistory('BTC/USDT', 10)).rejects.toMatchObject({
      name: 'ProviderError', statusCode: 502, dataHealthCategory: 'malformed-upstream',
      message: expect.stringMatching(/malformed funding-history/i),
    });
  });
});

describe('CcxtProvider execution safety hold (defense in depth)', () => {
  it('placeOrder throws TradingSafetyHold and never touches the exchange', async () => {
    const createOrder = vi.fn();
    const p = makeProvider({ id: 'binance', name: 'Binance', has: { createOrder: true }, createOrder });
    await expect(
      p.placeOrder({ symbol: 'BTC/USDT', side: 'buy', type: 'market', amount: 1 }),
    ).rejects.toMatchObject({
      name: 'TradingSafetyHold',
      statusCode: 503,
      message: EXECUTION_SAFETY_HOLD_REASON,
    });
    expect(createOrder).not.toHaveBeenCalled();
  });
});

describe('CcxtProvider.cancelOrder (cancel-only posture)', () => {
  it('maps an exchange-confirmed cancel to a CancelResult', async () => {
    const cancelOrder = vi.fn(async () => ({ id: 'ord-1', symbol: 'BTC/USDT', status: 'canceled' }));
    const p = makeProvider({ id: 'binance', name: 'Binance', has: { cancelOrder: true }, cancelOrder });
    await expect(p.cancelOrder('ord-1', 'BTC/USDT')).resolves.toEqual({
      id: 'ord-1',
      symbol: 'BTC/USDT',
      status: 'canceled',
    });
    expect(cancelOrder).toHaveBeenCalledWith('ord-1', 'BTC/USDT');
  });

  it('honestly answers 501 when the venue cannot cancel', async () => {
    const p = makeProvider({ id: 'binance', name: 'Binance', has: {} });
    await expect(p.cancelOrder('ord-1', 'BTC/USDT')).rejects.toMatchObject({ statusCode: 501 });
  });

  it('maps an already-filled/canceled order to a 409, without leaking the raw message', async () => {
    const cancelOrder = vi.fn(async () => {
      throw new ccxt.OrderNotFound('binance {"code":-2011,"msg":"Unknown order sent."} signature=deadbeef');
    });
    const p = makeProvider({ id: 'binance', name: 'Binance', has: { cancelOrder: true }, cancelOrder });
    await expect(p.cancelOrder('ord-1', 'BTC/USDT')).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/already filled or canceled/),
    });
    const err = await p.cancelOrder('ord-1', 'BTC/USDT').catch((e: unknown) => e);
    expect((err as Error).message).not.toContain('signature=');
    expect((err as Error).message).not.toContain('-2011');
  });

  it('maps a timeout to a 502 outcome-unknown — never a claimed cancel', async () => {
    const cancelOrder = vi.fn(async () => {
      throw new ccxt.RequestTimeout('binance GET https://api.binance.com/api/v3/order?signature=deadbeef timed out');
    });
    const p = makeProvider({ id: 'binance', name: 'Binance', has: { cancelOrder: true }, cancelOrder });
    const err = await p.cancelOrder('ord-1', 'BTC/USDT').catch((e: unknown) => e);
    expect(err).toMatchObject({
      statusCode: 502,
      dataHealthCategory: 'upstream-unavailable',
      publicErrorCode: 'cancel-outcome-unknown',
    });
    expect((err as Error).message).toMatch(/outcome UNKNOWN/i);
    expect((err as Error).message).toMatch(/Check the exchange/);
    expect((err as Error).message).not.toContain('signature=');
    expect((err as Error).message).not.toContain('canceled"');
  });

  it('maps any other exchange rejection to a 502 with the order still open', async () => {
    const cancelOrder = vi.fn(async () => {
      throw new ccxt.ExchangeError('binance cancel rejected signature=deadbeef');
    });
    const p = makeProvider({ id: 'binance', name: 'Binance', has: { cancelOrder: true }, cancelOrder });
    const err = await p.cancelOrder('ord-1', 'BTC/USDT').catch((e: unknown) => e);
    expect(err).toMatchObject({ statusCode: 502 });
    expect((err as Error).message).toMatch(/still be open/);
    expect((err as Error).message).not.toContain('signature=');
  });
});

describe('CcxtProvider.getBalances unpriced-asset honesty', () => {
  it('counts unpriced assets in the note and keeps the priced floor as the total', async () => {
    // WIF has no /USDT market: the batched fetchTickers rejects wholesale, the
    // per-symbol fallback prices BTC but also fails for WIF — so WIF is held
    // but unpriced, and the note must say the total is a floor.
    const p = makeProvider({
      id: 'binance',
      name: 'Binance',
      fetchBalance: async () => ({
        free: { BTC: 1, USDT: 500, WIF: 100 },
        used: { BTC: 0, USDT: 0, WIF: 0 },
        total: { BTC: 1, USDT: 500, WIF: 100 },
      }),
      fetchTickers: async () => {
        throw new Error('binance does not have market symbol WIF/USDT');
      },
      fetchTicker: async (symbol: string) => {
        if (symbol === 'BTC/USDT') return { symbol, last: 60_000 };
        throw new Error(`binance does not have market symbol ${symbol}`);
      },
    });
    const res = await p.getBalances();
    expect(res.provenance).toBe('live');
    expect(res.totalValueUsd).toBe(60_500); // BTC + USDT only — a floor, WIF excluded
    expect(res.balances.find((b) => b.asset === 'WIF')?.valueUsd).toBeNull();
    expect(res.note).toContain('1 asset could not be priced');
    expect(res.note).toContain('floor');
  });

  it('leaves the note null when every held asset is priced', async () => {
    const p = makeProvider({
      id: 'binance',
      name: 'Binance',
      fetchBalance: async () => ({
        free: { BTC: 1, USDT: 500 },
        used: { BTC: 0, USDT: 0 },
        total: { BTC: 1, USDT: 500 },
      }),
      fetchTickers: async () => ({ 'BTC/USDT': { symbol: 'BTC/USDT', last: 60_000 } }),
    });
    const res = await p.getBalances();
    expect(res.provenance).toBe('live');
    expect(res.totalValueUsd).toBe(60_500);
    expect(res.note).toBeNull();
  });

  it('marks mixed malformed held rows partial and rejects a wholly malformed balance payload', async () => {
    const mixed = makeProvider({
      id: 'binance', name: 'Binance',
      fetchBalance: async () => ({
        free: { BTC: 1, USDT: 500 }, used: { USDT: 0 }, total: { BTC: 1, USDT: 500 },
      }),
      fetchTickers: async () => ({ 'BTC/USDT': { last: 60_000 } }),
    });
    const partial = await mixed.getBalances();
    expect(partial.totalValueUsd).toBe(500);
    expect(partial.note).toMatch(/1 of 2 held balance row.*partial/i);
    expect(partial.receipt?.limitations.join(' ')).toMatch(/1 of 2 held balance row.*partial/i);
    expect(validateDataReceipt(partial.receipt).ok).toBe(true);

    const malformed = makeProvider({
      id: 'binance', name: 'Binance',
      fetchBalance: async () => ({ free: { BTC: 1 }, total: { BTC: 1 } }),
      fetchTickers: async () => ({ 'BTC/USDT': { last: 60_000 } }),
    });
    await expect(malformed.getBalances()).rejects.toMatchObject({
      name: 'ProviderError', statusCode: 502, message: expect.stringMatching(/Malformed balance payload/),
    });
  });
});

describe('CcxtProvider account-row completeness', () => {
  const mixedProvider = () => makeProvider({
    id: 'binance', name: 'Binance',
    has: { fetchOpenOrders: true, fetchPositions: true, fetchMyTrades: true },
    fetchOpenOrders: async () => [
      { id: 'o1', symbol: 'BTC/USDT', side: 'buy', type: 'limit', status: 'open', amount: 1, filled: 0 },
      {},
    ],
    fetchPositions: async () => [
      { symbol: 'BTC/USDT:USDT', side: 'long', contracts: 1 },
      {},
    ],
    fetchMyTrades: async () => [
      { id: 'f1', symbol: 'BTC/USDT', side: 'buy', price: 60_000, amount: 0.1 },
      {},
    ],
  });

  it('carries omission counts into every mixed account payload and receipt', async () => {
    const provider = mixedProvider();
    const [orders, positions, fills] = await Promise.all([
      provider.getOpenOrders(), provider.getPositions(), provider.getFills('BTC/USDT'),
    ]);
    for (const value of [orders, positions, fills]) {
      expect(value.note).toMatch(/1 of 2 .* row.*partial/i);
      expect(value.receipt?.limitations.join(' ')).toMatch(/1 of 2 .* row.*partial/i);
      expect(value.receipt?.derivation).toBe('derived');
      expect(value.receipt?.methodology).not.toBeNull();
      expect(value.receipt?.inputReceiptIds).toHaveLength(1);
      expect(validateDataReceipt(value.receipt).ok).toBe(true);
    }
  });

  it('throws a sanitized 502 when every returned account row is malformed', async () => {
    const provider = makeProvider({
      id: 'binance', name: 'Binance',
      has: { fetchOpenOrders: true, fetchPositions: true, fetchMyTrades: true },
      fetchOpenOrders: async () => [{ raw: 'apiKey=secret-value' }],
      fetchPositions: async () => [{ raw: 'apiKey=secret-value' }],
      fetchMyTrades: async () => [{ raw: 'apiKey=secret-value' }],
    });
    for (const read of [
      () => provider.getOpenOrders(),
      () => provider.getPositions(),
      () => provider.getFills('BTC/USDT'),
    ]) {
      const error = await read().catch((caught: unknown) => caught);
      expect(error).toMatchObject({ name: 'ProviderError', statusCode: 502 });
      expect((error as Error).message).toMatch(/Malformed (open-orders|positions|fills) payload/);
      expect((error as Error).message).not.toContain('secret-value');
    }
  });
});
