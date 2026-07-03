import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { createProvider } from './providers';

let app: FastifyInstance;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'silent'; // keep test output clean
  app = await buildApp(createProvider('mock'));
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const sym = (s: string) => encodeURIComponent(s);

describe('GET /api/health', () => {
  it('reports the active provider and a version', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.provider).toBe('mock');
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
  });
});

describe('GET /api/quote/:symbol', () => {
  it('returns a quote with a numeric price', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/quote/${sym('BTC/USDT')}` });
    expect(res.statusCode).toBe(200);
    const q = res.json();
    expect(q.symbol).toBe('BTC/USDT');
    expect(typeof q.price).toBe('number');
  });
});

describe('GET /api/quotes', () => {
  it('returns one quote per requested symbol', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/quotes?symbols=${sym('BTC/USDT,ETH/USDT')}` });
    expect(res.statusCode).toBe(200);
    const arr = res.json();
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toHaveLength(2);
  });
});

describe('GET /api/history/:symbol', () => {
  it('returns OHLCV candles', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/history/${sym('BTC/USDT')}?interval=1d&range=1mo`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.candles)).toBe(true);
    expect(body.candles.length).toBeGreaterThan(0);
    for (const k of ['time', 'open', 'high', 'low', 'close', 'volume']) {
      expect(typeof body.candles[0][k]).toBe('number');
    }
  });
});

describe('GET /api/derivatives/:symbol', () => {
  it('includes a fundingRate field', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/derivatives/${sym('BTC/USDT')}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('fundingRate');
  });
});

describe('GET /api/funding-history/:symbol', () => {
  it('returns a chronological series of funding settlements', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/funding-history/${sym('BTC/USDT')}?limit=10` });
    expect(res.statusCode).toBe(200);
    const points = res.json() as Array<{ time: number; fundingRate: number | null }>;
    expect(Array.isArray(points)).toBe(true);
    expect(points).toHaveLength(10);
    expect(points[0]).toHaveProperty('fundingRate');
    expect(points[points.length - 1].time).toBeGreaterThan(points[0].time); // ascending
  });
});

describe('GET /api/funding', () => {
  it('returns a board of funding rows with the limit honoured', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/funding?quote=USDT&limit=5' });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(5);
    expect(rows[0]).toHaveProperty('symbol');
    expect(rows[0]).toHaveProperty('fundingRate');
    expect(rows[0]).toHaveProperty('openInterestValue');
  });
});

describe('GET /api/liquidations', () => {
  it('returns a merged, newest-first feed with notional values and provenance meta', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/liquidations?quote=USDT&limit=5' });
    expect(res.statusCode).toBe(200);
    const feed = res.json();
    const events = feed.events;
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toHaveProperty('symbol');
    expect(events[0]).toHaveProperty('value');
    expect(['buy', 'sell']).toContain(events[0].side);
    // newest-first
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1].timestamp).toBeGreaterThanOrEqual(events[i].timestamp);
    }
    // honest provenance metadata
    expect(typeof feed.meta.source).toBe('string');
    expect(typeof feed.meta.available).toBe('boolean');
    expect(typeof feed.meta.asOf).toBe('number');
  });
});

describe('GET /api/venue-derivatives/:symbol', () => {
  it('returns per-venue funding & open interest across the compare set', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/venue-derivatives/BTC%2FUSDT' });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(1); // several venues
    expect(rows[0]).toHaveProperty('exchange');
    expect(rows[0]).toHaveProperty('fundingRate');
    expect(rows[0]).toHaveProperty('openInterestValue');
    // funding diverges across venues (a non-zero cross-venue spread)
    const fundings = rows.map((r: { fundingRate: number | null }) => r.fundingRate).filter((f: number | null): f is number => f != null);
    expect(Math.max(...fundings)).not.toBe(Math.min(...fundings));
  });
});

