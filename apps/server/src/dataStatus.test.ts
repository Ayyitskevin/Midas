import { createDataReceipt, deriveDataReceipt } from '@midas/shared';
import type { Exchange } from 'ccxt';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app';
import { createDataStatusTracker, type DataStatusObservation } from './dataStatus';
import { KeyRepo } from './keys/repo';
import { CcxtProvider } from './providers/ccxt';
import { MockProvider } from './providers/mock';
import type { DataProvider } from './providers';
import { ProviderError } from './providers';

const NOW = 1_700_000_000_000;

function quoteReceipt(sourceAsOf = NOW - 1_000) {
  return createDataReceipt(
    {
      providerId: 'mock',
      providerVersion: '1.0.0',
      source: 'mock',
      datasetFamily: 'quote',
      instrument: 'BTC/USDT',
      coverage: 'one symbol',
      provenance: 'synthetic',
      sourceAsOf,
      observedAt: NOW,
      expectedCadenceMs: 60_000,
      maxAgeMs: 10_000,
      cache: { status: 'miss', ageMs: 0 },
      units: { price: 'USDT' },
      methodology: null,
      limitations: ['Synthetic fixture.'],
      traceId: null,
      note: 'Synthetic quote fixture.',
    },
    NOW,
  );
}

function liveQuoteProvider(sourceAsOf: number, malformed = false): DataProvider {
  const provider = new MockProvider(() => NOW);
  const providerId = 'fixture-live';
  Object.defineProperties(provider, {
    name: { value: providerId },
    live: { value: true },
    capabilities: {
      value: {
        ...provider.capabilities,
        providerId,
        source: providerId,
        capabilities: {
          ...provider.capabilities.capabilities,
          quote: {
            ...provider.capabilities.capabilities.quote,
            mode: 'live',
            source: providerId,
            caveats: [],
          },
        },
      },
    },
  });
  const fixtureSource = new MockProvider(() => NOW);
  provider.getQuote = async (symbol: string) => {
    const value = await fixtureSource.getQuote(symbol);
    const receipt = createDataReceipt(
      {
        providerId,
        providerVersion: provider.capabilities.providerVersion,
        source: providerId,
        venue: value.exchange,
        datasetFamily: 'quote',
        instrument: value.symbol,
        coverage: 'one fixture symbol',
        provenance: 'live',
        sourceAsOf,
        observedAt: NOW,
        expectedCadenceMs: 5_000,
        maxAgeMs: 10_000,
        cache: { status: 'miss', ageMs: 0 },
        units: { price: value.currency },
      },
      NOW,
    );
    return {
      ...value,
      asOf: sourceAsOf,
      receipt: malformed
        ? { ...receipt, providerId: 'apiKey=LEAK_MALFORMED_PROVIDER' }
        : receipt,
    };
  };
  return provider;
}

