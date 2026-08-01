import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDataReceipt } from '@midas/shared';
import type { BoardEnvelope, DataReceipt, VenueQuote } from '@midas/shared';
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
  const provider = new MockProvider();
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await appWith(provider);
  });
  afterAll(async () => {
    await app.close();
  });

  const boards = [
    ['/api/funding', 'funding'],
    ['/api/funding-dispersion', 'funding'],
    ['/api/venue-arb', 'venue-arbitrage'],
    ['/api/oi-concentration', 'open-interest'],
  ] as const;

  for (const [path, family] of boards) {
    it(`${path} returns a BoardEnvelope honestly labeled synthetic`, async () => {
      const res = await app.inject({ method: 'GET', url: `${path}?quote=USDT&limit=5` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as BoardEnvelope<Record<string, unknown>>;
      expect(Array.isArray(body.rows)).toBe(true);
      expect(body.rows.length).toBeGreaterThan(0);
      expect(body.meta.provenance).toBe('synthetic'); // mock is never passed off as live
      expect(body.meta.source).toBe('mock');
      expect(typeof body.meta.asOf).toBe('number');
      expect(body.meta.partial).toBe(path === '/api/venue-arb');
      expect(typeof body.meta.note).toBe('string'); // synthetic provenance always stated
      expect(body.meta.receipt).toMatchObject({
        datasetFamily: family,
        derivation: 'derived',
        provenance: 'synthetic',
        cache: { status: 'miss', ageMs: 0 },
      });
      const rowReceiptIds = body.rows.map((row) => (row.receipt as DataReceipt).receiptId);
      expect(body.meta.receipt!.inputReceiptIds).toEqual(rowReceiptIds);
      if (path === '/api/venue-arb') {
        expect(body.meta.receipt?.methodology).toEqual(
          provider.capabilities.capabilities['venue-arbitrage'].methodology,
        );
      }
    });
  }

  it('a fresh serve reports cachedAt null; a cached serve reports the compute time', async () => {
    const first = (await app.inject({ method: 'GET', url: '/api/venue-arb?quote=USDT&limit=4' })).json() as BoardEnvelope<unknown>;
    expect(first.meta.cachedAt).toBeNull();
    const second = (await app.inject({ method: 'GET', url: '/api/venue-arb?quote=USDT&limit=4' })).json() as BoardEnvelope<unknown>;
    expect(second.meta.cachedAt).toBe(first.meta.asOf); // stamped with the original compute time
    expect(second.meta.receipt?.receiptId).toBe(first.meta.receipt?.receiptId);
    expect(second.meta.receipt?.sourceAsOf).toBe(first.meta.receipt?.sourceAsOf);
    expect(first.meta.receipt?.cache).toEqual({ status: 'miss', ageMs: 0 });
    expect(second.meta.receipt?.cache.status).toBe('hit');
    expect(second.meta.receipt?.cache.ageMs).toBeGreaterThanOrEqual(0);
  });

  it('returns an honest unavailable assembly receipt when no board row exists', async () => {
    class EmptyProvider extends MockProvider {
      override async screen() {
        return [];
      }
    }
    const emptyApp = await appWith(new EmptyProvider());
    try {
      const response = await emptyApp.inject({ method: 'GET', url: '/api/funding?quote=USDT&limit=5' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as BoardEnvelope<unknown>;
      expect(body.rows).toEqual([]);
      expect(body.meta.receipt).toMatchObject({
        datasetFamily: 'funding',
        provenance: 'unavailable',
        freshness: { state: 'unknown', ageMs: null },
      });
      expect(body.meta.receipt?.limitations).toContain('No receipted board rows were available.');
    } finally {
      await emptyApp.close();
    }
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
      expect(body.meta.receipt?.limitations).toContain(
        'Partial evidence: 1 of 5 board input(s) failed.',
      );
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

  it('counts computed rows omitted for insufficient signal as partial coverage', async () => {
    class MissingOiProvider extends MockProvider {
      override async getVenueDerivatives(symbol: string) {
        const rows = await super.getVenueDerivatives(symbol);
        return rows.map((row) => ({ ...row, openInterestValue: null }));
      }
    }
    const app = await appWith(new MissingOiProvider());
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/oi-concentration?quote=USDT&limit=3',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as BoardEnvelope<unknown>;
      expect(body.rows).toEqual([]);
      expect(body.meta.partial).toBe(true);
      expect(body.meta.note).toMatch(/3 of 3 symbols lacked the required signal/i);
      expect(body.meta.receipt?.limitations).toContain(
        'Partial evidence: 3 of 3 board input(s) lacked the required signal and were omitted.',
      );
      expect(body.meta.receipt).toMatchObject({ provenance: 'synthetic', derivation: 'derived' });
      expect(body.meta.receipt?.inputReceiptIds).toHaveLength(3);

      const status = (await app.inject({ method: 'GET', url: '/api/data/status' })).json();
      expect(status.datasets['open-interest']).toMatchObject({
        state: 'degraded',
        errorCategory: 'partial',
      });
    } finally {
      await app.close();
    }
  });

  it('keeps partial row evidence on the outer board receipt and status', async () => {
    class PartialFundingProvider extends MockProvider {
      override async getDerivatives(symbol: string) {
        const payload = await super.getDerivatives(symbol);
        return {
          ...payload,
          fundingRate: null,
          receipt: createDataReceipt({
            providerId: this.capabilities.providerId,
            providerVersion: this.capabilities.providerVersion,
            source: this.capabilities.source,
            datasetFamily: 'derivatives',
            instrument: symbol,
            provenance: 'synthetic',
            sourceAsOf: payload.receipt?.sourceAsOf ?? null,
            observedAt: Date.now(),
            maxAgeMs: 120_000,
            limitations: ['Funding rate is unavailable in this injected snapshot.'],
            note: 'Synthetic partial derivatives fixture.',
          }),
        };
      }
    }
    const app = await appWith(new PartialFundingProvider());
    try {
      const res = await app.inject({ method: 'GET', url: '/api/funding?quote=USDT&limit=1' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as BoardEnvelope<unknown>;
      expect(body.meta.partial).toBe(true);
      expect(body.meta.receipt?.limitations).toContain(
        'Partial evidence: 1 returned board row(s) carry partial evidence.',
      );

      const status = (await app.inject({ method: 'GET', url: '/api/data/status' })).json();
      expect(status.datasets.funding).toMatchObject({
        state: 'degraded',
        errorCategory: 'partial',
      });
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

  it('suppresses a previously crossed net arb when cached quote evidence becomes nonfresh', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    let now = 1_700_000_000_000;
    nowSpy.mockImplementation(() => now);
    class CrossedArbProvider extends CountingProvider {
      override async getExchangeQuotes(symbol: string): Promise<VenueQuote[]> {
        const receipt = (venue: string) =>
          createDataReceipt(
            {
              providerId: 'mock',
              providerVersion: '1.0.0',
              source: 'mock',
              venue,
              datasetFamily: 'venue-quotes',
              instrument: symbol,
              provenance: 'synthetic',
              sourceAsOf: now,
              observedAt: now,
              maxAgeMs: 1_000,
              units: { price: 'USDT', size: 'base-asset' },
              note: 'Synthetic crossed-book fixture.',
            },
            now,
          );
        return [
          {
            exchange: 'binance',
            price: 100,
            bid: 99.8,
            ask: 100,
            bidSize: 2,
            askSize: 2,
            changePercent: 0,
            volume: 1_000,
            timestamp: now,
            receipt: receipt('binance'),
          },
          {
            exchange: 'okx',
            price: 100.8,
            bid: 101,
            ask: 101.2,
            bidSize: 2,
            askSize: 2,
            changePercent: 0,
            volume: 1_000,
            timestamp: now,
            receipt: receipt('okx'),
          },
        ];
      }
    }
    const provider = new CrossedArbProvider(() => Date.now());
    let app: FastifyInstance | null = null;
    try {
      app = await appWith(provider);
      const first = (await app.inject({ method: 'GET', url: '/api/venue-arb?quote=USDT&limit=1' })).json() as BoardEnvelope<{
        netSpreadBps: number | null;
        netCrossed: boolean;
        netLimitations: string[];
        receipt: DataReceipt;
      }>;
      expect(first.rows).toHaveLength(1);
      expect(first.rows[0]).toMatchObject({ netCrossed: true });
      expect(first.rows[0]!.netSpreadBps).toBeGreaterThan(0);
      expect(first.rows[0]!.receipt).toMatchObject({
        freshness: { state: 'fresh' },
        cache: { status: 'miss' },
      });

      now += 1_001;
      const second = (await app.inject({ method: 'GET', url: '/api/venue-arb?quote=USDT&limit=1' })).json() as typeof first;
      expect(provider.screenCalls).toBe(1);
      expect(second.rows[0]).toMatchObject({
        netSpreadBps: null,
        netCrossed: false,
        receipt: {
          receiptId: first.rows[0]!.receipt.receiptId,
          freshness: { state: 'stale' },
          cache: { status: 'hit', ageMs: 1_001 },
        },
      });
      expect(second.rows[0]!.netLimitations.join(' ')).toMatch(/cached quote evidence.*no longer fresh/i);
    } finally {
      if (app) await app.close();
      nowSpy.mockRestore();
    }
  });

  it('/api/liquidations serves the second call from cache', async () => {
    const provider = new CountingProvider();
    const app = await appWith(provider);
    try {
      const first = (await app.inject({ method: 'GET', url: '/api/liquidations?quote=USDT&limit=5' })).json();
      const second = (await app.inject({ method: 'GET', url: '/api/liquidations?quote=USDT&limit=5' })).json();
      expect(provider.screenCalls).toBe(1);
      expect(first.meta.receipt).toMatchObject({
        datasetFamily: 'liquidations',
        derivation: 'derived',
        cache: { status: 'miss', ageMs: 0 },
      });
      expect(first.meta.receipt.inputReceiptIds.length).toBeGreaterThan(0);
      expect(second.meta.receipt.receiptId).toBe(first.meta.receipt.receiptId);
      expect(second.meta.receipt.sourceAsOf).toBe(first.meta.receipt.sourceAsOf);
      expect(second.meta.receipt.cache.status).toBe('hit');
      await app.inject({ method: 'GET', url: '/api/liquidations?quote=USDT&limit=6' });
      expect(provider.screenCalls).toBe(2); // fan-out limit is part of the cache key
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
