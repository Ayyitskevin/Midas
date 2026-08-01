import Fastify from 'fastify';
import { validateDataReceipt } from '@midas/shared';
import type { OiDeltaWindow } from '@midas/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { registerAccountEventsRoute } from './accountWatch';
import { registerEquityRoute } from './equity';
import { MockProvider } from './providers/mock';
import type { HistoryOptions } from './providers/types';
import {
  DATA_ROUTE_COVERAGE,
  DATA_ROUTE_PATHS,
  type DataRoutePath,
} from './dataCoverage';
import { createDataStatusTracker, registerDataStatusRoute } from './dataStatus';
import {
  PER_USER_ACCOUNT_STATUS_SOURCE,
  registerAccountRoutes,
} from './routes/account';
import { registerMarketRoutes } from './routes/market';

async function expectMalformedRoute(
  provider: MockProvider,
  url: string,
  family: string,
): Promise<void> {
  const app = await buildApp(provider, {
    auth: { enabled: false },
    keyRepo: null,
    logger: { level: 'silent' },
  });
  try {
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(502);
    expect(response.json().message).toBe('Internal Server Error');
    const status = (await app.inject({ method: 'GET', url: '/api/data/status' })).json();
    expect(status.datasets[family]).toMatchObject({
      state: 'unavailable',
      errorCategory: 'malformed-upstream',
    });
  } finally {
    await app.close();
  }
}

