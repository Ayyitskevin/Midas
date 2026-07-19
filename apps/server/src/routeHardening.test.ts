import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { createProvider } from './providers';
import { firstStr, normalizeSymbol, normalizeSolanaAddress, normalizeQuote } from './routes/shared';

describe('firstStr', () => {
  it('returns strings unchanged and the first element of arrays', () => {
    expect(firstStr('BTC')).toBe('BTC');
    expect(firstStr(['BTC', 'ETH'])).toBe('BTC'); // repeated query param
  });
  it('coerces every non-string to empty (never throws)', () => {
    expect(firstStr(undefined)).toBe('');
    expect(firstStr(123)).toBe('');
    expect(firstStr([])).toBe('');
    expect(firstStr([42])).toBe('');
    expect(firstStr({})).toBe('');
    expect(firstStr(null)).toBe('');
  });
});

describe('normalizeSymbol accepts unknown safely', () => {
  it('normalizes strings and array-valued params', () => {
    expect(normalizeSymbol('btc/usdt')).toBe('BTC/USDT');
    expect(normalizeSymbol(['btc/usdt', 'eth/usdt'])).toBe('BTC/USDT');
  });
  it('returns empty for non-string input instead of throwing', () => {
    expect(normalizeSymbol(123)).toBe('');
    expect(normalizeSymbol(undefined)).toBe('');
    expect(normalizeSymbol({})).toBe('');
  });
  it('does not crash on a non-string Solana address', () => {
    expect(normalizeSolanaAddress(123)).toBe('');
    expect(normalizeSolanaAddress(undefined)).toBe('');
  });
});

describe('normalizeQuote bounds the TTL-cache key', () => {
  it('upper-cases a valid quote and defaults when absent', () => {
    expect(normalizeQuote('usdc')).toBe('USDC');
    expect(normalizeQuote(['usdc', 'usdt'])).toBe('USDC'); // repeated param
    expect(normalizeQuote(undefined)).toBe('USDT');
    expect(normalizeQuote('')).toBe('USDT');
  });
  it('rejects junk that would otherwise become an unbounded cache key', () => {
    expect(normalizeQuote('A'.repeat(16))).toBe('USDT'); // too long
    expect(normalizeQuote('US/DT')).toBe('USDT'); // illegal char
    expect(normalizeQuote(123)).toBe('USDT'); // non-string
    expect(normalizeQuote({})).toBe('USDT');
  });
});

describe('repeated query params no longer 500 the API', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    process.env.LOG_LEVEL = 'silent';
    app = await buildApp(createProvider('mock'));
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  const cases: Array<[string, string]> = [
    ['/api/quotes', '/api/quotes?symbols=BTC%2FUSDT&symbols=ETH%2FUSDT'],
    ['/api/screener', '/api/screener?quote=USDT&quote=BTC'],
    ['/api/funding', '/api/funding?quote=USDT&quote=ETH&limit=3'],
    ['/api/funding-dispersion', '/api/funding-dispersion?quote=USDT&quote=ETH&limit=3'],
    ['/api/venue-arb', '/api/venue-arb?quote=USDT&quote=ETH&limit=3'],
    ['/api/oi-concentration', '/api/oi-concentration?quote=USDT&quote=ETH&limit=3'],
    ['/api/liquidations', '/api/liquidations?quote=USDT&quote=ETH&limit=3'],
    ['/api/search', '/api/search?q=BTC&q=ETH'],
    ['/api/news', '/api/news?symbol=BTC%2FUSDT&symbol=ETH%2FUSDT'],
    ['/api/fills', '/api/fills?symbol=BTC%2FUSDT&symbol=ETH%2FUSDT'],
  ];

  for (const [name, url] of cases) {
    it(`${name} handles a repeated param without a 500`, async () => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, `${url} -> ${res.statusCode} ${res.payload.slice(0, 120)}`).toBeLessThan(500);
    });
  }
});
