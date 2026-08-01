import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DvolSnapshot, OptionsChain, TermStructure } from '@midas/shared';
import { buildApp } from './app';
import { MockProvider } from './providers/mock';

/**
 * Route-level coverage for the options / DVOL / term-structure endpoints:
 * edge validation (symbol, DVOL underlier, expiry), the synthetic provenance
 * label, the provider-missing 'unavailable' degradation, and the TTL cache
 * collapsing client polling into one provider read. Everything runs against
 * the deterministic mock provider — never a real exchange.
 */

async function appWith(provider: MockProvider): Promise<FastifyInstance> {
  process.env.LOG_LEVEL = 'silent';
  const app = await buildApp(provider);
  await app.ready();
  return app;
}

/** A mock provider that counts its options-surface reads so cache hits are observable. */
class CountingProvider extends MockProvider {
  dvolCalls = 0;
  chainCalls = 0;
  termCalls = 0;
  override async getDvol(symbol: 'BTC' | 'ETH') {
    this.dvolCalls += 1;
    return super.getDvol(symbol);
  }
  override async getOptionsChain(symbol: string, expiry?: number | 'nearest') {
    this.chainCalls += 1;
    return super.getOptionsChain(symbol, expiry);
  }
  override async getFuturesTermStructure(symbol: string) {
    this.termCalls += 1;
    return super.getFuturesTermStructure(symbol);
  }
}

describe('options / DVOL / term-structure routes', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await appWith(new MockProvider());
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /api/options/dvol returns a synthetic-labeled snapshot for BTC and ETH', async () => {
    for (const symbol of ['BTC', 'ETH']) {
      const res = await app.inject({ method: 'GET', url: `/api/options/dvol?symbol=${symbol}` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as DvolSnapshot;
      expect(body.symbol).toBe(symbol);
      expect(body.provenance).toBe('synthetic');
      expect(body.source).toBe('mock');
      expect(typeof body.note).toBe('string'); // synthetic always carries the caveat
      expect(body.value).toBeGreaterThan(0);
      expect(body.history.length).toBeGreaterThan(0);
    }
  });

  it('rejects a missing symbol and a non-DVOL underlier at the edge', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/options/dvol' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/options/dvol?symbol=DOGE' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/options/dvol?symbol=%0A' })).statusCode).toBe(400);
  });

  it('accepts the base of a pair for DVOL (BTC/USDT → BTC)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/options/dvol?symbol=BTC/USDT' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as DvolSnapshot).symbol).toBe('BTC');
  });

  it('GET /api/options/chain defaults to the nearest expiry and validates an explicit one', async () => {
    const nearest = await app.inject({ method: 'GET', url: '/api/options/chain?symbol=BTC' });
    expect(nearest.statusCode).toBe(200);
    const body = nearest.json() as OptionsChain;
    expect(body.provenance).toBe('synthetic');
    expect(typeof body.note).toBe('string');
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.expiry).toBeGreaterThan(Date.now());

    const expiry = Date.now() + 21 * 86_400_000;
    const explicit = await app.inject({ method: 'GET', url: `/api/options/chain?symbol=BTC&expiry=${expiry}` });
    expect(explicit.statusCode).toBe(200);
    expect((explicit.json() as OptionsChain).expiry).toBe(expiry);

    expect((await app.inject({ method: 'GET', url: '/api/options/chain?symbol=BTC&expiry=tomorrow' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/options/chain?symbol=BTC&expiry=-5' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/options/chain' })).statusCode).toBe(400);
  });

  it('GET /api/futures/term-structure returns a synthetic-labeled contango curve', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/futures/term-structure?symbol=BTC/USDT' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as TermStructure;
    expect(body.underlying).toBe('BTC');
    expect(body.provenance).toBe('synthetic');
    expect(typeof body.note).toBe('string');
    expect(body.points.length).toBeGreaterThan(0);
    expect(body.points.every((p) => p.annualizedBasisPct > 0)).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/futures/term-structure' })).statusCode).toBe(400);
  });

  it('a provider without the options reads gets an honest unavailable snapshot, never a fabricated one', async () => {
    const bare = new MockProvider();
    // Shadow the prototype methods with own-property undefined, simulating a
    // provider (e.g. yahoo) that omits the optional options reads entirely.
    const stripped = bare as unknown as {
      getDvol?: unknown;
      getOptionsChain?: unknown;
      getFuturesTermStructure?: unknown;
    };
    stripped.getDvol = undefined;
    stripped.getOptionsChain = undefined;
    stripped.getFuturesTermStructure = undefined;
    const bareApp = await appWith(bare);
    try {
      const dvol = (await bareApp.inject({ method: 'GET', url: '/api/options/dvol?symbol=BTC' })).json() as DvolSnapshot;
      expect(dvol.provenance).toBe('unavailable');
      expect(dvol.value).toBeNull();
      expect(typeof dvol.note).toBe('string');
      const chain = (await bareApp.inject({ method: 'GET', url: '/api/options/chain?symbol=BTC' })).json() as OptionsChain;
      expect(chain.provenance).toBe('unavailable');
      expect(chain.entries).toEqual([]);
      expect(chain.maxPainStrike).toBeNull();
      const term = (await bareApp.inject({ method: 'GET', url: '/api/futures/term-structure?symbol=BTC' })).json() as TermStructure;
      expect(term.provenance).toBe('unavailable');
      expect(term.points).toEqual([]);
    } finally {
      await bareApp.close();
    }
  });
});

describe('options routes TTL caching', () => {
  it('collapses polling into one provider read per window', async () => {
    const counting = new CountingProvider();
    const app = await appWith(counting);
    try {
      await app.inject({ method: 'GET', url: '/api/options/dvol?symbol=BTC' });
      await app.inject({ method: 'GET', url: '/api/options/dvol?symbol=BTC' });
      expect(counting.dvolCalls).toBe(1);
      await app.inject({ method: 'GET', url: '/api/options/dvol?symbol=ETH' });
      expect(counting.dvolCalls).toBe(2); // a different underlier is a different cache key

      await app.inject({ method: 'GET', url: '/api/options/chain?symbol=BTC' });
      await app.inject({ method: 'GET', url: '/api/options/chain?symbol=BTC' });
      expect(counting.chainCalls).toBe(1);
      await app.inject({ method: 'GET', url: `/api/options/chain?symbol=BTC&expiry=${Date.now() + 14 * 86_400_000}` });
      expect(counting.chainCalls).toBe(2); // a different expiry is a different cache key

      await app.inject({ method: 'GET', url: '/api/futures/term-structure?symbol=BTC' });
      await app.inject({ method: 'GET', url: '/api/futures/term-structure?symbol=BTC' });
      expect(counting.termCalls).toBe(1);
    } finally {
      await app.close();
    }
  });
});
