import { describe, expect, it } from 'vitest';
import { validateDataReceipt } from '@midas/shared';
import { YahooProvider } from './yahoo';

const NOW = Date.parse('2026-08-01T12:00:00.000Z');

function providerFor(result: Record<string, unknown>): YahooProvider {
  const fetchImpl = (async () => new Response(JSON.stringify({
    chart: { result: [result], error: null },
  }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof globalThis.fetch;
  return new YahooProvider({ fetch: fetchImpl, now: () => NOW });
}

describe('YahooProvider unknown-numeric and source-time honesty', () => {
  it('rejects a quote with no current price instead of substituting previous close', async () => {
    const provider = providerFor({
      meta: { symbol: 'AAPL', previousClose: 190, chartPreviousClose: 190 },
      indicators: { quote: [{ open: [191] }] },
    });
    await expect(provider.getQuote('AAPL')).rejects.toMatchObject({
      name: 'ProviderError',
      message: expect.stringContaining('No usable price'),
    });
  });

  it('keeps missing volume null and labels missing currency/source time explicitly', async () => {
    const provider = providerFor({
      meta: { symbol: 'AAPL', regularMarketPrice: 200, chartPreviousClose: 190 },
      indicators: { quote: [{ open: [195] }] },
    });
    const quote = await provider.getQuote('AAPL');
    expect(quote.volume).toBeNull();
    expect(quote.currency).toBe('UNKNOWN');
    expect(quote.asOf).toBeNull();
    expect(quote.receipt?.sourceAsOf).toBeNull();
    expect(quote.receipt?.freshness).toEqual({ state: 'unknown', ageMs: null });
    expect(quote.receipt?.limitations.join(' ')).toMatch(/timestamp.*unknown/i);
    expect(quote.receipt?.limitations.join(' ')).toMatch(/currency.*unknown/i);
    expect(quote.receipt?.limitations.join(' ')).toMatch(/volume/i);
    expect(validateDataReceipt(quote.receipt).ok).toBe(true);
  });

  it('omits incomplete OHLCV rows, preserves a reported zero-volume bar, and never zero-fills', async () => {
    const provider = providerFor({
      meta: { symbol: 'AAPL' },
      timestamp: [1_700_000_000, 1_700_000_060, 1_700_000_120],
      indicators: {
        quote: [{
          open: [100, 101, 102],
          high: [105, 106, 107],
          low: [95, 96, 97],
          close: [102, 103, 104],
          volume: [10, null, 0],
        }],
      },
    });
    const history = await provider.getHistory('AAPL', { interval: '1m', range: '1d' });
    expect(history.currency).toBe('UNKNOWN');
    expect(history.candles).toEqual([
      { time: 1_700_000_000, open: 100, high: 105, low: 95, close: 102, volume: 10 },
      { time: 1_700_000_120, open: 102, high: 107, low: 97, close: 104, volume: 0 },
    ]);
    expect(history.receipt?.limitations.join(' ')).toContain('1 upstream bars missing OHLCV evidence were omitted.');
    expect(validateDataReceipt(history.receipt).ok).toBe(true);
  });

  it('distinguishes empty history from an all-malformed upstream response', async () => {
    const empty = providerFor({ meta: { symbol: 'AAPL', currency: 'USD' }, timestamp: [] });
    await expect(empty.getHistory('AAPL', { interval: '1m', range: '1d' })).rejects.toMatchObject({
      name: 'ProviderError',
      dataHealthCategory: 'upstream-unavailable',
      message: expect.stringMatching(/no history rows/i),
    });

    const malformed = providerFor({
      meta: { symbol: 'AAPL', currency: 'USD' },
      timestamp: [Math.floor(NOW / 1_000)],
      indicators: { quote: [{ open: [null], high: [null], low: [null], close: [null], volume: [null] }] },
    });
    await expect(malformed.getHistory('AAPL', { interval: '1m', range: '1d' })).rejects.toMatchObject({
      name: 'ProviderError',
      dataHealthCategory: 'malformed-upstream',
      message: expect.stringMatching(/only malformed history rows/i),
    });
  });

  it('applies interval-aware freshness under the injected clock', async () => {
    const sourceTime = NOW - 120_001;
    const provider = providerFor({
      meta: { symbol: 'AAPL', currency: 'USD' },
      timestamp: [Math.floor(sourceTime / 1_000)],
      indicators: { quote: [{ open: [100], high: [101], low: [99], close: [100], volume: [0] }] },
    });
    const history = await provider.getHistory('AAPL', { interval: '1m', range: '1d' });
    expect(history.receipt?.expectedCadenceMs).toBe(60_000);
    expect(history.receipt?.maxAgeMs).toBe(120_000);
    expect(history.receipt?.freshness.state).toBe('stale');
  });
});