describe('data status tracker', () => {
  it('records receipt health and preserves last success across a sanitized error', () => {
    const provider = new MockProvider();
    const observed: DataStatusObservation[] = [];
    const tracker = createDataStatusTracker(() => NOW + 5_000, (event) => observed.push(event));
    const receipt = quoteReceipt();

    tracker.recordReceipt(provider, receipt, null);
    expect(tracker.snapshot(provider).quote).toMatchObject({
      state: 'healthy',
      errorCategory: null,
      provenance: 'synthetic',
      sourceMode: 'synthetic',
      lastReceiptId: receipt.receiptId,
      lastSuccessAt: receipt.observedAt,
      sourceAsOf: receipt.sourceAsOf,
    });

    tracker.recordError(provider, 'quote', 'upstream-unavailable');
    expect(tracker.snapshot(provider).quote).toMatchObject({
      state: 'unavailable',
      errorCategory: 'upstream-unavailable',
      provenance: null,
      sourceMode: 'synthetic',
      lastReceiptId: null,
      lastSuccessAt: receipt.observedAt,
      sourceAsOf: receipt.sourceAsOf,
      limitations: ['upstream-unavailable'],
    });
    expect(JSON.stringify(tracker.snapshot(provider))).not.toContain('apiKey=super-secret');
    expect(observed).toEqual([
      {
        kind: 'receipt',
        receiptId: receipt.receiptId,
        datasetFamily: 'quote',
        providerId: 'mock',
        traceId: null,
        freshness: 'fresh',
        cache: 'miss',
      },
      {
        kind: 'error',
        datasetFamily: 'quote',
        providerId: 'mock',
        errorCategory: 'upstream-unavailable',
      },
    ]);
  });

  it('keeps a partial category when the transported receipt is explicitly marked partial', () => {
    const provider = new MockProvider();
    const tracker = createDataStatusTracker(() => NOW);
    const receipt = quoteReceipt();
    tracker.recordReceipt(provider, receipt, 'partial');
    tracker.recordReceipt(provider, { ...receipt, cache: { status: 'hit', ageMs: 5_000 } }, 'partial');
    expect(tracker.snapshot(provider).quote).toMatchObject({
      state: 'degraded',
      errorCategory: 'partial',
      cache: { status: 'hit', ageMs: 5_000 },
    });
  });

  it('recovers a prior family error when fresh evidence succeeds', () => {
    const provider = new MockProvider(() => NOW);
    const tracker = createDataStatusTracker(() => NOW);
    tracker.recordError(provider, 'quote', 'upstream-unavailable');
    tracker.recordReceipt(provider, quoteReceipt(), null);
    expect(tracker.snapshot(provider).quote).toMatchObject({
      state: 'healthy',
      errorCategory: null,
      freshness: { state: 'fresh' },
    });
  });

  it('never marks unknown, stale or clock-skew freshness healthy', () => {
    const provider = new MockProvider();
    const tracker = createDataStatusTracker(() => NOW);
    const unknown = createDataReceipt(
      {
        providerId: 'mock',
        providerVersion: '1.0.0',
        source: 'mock',
        datasetFamily: 'quote',
        provenance: 'synthetic',
        sourceAsOf: null,
        observedAt: NOW,
        maxAgeMs: 10_000,
        limitations: ['Source timestamp unavailable.'],
        note: 'Synthetic quote fixture.',
      },
      NOW,
    );
    tracker.recordReceipt(provider, unknown, null);
    expect(tracker.snapshot(provider).quote).toMatchObject({
      state: 'unknown',
      errorCategory: 'unknown',
    });

    const stale = quoteReceipt(NOW - 10_001);
    tracker.recordReceipt(provider, stale, null);
    expect(tracker.snapshot(provider).quote).toMatchObject({
      state: 'degraded',
      errorCategory: 'stale',
      freshness: { state: 'stale', ageMs: 10_001 },
    });

    const skewed = quoteReceipt(NOW + 1_000);
    tracker.recordReceipt(provider, skewed, null);
    expect(tracker.snapshot(provider).quote).toMatchObject({
      state: 'degraded',
      errorCategory: 'stale',
      freshness: { state: 'clock-skew', ageMs: -1_000 },
    });
  });

  it('recomputes freshness when status is read instead of freezing the write-time state', () => {
    let now = NOW;
    const provider = new MockProvider(() => now);
    const tracker = createDataStatusTracker(() => now);
    const receipt = quoteReceipt(NOW - 1_000);

    tracker.recordReceipt(provider, receipt, null);
    expect(tracker.snapshot(provider).quote).toMatchObject({
      state: 'healthy',
      errorCategory: null,
      freshness: { state: 'fresh', ageMs: 1_000 },
    });

    now += 10_001;
    expect(tracker.snapshot(provider).quote).toMatchObject({
      state: 'degraded',
      errorCategory: 'stale',
      freshness: { state: 'stale', ageMs: 11_001 },
      sourceAsOf: receipt.sourceAsOf,
    });
  });

  it.each([
    ['unknown', null, 'unknown'],
    ['clock-skew', NOW + 1_000, 'degraded'],
  ] as const)(
    'never improves inherited derived %s evidence to healthy',
    (_label, secondarySourceAsOf, expectedState) => {
      let now = NOW;
      const provider = new MockProvider(() => now);
      const tracker = createDataStatusTracker(() => now);
      const secondary = createDataReceipt(
        {
          providerId: 'mock',
          providerVersion: '1.0.0',
          source: 'mock',
          datasetFamily: 'quote',
          provenance: 'synthetic',
          sourceAsOf: secondarySourceAsOf,
          observedAt: NOW,
          maxAgeMs: 10_000,
          note: 'Synthetic secondary evidence.',
        },
        NOW,
      );
      const derived = deriveDataReceipt(
        {
          providerId: 'mock',
          providerVersion: '1.0.0',
          source: 'mock',
          datasetFamily: 'quote',
          provenance: 'synthetic',
          inputReceipts: [quoteReceipt(NOW - 1_000), secondary],
          observedAt: NOW,
          maxAgeMs: 10_000,
          methodology: {
            id: 'test.derived-freshness',
            version: '1.0',
            formula: 'Combine required observations.',
          },
          note: 'Synthetic derived evidence.',
        },
        NOW,
      );
      tracker.recordReceipt(provider, derived, null);

      now += 5_000;
      expect(tracker.snapshot(provider).quote).toMatchObject({
        state: expectedState,
        freshness: { state: _label },
      });
      expect(tracker.snapshot(provider).quote?.state).not.toBe('healthy');
    },
  );

  it('keeps account-family observations isolated by provider object', () => {
    const market = new MockProvider(() => NOW);
    const userA = new MockProvider(() => NOW);
    const userB = new MockProvider(() => NOW);
    const tracker = createDataStatusTracker(() => NOW);
    const receipt = createDataReceipt(
      {
        providerId: 'mock',
        providerVersion: '1.0.0',
        source: 'mock',
        datasetFamily: 'balances',
        provenance: 'synthetic',
        sourceAsOf: NOW - 1_000,
        observedAt: NOW,
        maxAgeMs: 10_000,
        note: 'Synthetic account fixture.',
      },
      NOW,
    );
    tracker.recordReceipt(userA, receipt, null);

    expect(tracker.response(market, userA).datasets.balances?.state).toBe('healthy');
    expect(tracker.response(market, userB).datasets.balances).toMatchObject({
      state: 'unknown',
      lastReceiptId: null,
    });
  });

  it('initializes a conditional unavailable capability as not configured', () => {
    const provider = new MockProvider(() => NOW);
    Object.defineProperty(provider, 'capabilities', {
      value: {
        ...provider.capabilities,
        capabilities: {
          ...provider.capabilities.capabilities,
          quote: {
            ...provider.capabilities.capabilities.quote,
            support: 'conditional',
            auth: 'credentials-required',
            mode: 'unavailable',
            caveats: ['Read-only credentials are not configured.'],
          },
        },
      },
    });
    const tracker = createDataStatusTracker(() => NOW);

    expect(tracker.snapshot(provider).quote).toMatchObject({
      state: 'unavailable',
      errorCategory: 'not-configured',
      provenance: null,
      sourceMode: 'unavailable',
    });
  });
});

