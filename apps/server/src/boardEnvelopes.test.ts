import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { BoardEnvelope } from '@midas/shared';
import { buildApp } from './app';
import { MockProvider } from './providers/mock';
import { ProviderError } from './providers';
import type { ScreenerOptions } from './providers/types';

/**
 * Route-level coverage for the fan-out board envelopes (/api/funding,
 * /api/funding-dispersion, /api/venue-arb, /api/oi-concentration) and the
 * caching/validation on the sibling boards (/api/liquidations, /api/screener).
 * Everything runs against the deterministic mock provider or subclasses of it —
 * never a real exchange.
 */

/** A mock provider that counts its screen() calls so cache hits are observable. */
class CountingProvider extends MockProvider {
  screenCalls = 0;
  override screen(opts: ScreenerOptions) {
    this.screenCalls += 1;
    return super.screen(opts);
  }
}

async function appWith(provider: MockProvider): Promise<FastifyInstance> {
  process.env.LOG_LEVEL = 'silent';
  const app = await buildApp(provider);
  await app.ready();
  return app;
}

describe('fan-out board envelopes', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await appWith(new MockProvider());
  });
  afterAll(async () => {
    await app.close();
  });

  const boards = ['/api/funding', '/api/funding-dispersion', '/api/venue-arb', '/api/oi-concentration'];

  for (const path of boards) {
    it(`${path} returns a BoardEnvelope honestly labeled synthetic`, async () => {
      const res = await app.inject({ method: 'GET', url: `${path}?quote=USDT&limit=5` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as BoardEnvelope<Record<string, unknown>>;
      expect(Array.isArray(body.rows)).toBe(true);
      expect(body.rows.length).toBeGreaterThan(0);
      expect(body.meta.provenance).toBe('synthetic'); // mock is never passed off as live
      expect(body.meta.source).toBe('mock');
      expect(typeof body.meta.asOf).toBe('number');
      expect(body.meta.partial).toBe(false);
      expect(typeof body.meta.note).toBe('string'); // synthetic provenance always stated
    });
  }

  it('a fresh serve reports cachedAt null; a cached serve reports the compute time', async () => {
    const first = (await app.inject({ method: 'GET', url: '/api/venue-arb?quote=USDT&limit=4' })).json() as BoardEnvelope<unknown>;
    expect(first.meta.cachedAt).toBeNull();
    const second = (await app.inject({ method: 'GET', url: '/api/venue-arb?quote=USDT&limit=4' })).json() as BoardEnvelope<unknown>;
    expect(second.meta.cachedAt).toBe(first.meta.asOf); // stamped with the original compute time
    expect(second.rows).toEqual(first.rows);
  });
});

describe('partial boards surface dropped symbols', () => {
  it('/api/funding flags partial when a symbol fails and its row is dropped', async () => {
    const victim = (await new MockProvider().screen({ quote: 'USDT', sort: 'volume', limit: 5 }))[0]!.symbol;
    class FailingProvider extends MockProvider {
      override async getDerivatives(symbol: string) {
        if (symbol === victim) throw new ProviderError('injected test failure', 502);
        return super.getDerivatives(symbol);
      }
    }
    const app = await appWith(new FailingProvider());
    try {
      const res = await app.inject({ method: 'GET', url: '/api/funding?quote=USDT&limit=5' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as BoardEnvelope<{ symbol: string }>;
      expect(body.meta.partial).toBe(true);
      expect(body.meta.note).toMatch(/1 of 5 symbols unavailable/);
      expect(body.rows.some((r) => r.symbol === victim)).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('/api/funding-dispersion flags partial when a venue read fails', async () => {
    const victim = (await new MockProvider().screen({ quote: 'USDT', sort: 'volume', limit: 5 }))[0]!.symbol;
    class FailingProvider extends MockProvider {
      override async getVenueDerivatives(symbol: string) {
        if (symbol === victim) throw new ProviderError('injected test failure', 502);
        return super.getVenueDerivatives(symbol);
      }
    }
    const app = await appWith(new FailingProvider());
    try {
      const res = await app.inject({ method: 'GET', url: '/api/funding-dispersion?quote=USDT&limit=5' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as BoardEnvelope<{ symbol: string }>;
      expect(body.meta.partial).toBe(true);
      expect(body.meta.note).toMatch(/1 of 5 symbols unavailable/);
      expect(body.rows.some((r) => r.symbol === victim)).toBe(false);
    } finally {
      await app.close();
    }
  });
});

describe('fan-out boards share one upstream sweep per TTL window', () => {
  it('/api/funding serves the second identical call from cache', async () => {
    const provider = new CountingProvider();
    const app = await appWith(provider);
    try {
      await app.inject({ method: 'GET', url: '/api/funding?quote=USDT&limit=5' });
      await app.inject({ method: 'GET', url: '/api/funding?quote=USDT&limit=5' });
      expect(provider.screenCalls).toBe(1);
      // A different (quote, limit) is a different cache key → a new sweep.
      await app.inject({ method: 'GET', url: '/api/funding?quote=USDT&limit=6' });
      expect(provider.screenCalls).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('/api/liquidations serves the second call from cache', async () => {
    const provider = new CountingProvider();
    const app = await appWith(provider);
    try {
      await app.inject({ method: 'GET', url: '/api/liquidations?quote=USDT&limit=5' });
      await app.inject({ method: 'GET', url: '/api/liquidations?quote=USDT&limit=5' });
      expect(provider.screenCalls).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('/api/screener serves the second identical call from cache', async () => {
    const provider = new CountingProvider();
    const app = await appWith(provider);
    try {
      await app.inject({ method: 'GET', url: '/api/screener?quote=USDT&sort=volume&limit=10' });
      await app.inject({ method: 'GET', url: '/api/screener?quote=USDT&sort=volume&limit=10' });
      expect(provider.screenCalls).toBe(1);
      await app.inject({ method: 'GET', url: '/api/screener?quote=USDT&sort=price&limit=10' });
      expect(provider.screenCalls).toBe(2); // sort is part of the cache key
    } finally {
      await app.close();
    }
  });
});

describe('/api/screener edge validation', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await appWith(new MockProvider());
  });
  afterAll(async () => {
    await app.close();
  });

  it('rejects an unknown sort with 400 instead of silently sorting by volume', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/screener?sort=bogus' });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/invalid screener sort/i);
  });

  it('accepts every allowed sort', async () => {
    for (const sort of ['volume', 'change', 'price']) {
      const res = await app.inject({ method: 'GET', url: `/api/screener?sort=${sort}&limit=3` });
      expect(res.statusCode, sort).toBe(200);
    }
  });

  it('clamps a fractional limit to at least 1 row instead of an empty board', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/screener?limit=0.5' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('routes the quote through normalizeQuote (junk falls back to USDT)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/screener?quote=US%2FDT&limit=3' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ symbol: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.symbol.endsWith('/USDT'))).toBe(true);
  });
});
