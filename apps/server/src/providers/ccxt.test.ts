import { describe, it, expect, vi } from 'vitest';
import { CcxtProvider, safeErrorLabel, toPerpSymbol } from './ccxt';
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

  it('falls back to a generic label for a nameless or non-Error value', () => {
    const anon = new Error('secret detail');
    anon.name = '';
    expect(safeErrorLabel(anon)).toBe('error');
    expect(safeErrorLabel('signature=deadbeef')).toBe('error');
    expect(safeErrorLabel(null)).toBe('error');
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
      fetchTicker: async () => ({ symbol: 'BTC/USDT', last: 65000, percentage: 1.5 }),
    });
    const q = await p.getQuote('BTC/USDT');
    expect(q.price).toBe(65000);
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

  it('cancelOrder throws TradingSafetyHold and never touches the exchange', async () => {
    const cancelOrder = vi.fn();
    const p = makeProvider({ id: 'binance', name: 'Binance', has: { cancelOrder: true }, cancelOrder });
    await expect(p.cancelOrder('ord-1', 'BTC/USDT')).rejects.toMatchObject({
      name: 'TradingSafetyHold',
      statusCode: 503,
      message: EXECUTION_SAFETY_HOLD_REASON,
    });
    expect(cancelOrder).not.toHaveBeenCalled();
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
});