describe('GET /api/data/status', () => {
  it('returns a versioned manifest/health response and reflects an adopted quote call', async () => {
    const app = await buildApp(new MockProvider(), { auth: { enabled: false } });
    try {
      const quote = await app.inject({ method: 'GET', url: '/api/quote/BTC-USDT' });
      expect(quote.statusCode).toBe(200);
      expect(quote.json().receipt.datasetFamily).toBe('quote');

      const response = await app.inject({ method: 'GET', url: '/api/data/status' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        schemaVersion: '1.0',
        providers: [{ providerId: 'mock' }],
        datasets: {
          quote: {
            state: 'healthy',
            errorCategory: null,
            providerId: 'mock',
            provenance: 'synthetic',
            sourceMode: 'synthetic',
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it.each([
    ['fresh', NOW - 1_000, 'healthy', null],
    ['stale', NOW - 10_001, 'degraded', 'stale'],
  ] as const)('tracks an adopted live/%s HTTP receipt end to end', async (_label, sourceAsOf, state, category) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const app = await buildApp(liveQuoteProvider(sourceAsOf), {
      auth: { enabled: false },
      logger: { level: 'silent' },
    });
    try {
      const quote = await app.inject({ method: 'GET', url: '/api/quote/BTC-USDT' });
      expect(quote.statusCode).toBe(200);
      expect(quote.json().receipt).toMatchObject({
        provenance: 'live',
        freshness: { state: _label },
      });
      const status = await app.inject({ method: 'GET', url: '/api/data/status' });
      expect(status.json().datasets.quote).toMatchObject({
        state,
        errorCategory: category,
        provenance: 'live',
        sourceMode: 'live',
      });
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });

  it('turns malformed provider evidence into a sanitized 502 and malformed status', async () => {
    const app = await buildApp(liveQuoteProvider(NOW - 1_000, true), {
      auth: { enabled: false },
      logger: { level: 'silent' },
    });
    try {
      const quote = await app.inject({ method: 'GET', url: '/api/quote/BTC-USDT' });
      expect(quote.statusCode).toBe(502);
      expect(quote.json()).toEqual({
        error: 'ProviderError',
        message: 'Internal Server Error',
        statusCode: 502,
      });
      expect(quote.body).not.toContain('LEAK_MALFORMED_PROVIDER');
      const status = await app.inject({ method: 'GET', url: '/api/data/status' });
      expect(status.json().datasets.quote).toMatchObject({
        state: 'unavailable',
        errorCategory: 'malformed-upstream',
        provenance: null,
      });
      expect(status.body).not.toContain('LEAK_MALFORMED_PROVIDER');
    } finally {
      await app.close();
    }
  });

  it('preserves a provider-detected malformed-upstream category through HTTP status', async () => {
    const provider = liveQuoteProvider(NOW - 1_000);
    provider.getQuote = async () => {
      throw new ProviderError(
        'Malformed upstream body apiKey=LEAK_TYPED_MALFORMED /home/private/provider.json',
        502,
        'BTC/USDT',
        'malformed-upstream',
      );
    };
    const app = await buildApp(provider, {
      auth: { enabled: false },
      logger: { level: 'silent' },
    });
    try {
      const quote = await app.inject({ method: 'GET', url: '/api/quote/BTC-USDT' });
      expect(quote.statusCode).toBe(502);
      expect(quote.json().message).toBe('Internal Server Error');
      expect(quote.body).not.toMatch(/LEAK_TYPED_MALFORMED|\/home\/private|apiKey=/);
      const status = await app.inject({ method: 'GET', url: '/api/data/status' });
      expect(status.json().datasets.quote).toMatchObject({
        state: 'unavailable',
        errorCategory: 'malformed-upstream',
      });
    } finally {
      await app.close();
    }
  });

  it('rejects self-consistent provider output for a different requested symbol', async () => {
    const provider = liveQuoteProvider(NOW - 1_000);
    const getQuote = provider.getQuote.bind(provider);
    provider.getQuote = async () => getQuote('ETH/USDT');
    const app = await buildApp(provider, {
      auth: { enabled: false },
      logger: { level: 'silent' },
    });
    try {
      const quote = await app.inject({ method: 'GET', url: '/api/quote/BTC-USDT' });
      expect(quote.statusCode).toBe(502);
      expect(quote.json().message).toBe('Internal Server Error');
      const status = await app.inject({ method: 'GET', url: '/api/data/status' });
      expect(status.json().datasets.quote.errorCategory).toBe('malformed-upstream');
    } finally {
      await app.close();
    }
  });

  it('inherits auth and returns only sanitized status to an authenticated caller', async () => {
    const secret = 'test-secret-at-least-16-characters';
    const app = await buildApp(new MockProvider(), {
      auth: { enabled: true, allowSignup: true, secret },
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/api/data/status' });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: 'Unauthorized' });

      const signup = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: { username: 'status-reader', password: 'correct horse battery staple' },
      });
      expect(signup.statusCode).toBe(201);
      const token = signup.json().token as string;
      const authorized = await app.inject({
        method: 'GET',
        url: '/api/data/status',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(authorized.statusCode).toBe(200);
      expect(authorized.json()).toMatchObject({ schemaVersion: '1.0' });
      const body = authorized.body;
      expect(body).not.toContain(secret);
      expect(body).not.toContain('correct horse battery staple');
      expect(body).not.toContain('apiKey');
      expect(body).not.toContain('totalValueUsd');
    } finally {
      await app.close();
    }
  });

  it('uses an explicit virtual unavailable manifest when this user has no account key', async () => {
    const app = await buildApp(new MockProvider(), {
      auth: {
        enabled: true,
        allowSignup: true,
        secret: 'test-secret-at-least-16-characters',
      },
      keyRepo: new KeyRepo('test-kms-secret-at-least-32-characters'),
      userLoops: null,
    });
    try {
      const signup = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: { username: 'unkeyed-status-reader', password: 'correct horse battery staple' },
      });
      const token = signup.json().token as string;
      const headers = { authorization: `Bearer ${token}` };
      const balances = await app.inject({ method: 'GET', url: '/api/balances', headers });
      expect(balances.statusCode).toBe(200);
      expect(balances.json().receipt).toMatchObject({
        providerId: 'per-user-keys',
        provenance: 'unavailable',
      });

      const response = await app.inject({ method: 'GET', url: '/api/data/status', headers });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.providers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ providerId: 'mock' }),
          expect.objectContaining({
            providerId: 'per-user-keys',
            capabilities: expect.objectContaining({
              balances: expect.objectContaining({
                auth: 'credentials-required',
                mode: 'unavailable',
              }),
            }),
          }),
        ]),
      );
      expect(body.datasets.balances).toMatchObject({
        providerId: 'per-user-keys',
        source: 'per-user-keys',
        provenance: 'unavailable',
        sourceMode: 'unavailable',
        state: 'unavailable',
        errorCategory: 'not-configured',
      });
    } finally {
      await app.close();
    }
  });

  it('reports configured CCXT method and parameter constraints as unsupported', async () => {
    const exchange = {
      id: 'binance',
      name: 'Binance',
      has: { fetchPositions: false, fetchMyTrades: true },
      fetchMyTrades: async (symbol?: string) => {
        if (!symbol) throw new Error('symbol argument is required');
        return [];
      },
    } as unknown as Exchange;
    const provider = new CcxtProvider(
      { exchange: 'binance', apiKey: 'configured-test-key', secret: 'configured-test-secret' },
      { exchange, now: () => NOW },
    );
    const app = await buildApp(provider, {
      auth: { enabled: false },
      // Pinned origin keeps the no-auth keyed account reads open (wildcard
      // CORS would fail them closed — see keyedAccountGuard.test.ts).
      corsOrigin: 'http://localhost:8080',
    });
    try {
      const positions = await app.inject({ method: 'GET', url: '/api/positions' });
      expect(positions.statusCode).toBe(200);
      expect(positions.json().receipt).toMatchObject({
        datasetFamily: 'account-positions',
        provenance: 'unavailable',
        note: expect.stringMatching(/does not expose a fetchPositions endpoint/i),
      });

      const fills = await app.inject({ method: 'GET', url: '/api/fills' });
      expect(fills.statusCode).toBe(200);
      expect(fills.json().receipt).toMatchObject({
        datasetFamily: 'account-fills',
        provenance: 'unavailable',
        note: expect.stringMatching(/requires a symbol for fills/i),
      });

      const status = await app.inject({ method: 'GET', url: '/api/data/status' });
      expect(status.statusCode).toBe(200);
      expect(status.json().datasets).toMatchObject({
        'account-positions': {
          state: 'unavailable',
          errorCategory: 'unsupported',
          providerId: 'ccxt',
          sourceMode: 'unavailable',
        },
        'account-fills': {
          state: 'unavailable',
          errorCategory: 'unsupported',
          providerId: 'ccxt',
          sourceMode: 'live',
        },
      });
    } finally {
      await app.close();
    }
  });
});
