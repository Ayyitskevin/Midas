import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { OiDelta } from '@midas/shared';
import { buildApp } from './app';
import { MockProvider } from './providers/mock';

/**
 * Route-level coverage for GET /api/oi-delta: edge validation (symbol, the
 * 1h/4h/24h/7d window whitelist), the synthetic provenance label, the
 * provider-missing 'unavailable' degradation, and the 60s TTL cache collapsing
 * client polling into one provider read per (symbol, window). Everything runs
 * against the deterministic mock provider — never a real exchange.
 */

async function appWith(provider: MockProvider): Promise<FastifyInstance> {
  process.env.LOG_LEVEL = 'silent';
  const app = await buildApp(provider);
  await app.ready();
  return app;
}

/** A mock provider that counts its OI-delta reads so cache hits are observable. */
class CountingProvider extends MockProvider {
  oiDeltaCalls = 0;
  override async getOiDelta(symbol: string, window: '1h' | '4h' | '24h' | '7d') {
    this.oiDeltaCalls += 1;
    return super.getOiDelta(symbol, window);
  }
}

describe('GET /api/oi-delta', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await appWith(new MockProvider());
  });
  afterAll(async () => {
    await app.close();
  });

  it('returns a synthetic-labeled positioning snapshot', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/oi-delta?symbol=BTC/USDT&window=24h' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as OiDelta;
    expect(body.symbol).toBe('BTC/USDT:USDT');
    expect(body.window).toBe('24h');
    expect(body.provenance).toBe('synthetic');
    expect(body.source).toBe('mock');
    expect(typeof body.note).toBe('string'); // synthetic always carries the caveat
    expect(body.points.length).toBeGreaterThan(1);
    expect(body.oiChangePct).not.toBeNull();
    expect(body.priceChangePct).not.toBeNull();
    expect(body.classification).not.toBeNull();
  });

  it('defaults the window to 24h and accepts every whitelisted window', async () => {
    const dflt = (await app.inject({ method: 'GET', url: '/api/oi-delta?symbol=ETH/USDT' })).json() as OiDelta;
    expect(dflt.window).toBe('24h');
    for (const w of ['1h', '4h', '24h', '7d']) {
      const res = await app.inject({ method: 'GET', url: `/api/oi-delta?symbol=ETH/USDT&window=${w}` });
      expect(res.statusCode, w).toBe(200);
      expect((res.json() as OiDelta).window).toBe(w);
    }
  });

  it('rejects a missing symbol and junk windows at the edge', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/oi-delta' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/oi-delta?symbol=%0A' })).statusCode).toBe(400);
    for (const w of ['2h', '1d', '24H', '24hours', '1h%27%20OR%201%3D1--']) {
      const res = await app.inject({ method: 'GET', url: `/api/oi-delta?symbol=BTC/USDT&window=${w}` });
      expect(res.statusCode, w).toBe(400);
    }
  });

  it('a provider without the OI-history read gets an honest unavailable snapshot', async () => {
    const bare = new MockProvider();
    // Shadow the prototype method with own-property undefined, simulating a
    // provider (e.g. yahoo) that omits the optional OI-delta read entirely.
    (bare as unknown as { getOiDelta?: unknown }).getOiDelta = undefined;
    const bareApp = await appWith(bare);
    try {
      const body = (
        await bareApp.inject({ method: 'GET', url: '/api/oi-delta?symbol=BTC/USDT&window=4h' })
      ).json() as OiDelta;
      expect(body.provenance).toBe('unavailable');
      expect(body.window).toBe('4h');
      expect(body.oiChangePct).toBeNull();
      expect(body.classification).toBeNull();
      expect(body.points).toEqual([]);
      expect(typeof body.note).toBe('string');
    } finally {
      await bareApp.close();
    }
  });

  it('collapses polling into one provider read per (symbol, window)', async () => {
    const counting = new CountingProvider();
    const countApp = await appWith(counting);
    try {
      await countApp.inject({ method: 'GET', url: '/api/oi-delta?symbol=BTC/USDT&window=24h' });
      await countApp.inject({ method: 'GET', url: '/api/oi-delta?symbol=BTC/USDT&window=24h' });
      expect(counting.oiDeltaCalls).toBe(1);
      await countApp.inject({ method: 'GET', url: '/api/oi-delta?symbol=BTC/USDT&window=4h' });
      expect(counting.oiDeltaCalls).toBe(2); // a different window is a different cache key
      await countApp.inject({ method: 'GET', url: '/api/oi-delta?symbol=ETH/USDT&window=24h' });
      expect(counting.oiDeltaCalls).toBe(3); // a different symbol too
    } finally {
      await countApp.close();
    }
  });
});