describe('data receipt route coverage', () => {
  it('classifies every GET actually registered by the market/account trust boundary', () => {
    const app = Fastify({ logger: false });
    const provider = new MockProvider();
    const tracker = createDataStatusTracker(() => 1_700_000_000_000);
    const actual: string[] = [];
    app.addHook('onRoute', (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      if (methods.includes('GET')) actual.push(route.url);
    });

    registerMarketRoutes(app, provider, tracker);
    const pool = { accountFor: () => provider, userFor: () => null };
    registerAccountRoutes(app, pool, tracker, PER_USER_ACCOUNT_STATUS_SOURCE);
    registerDataStatusRoute(app, provider, pool, tracker);
    registerAccountEventsRoute(app, null);
    registerEquityRoute(app, null);

    const declared = DATA_ROUTE_COVERAGE.map((entry) => entry.path);
    expect(new Set(declared).size).toBe(declared.length);
    expect([...actual].sort()).toEqual([...declared].sort());
  });

  it('requires every receipt route to name families and every exemption to carry actionable debt', () => {
    for (const entry of DATA_ROUTE_COVERAGE) {
      if (entry.coverage.state === 'receipt') {
        expect(entry.coverage.families.length, entry.path).toBeGreaterThan(0);
      }
      if (entry.coverage.state === 'temporary-exemption') {
        expect(entry.coverage.families.length, entry.path).toBeGreaterThan(0);
        expect(entry.coverage.reason.trim().length, entry.path).toBeGreaterThan(0);
        expect(entry.coverage.backlog.trim().length, entry.path).toBeGreaterThan(0);
      }
    }
  });

  it('probes every adopted success shape for schema-valid transported receipts', async () => {
    type ReceiptLocation = 'direct' | 'array' | 'board';
    const probes = new Map<DataRoutePath, { url: string; location: ReceiptLocation }>([
      [DATA_ROUTE_PATHS.quote, { url: '/api/quote/BTC-USDT', location: 'direct' }],
      [DATA_ROUTE_PATHS.quotes, { url: '/api/quotes?symbols=BTC-USDT,ETH-USDT', location: 'array' }],
      [DATA_ROUTE_PATHS.history, { url: '/api/history/BTC-USDT?interval=1d&range=5d', location: 'direct' }],
      [DATA_ROUTE_PATHS.exchangeQuotes, { url: '/api/exchange-quotes/BTC-USDT', location: 'array' }],
      [DATA_ROUTE_PATHS.venueDerivatives, { url: '/api/venue-derivatives/BTC-USDT', location: 'array' }],
      [DATA_ROUTE_PATHS.derivatives, { url: '/api/derivatives/BTC-USDT', location: 'direct' }],
      [DATA_ROUTE_PATHS.fundingHistory, { url: '/api/funding-history/BTC-USDT?limit=2', location: 'array' }],
      [DATA_ROUTE_PATHS.dvol, { url: '/api/options/dvol?symbol=BTC', location: 'direct' }],
      [DATA_ROUTE_PATHS.optionsChain, { url: '/api/options/chain?symbol=BTC-USDT', location: 'direct' }],
      [DATA_ROUTE_PATHS.termStructure, { url: '/api/futures/term-structure?symbol=BTC-USDT', location: 'direct' }],
      [DATA_ROUTE_PATHS.oiDelta, { url: '/api/oi-delta?symbol=BTC-USDT&window=24h', location: 'direct' }],
      [DATA_ROUTE_PATHS.funding, { url: '/api/funding?quote=USDT&limit=1', location: 'board' }],
      [DATA_ROUTE_PATHS.fundingDispersion, { url: '/api/funding-dispersion?quote=USDT&limit=1', location: 'board' }],
      [DATA_ROUTE_PATHS.venueArb, { url: '/api/venue-arb?quote=USDT&limit=1', location: 'board' }],
      [DATA_ROUTE_PATHS.oiConcentration, { url: '/api/oi-concentration?quote=USDT&limit=1', location: 'board' }],
      [DATA_ROUTE_PATHS.liquidations, { url: '/api/liquidations?quote=USDT&limit=1', location: 'direct' }],
      [DATA_ROUTE_PATHS.balances, { url: '/api/balances', location: 'direct' }],
      [DATA_ROUTE_PATHS.orders, { url: '/api/orders', location: 'direct' }],
      [DATA_ROUTE_PATHS.positions, { url: '/api/positions', location: 'direct' }],
      [DATA_ROUTE_PATHS.fills, { url: '/api/fills', location: 'direct' }],
    ]);
    const adopted = DATA_ROUTE_COVERAGE
      .filter((entry) => entry.coverage.state === 'receipt')
      .map((entry) => entry.path);
    expect([...probes.keys()].sort()).toEqual([...adopted].sort());

    const coverageByPath = new Map(DATA_ROUTE_COVERAGE.map((entry) => [entry.path, entry.coverage]));
    const app = await buildApp(new MockProvider(), {
      auth: { enabled: false },
      keyRepo: null,
    });
    const assertReceipt = (candidate: unknown, path: DataRoutePath) => {
      const checked = validateDataReceipt(candidate);
      expect(checked.ok, `${path} did not return a schema-valid receipt`).toBe(true);
      if (!checked.ok) return;
      const coverage = coverageByPath.get(path);
      expect(coverage?.state).toBe('receipt');
      if (coverage?.state !== 'receipt') return;
      expect(coverage.families, `${path} returned the wrong receipt family`).toContain(
        checked.value.datasetFamily,
      );
      expect(checked.value.traceId, `${path} did not transport-stamp its receipt`).not.toBeNull();
    };

    try {
      for (const [path, probe] of probes) {
        const response = await app.inject({ method: 'GET', url: probe.url });
        expect(response.statusCode, `${path} probe failed: ${response.body}`).toBe(200);
        const body = response.json() as unknown;
        if (probe.location === 'array') {
          expect(Array.isArray(body), `${path} did not return its declared array shape`).toBe(true);
          const rows = body as unknown[];
          expect(rows.length, `${path} probe returned no rows to inspect`).toBeGreaterThan(0);
          for (const row of rows) {
            assertReceipt((row as Record<string, unknown>).receipt, path);
          }
          continue;
        }
        const payload = body as Record<string, unknown>;
        if (probe.location === 'board') {
          const rows = payload.rows as unknown[];
          const meta = payload.meta as Record<string, unknown>;
          expect(Array.isArray(rows), `${path} did not return board rows`).toBe(true);
          assertReceipt(meta?.receipt, path);
          for (const row of rows) {
            assertReceipt((row as Record<string, unknown>).receipt, path);
          }
          continue;
        }
        assertReceipt(payload.receipt, path);
      }
    } finally {
      await app.close();
    }
  });

  it('fails closed when an adopted array call returns no evidence', async () => {
    class EmptyArrayProvider extends MockProvider {
      override async getQuotes() {
        return [];
      }

      override async getFundingHistory() {
        return [];
      }
    }
    const app = await buildApp(new EmptyArrayProvider(), {
      auth: { enabled: false },
      keyRepo: null,
    });
    try {
      const quotes = await app.inject({
        method: 'GET',
        url: '/api/quotes?symbols=BTC-USDT,ETH-USDT',
      });
      expect(quotes.statusCode).toBe(502);
      const funding = await app.inject({
        method: 'GET',
        url: '/api/funding-history/BTC-USDT?limit=2',
      });
      expect(funding.statusCode).toBe(502);

      const status = (await app.inject({ method: 'GET', url: '/api/data/status' })).json();
      expect(status.datasets.quote).toMatchObject({
        state: 'unavailable',
        errorCategory: 'upstream-unavailable',
      });
      expect(status.datasets['funding-history']).toMatchObject({
        state: 'unavailable',
        errorCategory: 'upstream-unavailable',
      });
    } finally {
      await app.close();
    }
  });

  it('exposes partial requested-symbol coverage on every returned batch row', async () => {
    class PartialQuoteProvider extends MockProvider {
      override async getQuotes(symbols: string[]) {
        return super.getQuotes(symbols.slice(0, 1));
      }
    }
    const app = await buildApp(new PartialQuoteProvider(), {
      auth: { enabled: false },
      keyRepo: null,
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/quotes?symbols=BTC-USDT,ETH-USDT',
      });
      expect(response.statusCode).toBe(200);
      const rows = response.json();
      expect(rows).toHaveLength(1);
      expect(rows[0].receipt).toMatchObject({
        datasetFamily: 'quote',
        derivation: 'derived',
        coverage: '1 of 2 requested symbol(s).',
      });
      expect(rows[0].receipt.limitations).toContain(
        'Partial evidence: Provider returned 1 of 2 requested quote observation(s).',
      );
      const checked = validateDataReceipt(rows[0].receipt);
      expect(checked.ok).toBe(true);

      const status = (await app.inject({ method: 'GET', url: '/api/data/status' })).json();
      expect(status.datasets.quote).toMatchObject({ state: 'degraded', errorCategory: 'partial' });
    } finally {
      await app.close();
    }
  });

  it('rejects duplicate batch rows instead of hiding a missing requested symbol by count', async () => {
    class DuplicateQuoteProvider extends MockProvider {
      override async getQuotes(symbols: string[]) {
        return super.getQuotes([symbols[0]!, symbols[0]!]);
      }
    }
    const app = await buildApp(new DuplicateQuoteProvider(), {
      auth: { enabled: false },
      keyRepo: null,
      logger: { level: 'silent' },
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/quotes?symbols=BTC-USDT,ETH-USDT',
      });
      expect(response.statusCode).toBe(502);
      expect(response.json().message).toBe('Internal Server Error');
      const status = (await app.inject({ method: 'GET', url: '/api/data/status' })).json();
      expect(status.datasets.quote).toMatchObject({
        state: 'unavailable',
        errorCategory: 'malformed-upstream',
      });
    } finally {
      await app.close();
    }
  });

  it('rejects duplicate venues instead of presenting one market as cross-venue evidence', async () => {
    class DuplicateVenueProvider extends MockProvider {
      override async getExchangeQuotes(symbol: string) {
        const rows = await super.getExchangeQuotes(symbol);
        return [rows[0]!, rows[0]!];
      }
    }
    const app = await buildApp(new DuplicateVenueProvider(), {
      auth: { enabled: false },
      keyRepo: null,
      logger: { level: 'silent' },
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/exchange-quotes/BTC-USDT',
      });
      expect(response.statusCode).toBe(502);
      expect(response.json().message).toBe('Internal Server Error');
      const status = (await app.inject({ method: 'GET', url: '/api/data/status' })).json();
      expect(status.datasets['venue-quotes']).toMatchObject({
        state: 'unavailable',
        errorCategory: 'malformed-upstream',
      });
    } finally {
      await app.close();
    }
  });

  it('rejects an old quote payload paired with a fresh receipt', async () => {
    class MismatchedQuoteTimeProvider extends MockProvider {
      override async getQuote(symbol: string) {
        const quote = await super.getQuote(symbol);
        return { ...quote, asOf: quote.asOf === null ? null : quote.asOf - 86_400_000 };
      }
    }
    const app = await buildApp(new MismatchedQuoteTimeProvider(), {
      auth: { enabled: false },
      keyRepo: null,
      logger: { level: 'silent' },
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/api/quote/BTC-USDT' });
      expect(response.statusCode).toBe(502);
      expect(response.json().message).toBe('Internal Server Error');
      const status = (await app.inject({ method: 'GET', url: '/api/data/status' })).json();
      expect(status.datasets.quote).toMatchObject({
        state: 'unavailable',
        errorCategory: 'malformed-upstream',
      });
    } finally {
      await app.close();
    }
  });

  it('rejects history returned for a different requested range', async () => {
    class WrongRangeProvider extends MockProvider {
      override getHistory(symbol: string, opts: HistoryOptions) {
        return super.getHistory(symbol, { ...opts, range: '1d' });
      }
    }
    await expectMalformedRoute(
      new WrongRangeProvider(),
      '/api/history/BTC-USDT?interval=1d&range=5d',
      'history',
    );
  });

  it('rejects an options chain returned for a different explicit expiry', async () => {
    class WrongExpiryProvider extends MockProvider {
      override getOptionsChain(symbol: string, _expiry?: number | 'nearest') {
        return super.getOptionsChain(symbol, 2_000_086_400_000);
      }
    }
    await expectMalformedRoute(
      new WrongExpiryProvider(),
      '/api/options/chain?symbol=BTC-USDT&expiry=2000000000000',
      'options',
    );
  });

  it('rejects an OI delta returned for a different requested window', async () => {
    class WrongWindowProvider extends MockProvider {
      override getOiDelta(symbol: string, _window: OiDeltaWindow) {
        return super.getOiDelta(symbol, '1h');
      }
    }
    await expectMalformedRoute(
      new WrongWindowProvider(),
      '/api/oi-delta?symbol=BTC-USDT&window=24h',
      'open-interest-delta',
    );
  });

  it('rejects fills whose nested symbols contradict the requested symbol', async () => {
    class WrongFillRowsProvider extends MockProvider {
      override async getFills(symbol?: string) {
        const payload = await super.getFills(symbol);
        return {
          ...payload,
          fills: payload.fills.map((fill) => ({ ...fill, symbol: 'ETH/USDT' })),
        };
      }
    }
    await expectMalformedRoute(
      new WrongFillRowsProvider(),
      '/api/fills?symbol=BTC-USDT',
      'account-fills',
    );
  });

  it('records an absent declared-unsupported funding-history method as unsupported', async () => {
    const provider = new MockProvider();
    Object.defineProperty(provider, 'getFundingHistory', { value: undefined });
    Object.defineProperty(provider, 'capabilities', {
      value: {
        ...provider.capabilities,
        capabilities: {
          ...provider.capabilities.capabilities,
          'funding-history': {
            ...provider.capabilities.capabilities['funding-history'],
            method: '',
            support: 'unsupported',
            auth: 'none',
            mode: 'unavailable',
          },
        },
      },
    });
    const app = await buildApp(provider, { auth: { enabled: false }, keyRepo: null });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/funding-history/BTC-USDT?limit=2',
      });
      expect(response.statusCode).toBe(501);
      const status = (await app.inject({ method: 'GET', url: '/api/data/status' })).json();
      expect(status.datasets['funding-history']).toMatchObject({
        state: 'unavailable',
        errorCategory: 'unsupported',
        sourceMode: 'unavailable',
      });
    } finally {
      await app.close();
    }
  });
});