describe('GET /api/onchain/:symbol', () => {
  it('returns synthetic DEX pools with honest provenance from the mock provider', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/onchain/ETH%2FUSDT' });
    expect(res.statusCode).toBe(200);
    const feed = res.json();
    expect(feed.symbol).toBe('ETH');
    expect(feed.provenance).toBe('synthetic'); // mock is never passed off as live
    expect(typeof feed.note).toBe('string');
    expect(Array.isArray(feed.pools)).toBe(true);
    expect(feed.pools.length).toBeGreaterThan(1);
    expect(feed.pools[0]).toHaveProperty('dex');
    expect(feed.pools[0]).toHaveProperty('liquidityUsd');
  });

  it('is deterministic for a given symbol within the day', async () => {
    const a = await app.inject({ method: 'GET', url: '/api/onchain/SOL%2FUSDT' });
    const b = await app.inject({ method: 'GET', url: '/api/onchain/SOL%2FUSDT' });
    expect(a.json()).toEqual(b.json());
  });
});

describe('GET /api/solana/network', () => {
  it('returns synthetic Solana network health with honest provenance from mock', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/solana/network' });
    expect(res.statusCode).toBe(200);
    const n = res.json();
    expect(n.provenance).toBe('synthetic'); // never passed off as a live RPC read
    expect(typeof n.note).toBe('string');
    expect(typeof n.slot).toBe('number');
    expect(typeof n.tps).toBe('number');
    expect(n.epochProgressPct).toBeGreaterThanOrEqual(0);
    expect(n.epochProgressPct).toBeLessThanOrEqual(100);
    expect(typeof n.solPriceUsd).toBe('number');
  });
});

describe('GET /api/solana/wallet/:address', () => {
  const ADDR = 'So11111111111111111111111111111111111111112';

  it('returns synthetic wallet holdings for a well-formed base-58 address', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/solana/wallet/${ADDR}` });
    expect(res.statusCode).toBe(200);
    const w = res.json();
    expect(w.provenance).toBe('synthetic');
    expect(w.address).toBe(ADDR); // case preserved — never uppercased
    expect(typeof w.solBalance).toBe('number');
    expect(Array.isArray(w.tokens)).toBe(true);
    expect(w.tokens.length).toBeGreaterThan(0);
  });

  it('rejects a junk address with 400 (base-58 edge validation)', async () => {
    // Too short and contains characters outside the base-58 alphabet.
    const res = await app.inject({ method: 'GET', url: '/api/solana/wallet/not-base58' });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/invalid Solana address/i);
  });

  it('is deterministic per address (holdings seeded on the address)', async () => {
    const a = await app.inject({ method: 'GET', url: `/api/solana/wallet/${ADDR}` });
    const b = await app.inject({ method: 'GET', url: `/api/solana/wallet/${ADDR}` });
    // Holdings/amounts are address-seeded and stable; only the timestamp moves.
    expect(a.json().tokens).toEqual(b.json().tokens);
    expect(a.json().solBalance).toBe(b.json().solBalance);
  });
});

describe('GET /api/solana/trending', () => {
  it('returns synthetic trending Solana tokens, sorted by volume', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/solana/trending' });
    expect(res.statusCode).toBe(200);
    const t = res.json();
    expect(t.provenance).toBe('synthetic');
    expect(Array.isArray(t.tokens)).toBe(true);
    expect(t.tokens.length).toBeGreaterThan(3);
    // sorted by 24h volume, descending
    for (let i = 1; i < t.tokens.length; i++) {
      expect(t.tokens[i].volume24hUsd).toBeLessThanOrEqual(t.tokens[i - 1].volume24hUsd);
    }
    expect(t.tokens[0]).toHaveProperty('symbol');
    expect(t.tokens[0]).toHaveProperty('dex');
  });
});

describe('GET /api/solana/pools/:symbol', () => {
  it('returns synthetic Solana DEX pools with honest provenance', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/solana/pools/SOL%2FUSDT' });
    expect(res.statusCode).toBe(200);
    const feed = res.json();
    expect(feed.symbol).toBe('SOL');
    expect(feed.provenance).toBe('synthetic');
    expect(feed.pools.length).toBeGreaterThan(1);
    // Solana-native venues
    expect(feed.pools.map((p: { dex: string }) => p.dex)).toContain('Raydium');
  });

  it('rejects a junk symbol with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/solana/pools/BTC%20USDT' });
    expect(res.statusCode).toBe(400);
  });
});

describe('unknown route', () => {
  it('returns the 404 ApiError shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe('NotFound');
    expect(body.statusCode).toBe(404);
  });
});
