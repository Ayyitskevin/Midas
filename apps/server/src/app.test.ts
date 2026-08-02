import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDataReceipt } from '@midas/shared';
import { buildApp } from './app';
import { createProvider, type DataProvider } from './providers';

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
    // The mock provider streams a synthetic random-walk, not a live feed — so the
    // client can show SIM instead of LIVE over the socket. (Only ccxt streams live.)
    expect(body.streamLive).toBe(false);
  });

  it('reports streamLive:false when the ccxt pro exchange cannot be built (never LIVE over silence)', async () => {
    // A ccxt provider named for an exchange ccxt.pro does not support has NO
    // upstream source — health must say so instead of lighting a LIVE badge
    // over a feed that can never deliver.
    const prev = process.env.MIDAS_CCXT_EXCHANGE;
    process.env.MIDAS_CCXT_EXCHANGE = 'no-such-exchange';
    let ccxtApp: FastifyInstance | undefined;
    try {
      const stub = {
        name: 'ccxt:no-such-exchange',
        live: true,
        getQuote: async (symbol: string) => ({ symbol, price: 1, changePercent: 0 }),
      } as unknown as DataProvider;
      ccxtApp = await buildApp(stub);
      await ccxtApp.ready();
      const res = await ccxtApp.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json().streamLive).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.MIDAS_CCXT_EXCHANGE;
      else process.env.MIDAS_CCXT_EXCHANGE = prev;
      await ccxtApp?.close();
    }
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
  it('returns a board envelope of funding rows with the limit honoured', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/funding?quote=USDT&limit=5' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.provenance).toBe('synthetic'); // mock is never passed off as live
    expect(body.meta.source).toBe('mock');
    expect(typeof body.meta.asOf).toBe('number');
    expect(body.meta.partial).toBe(false);
    const rows = body.rows;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(5);
    expect(rows[0]).toHaveProperty('symbol');
    expect(rows[0]).toHaveProperty('fundingRate');
    expect(rows[0]).toHaveProperty('openInterestValue');
  });
});

describe('GET /api/funding-dispersion', () => {
  it('returns cross-venue funding-dispersion rows ranked widest-spread first', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/funding-dispersion?quote=USDT&limit=5' });
    expect(res.statusCode).toBe(200);
    const rows = res.json().rows as Array<{
      symbol: string;
      venues: unknown[];
      spreadBps: number | null;
      minRate: number | null;
      maxRate: number | null;
      highVenue: string | null;
      lowVenue: string | null;
    }>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(5);
    // Every row has a real cross-venue spread (≥ 2 reporting venues) and legs.
    for (const r of rows) {
      expect(r.spreadBps).not.toBeNull();
      expect(r.venues.length).toBeGreaterThanOrEqual(2);
      expect(typeof r.highVenue).toBe('string');
      expect(typeof r.lowVenue).toBe('string');
      expect(r.maxRate! - r.minRate!).toBeGreaterThanOrEqual(0);
    }
    // Ranked widest-first — the funding-arb signal.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].spreadBps!).toBeGreaterThanOrEqual(rows[i].spreadBps!);
    }
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

  it('reports per-source status and how much of the configured set it covers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/liquidations?quote=USDT&limit=5' });
    const feed = res.json();

    // A feed without per-source coverage cannot be told apart from one venue
    // presented as the whole market — the gap this route used to have.
    expect(Array.isArray(feed.meta.sources)).toBe(true);
    expect(feed.meta.sources.length).toBeGreaterThan(0);
    expect(feed.meta.coverage.configured).toBe(feed.meta.sources.length);
    expect(feed.meta.coverage.sampled).toBeLessThanOrEqual(feed.meta.coverage.configured);
    expect(feed.meta.coverage.reporting).toBeLessThanOrEqual(feed.meta.coverage.sampled);
    expect(feed.meta.coverage.ratio).toBeCloseTo(
      feed.meta.coverage.reporting / feed.meta.coverage.configured,
      10,
    );

    for (const s of feed.meta.sources) {
      expect(typeof s.source).toBe('string');
      expect(typeof s.sampled).toBe('boolean');
      expect(typeof s.available).toBe('boolean');
      expect(typeof s.throttled).toBe('boolean');
      expect(typeof s.eventCount).toBe('number');
      // Three-state on the wire: true, false, or an explicit unknown.
      expect([true, false, null]).toContain(s.stale);
      if (s.lastEventAt === null) expect(s.ageMs).toBeNull();
      else expect(s.ageMs).toBe(feed.meta.asOf - s.lastEventAt);
      // Fabricated events are never a throttled upstream stream.
      if (s.synthetic) expect(s.throttled).toBe(false);
      // Nothing to throttle where there is no public feed.
      if (!s.available) expect(s.throttled).toBe(false);
    }

    // The app-test harness runs on the mock provider: every source must stay
    // labeled synthetic, whatever else changed.
    expect(feed.meta.synthetic).toBe(true);
    expect(feed.meta.sources.every((s: { synthetic: boolean }) => s.synthetic)).toBe(true);
  });

  it('fans out across venues: events are venue-tagged and coverage exceeds one source', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/liquidations?quote=USDT&limit=5' });
    const feed = res.json();

    // The whole point of the fan-out: more than one venue contributes.
    expect(feed.meta.coverage.configured).toBeGreaterThan(1);
    expect(feed.meta.coverage.reporting).toBeGreaterThan(1);
    expect(feed.meta.coverage.ratio).toBeGreaterThan(1 / feed.meta.coverage.configured);

    // An untagged event in a merged stream cannot be attributed or audited.
    const tagged = feed.events.map((e: { source?: string }) => e.source);
    expect(tagged.every((s: string | undefined) => typeof s === 'string' && s.length > 0)).toBe(true);
    const contributing = new Set<string>(tagged);
    expect(contributing.size).toBeGreaterThan(1);

    // Every contributing venue must appear in the declared source set.
    const declared = new Set(feed.meta.sources.map((s: { source: string }) => s.source.toLowerCase()));
    for (const source of contributing) expect(declared.has(source.toLowerCase())).toBe(true);

    // Only venues that actually reported may be counted as reporting.
    const reporting = feed.meta.sources.filter((s: { eventCount: number }) => s.eventCount > 0);
    expect(reporting.length).toBe(feed.meta.coverage.reporting);
  });

  it('states the aggregate as a lower bound and never as a fabricated multiple', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/liquidations?quote=USDT&limit=5' });
    const feed = res.json();

    expect(feed.meta.aggregate.totalValue).toBeGreaterThan(0);
    // The mock's primary venue publishes nothing, mirroring the real default —
    // so there is no finite ratio. Null, never Infinity, never invented.
    expect(feed.meta.aggregate.referenceSource).toBe('Binance');
    expect(feed.meta.aggregate.referenceValue).toBe(0);
    expect(feed.meta.aggregate.multiple).toBeNull();

    // The union must equal the sum of its parts — no scaling factor applied.
    const summed = feed.events.reduce((total: number, e: { value: number }) => total + e.value, 0);
    if (feed.events.length === feed.meta.sources.reduce((n: number, s: { eventCount: number }) => n + s.eventCount, 0)) {
      expect(feed.meta.aggregate.totalValue).toBeCloseTo(summed, 6);
    }
    expect(feed.receipt.methodology.formula).toMatch(/never averaged or deduplicated/);
    expect(feed.receipt.limitations.join(' ')).toMatch(/lower bound, never the market total/);
  });

  it('reports a source it never read as not sampled, not as zero events', async () => {
    const noFeed = createProvider('mock');
    const now = Date.parse('2026-08-01T12:00:00.000Z');
    const declaration = createDataReceipt({
      providerId: noFeed.capabilities.providerId,
      providerVersion: noFeed.capabilities.providerVersion,
      source: 'test-provider',
      datasetFamily: 'liquidations',
      provenance: 'unavailable',
      sourceAsOf: null,
      observedAt: now,
      maxAgeMs: null,
      coverage: 'public liquidation-feed capability declaration',
      limitations: ['The configured provider has no public liquidation-event source.'],
      note: 'The primary venue publishes no public liquidation feed.',
    }, now);
    noFeed.liquidationsProvenance = () => ({
      source: 'test-provider',
      available: false,
      note: 'The primary venue publishes no public liquidation feed.',
      sampledSource: 'binance',
      // Two venues configured, the sampled one publishes nothing, the other is
      // never read. Neither may report as "zero liquidations".
      sources: [
        { source: 'binance', available: false, throttled: false, synthetic: false, note: null },
        { source: 'okx', available: true, throttled: true, synthetic: false, note: null },
      ],
      receipt: declaration,
    });
    const noFeedApp = await buildApp(noFeed);
    await noFeedApp.ready();
    try {
      const res = await noFeedApp.inject({ method: 'GET', url: '/api/liquidations?quote=USDT&limit=5' });
      const feed = res.json();
      expect(feed.meta.coverage).toMatchObject({ configured: 2, sampled: 0, reporting: 0, ratio: 0 });
      for (const s of feed.meta.sources) {
        expect(s.sampled).toBe(false);
        expect(s.stale).toBeNull();
        expect(s.lastEventAt).toBeNull();
      }
    } finally {
      await noFeedApp.close();
    }
  });

  it('repairs ambiguous mock provenance at the API boundary', async () => {
    const ambiguousMock = createProvider('mock');
    const receipt = ambiguousMock.liquidationsProvenance().receipt;
    ambiguousMock.liquidationsProvenance = () => ({
      source: 'mock',
      available: true,
      receipt,
    });
    const boundaryApp = await buildApp(ambiguousMock);
    await boundaryApp.ready();

    try {
      const res = await boundaryApp.inject({
        method: 'GET',
        url: '/api/liquidations?quote=USDT&limit=1',
      });
      expect(res.statusCode).toBe(200);
      const meta = res.json().meta;
      expect(meta.source).toBe('mock');
      expect(meta.available).toBe(true);
      expect(meta.synthetic).toBe(true);
      expect(meta.note).toMatch(/synthetic|demo|not real/i);
      expect(typeof meta.asOf).toBe('number');
    } finally {
      await boundaryApp.close();
    }
  });

  it('keeps an unavailable liquidation declaration authoritative over derivatives reads', async () => {
    const unavailableProvider = createProvider('mock');
    const now = Date.parse('2026-08-01T12:00:00.000Z');
    const declaration = createDataReceipt({
      providerId: unavailableProvider.capabilities.providerId,
      providerVersion: unavailableProvider.capabilities.providerVersion,
      source: 'test-provider',
      datasetFamily: 'liquidations',
      provenance: 'unavailable',
      sourceAsOf: null,
      observedAt: now,
      maxAgeMs: null,
      coverage: 'public liquidation-feed capability declaration',
      limitations: ['The configured provider has no public liquidation-event source.'],
      note: 'Liquidation events are unavailable from this provider.',
    }, now);
    unavailableProvider.liquidationsProvenance = () => ({
      source: 'test-provider',
      available: false,
      note: 'Liquidation events are unavailable from this provider.',
      receipt: declaration,
    });
    const screen = vi.spyOn(unavailableProvider, 'screen');
    const boundaryApp = await buildApp(unavailableProvider);
    await boundaryApp.ready();

    try {
      const res = await boundaryApp.inject({
        method: 'GET',
        url: '/api/liquidations?quote=USDT&limit=1',
      });
      expect(res.statusCode).toBe(200);
      const feed = res.json();
      expect(feed.events).toEqual([]);
      expect(feed.meta.available).toBe(false);
      expect(feed.receipt.provenance).toBe('unavailable');
      expect(feed.meta.receipt.provenance).toBe('unavailable');
      expect(feed.receipt.inputReceiptIds).toContain(declaration.receiptId);
      expect(screen).not.toHaveBeenCalled();
    } finally {
      await boundaryApp.close();
    }
  });
});

describe('GET /api/venue-arb', () => {
  it('returns cross-venue arb rows ranked by price dispersion, widest first', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/venue-arb?quote=USDT&limit=5' });
    expect(res.statusCode).toBe(200);
    const rows = res.json().rows as Array<{
      symbol: string;
      venues: unknown[];
      dispersionBps: number | null;
      bestBid: { exchange: string; value: number } | null;
      bestAsk: { exchange: string; value: number } | null;
      crossed: boolean;
    }>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(5);
    for (const r of rows) {
      expect(r.dispersionBps).not.toBeNull();
      expect(r.venues.length).toBeGreaterThanOrEqual(2);
      expect(typeof r.crossed).toBe('boolean');
    }
    // Ranked widest-dispersion first.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].dispersionBps!).toBeGreaterThanOrEqual(rows[i].dispersionBps!);
    }
  });
});

describe('GET /api/oi-concentration', () => {
  it('returns cross-venue OI/crowding rows ranked by total OI, biggest first', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/oi-concentration?quote=USDT&limit=5' });
    expect(res.statusCode).toBe(200);
    const rows = res.json().rows as Array<{
      symbol: string;
      venues: unknown[];
      totalOiValue: number | null;
      topVenue: string | null;
      topVenueShare: number | null;
      herfindahl: number | null;
      venueCount: number;
    }>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(5);
    for (const r of rows) {
      expect(r.totalOiValue).not.toBeNull();
      expect(r.venueCount).toBeGreaterThanOrEqual(1);
      expect(typeof r.topVenue).toBe('string');
      expect(r.topVenueShare!).toBeGreaterThan(0);
      expect(r.topVenueShare!).toBeLessThanOrEqual(1);
      expect(r.herfindahl!).toBeGreaterThan(0);
      expect(r.herfindahl!).toBeLessThanOrEqual(1);
    }
    // Ranked biggest-total-OI first.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].totalOiValue!).toBeGreaterThanOrEqual(rows[i].totalOiValue!);
    }
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

describe('GET /api/solana/validators', () => {
  it('returns a synthetic leaderboard ranked by stake', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/solana/validators' });
    expect(res.statusCode).toBe(200);
    const v = res.json();
    expect(v.provenance).toBe('synthetic');
    expect(v.validators.length).toBeGreaterThan(5);
    expect(typeof v.totalStakeSol).toBe('number');
    for (let i = 1; i < v.validators.length; i++) {
      expect(v.validators[i].activatedStakeSol).toBeLessThanOrEqual(v.validators[i - 1].activatedStakeSol);
    }
    // shares sum to ~100%
    const shareSum = v.validators.reduce((s: number, x: { stakeSharePct: number }) => s + x.stakeSharePct, 0);
    expect(shareSum).toBeGreaterThan(95);
    expect(shareSum).toBeLessThan(105);
  });
});

describe('GET /api/solana/staking', () => {
  it('returns synthetic staking economics with sane APY bounds', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/solana/staking' });
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s.provenance).toBe('synthetic');
    expect(s.nominalApyPct).toBeGreaterThan(4);
    expect(s.nominalApyPct).toBeLessThan(12);
    expect(s.realApyPct).toBeGreaterThanOrEqual(s.nominalApyPct); // compounding
    expect(s.stakedRatioPct).toBeGreaterThan(50);
    expect(s.stakedRatioPct).toBeLessThan(80);
  });
});

describe('GET /api/solana/token/:mint', () => {
  it('returns a synthetic SPL token snapshot for a known mint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/solana/token/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    });
    expect(res.statusCode).toBe(200);
    const t = res.json();
    expect(t.provenance).toBe('synthetic');
    expect(t.symbol).toBe('USDC'); // known mint labeled
    expect(t.decimals).toBe(6);
    expect(t.supply).toBeGreaterThan(0);
    expect(typeof t.mintAuthorityActive).toBe('boolean');
    expect(t.priceUsd).toBe(1); // stablecoin pinned
  });

  it('rejects a non-base58 mint with a 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/solana/token/not-a-mint!' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/solana/quote/:input/:output/:amount', () => {
  it('returns a synthetic quote — output, impact and a route', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/solana/quote/SOL/USDC/1' });
    expect(res.statusCode).toBe(200);
    const q = res.json();
    expect(q.provenance).toBe('synthetic');
    expect(q.inputSymbol).toBe('SOL');
    expect(q.outputSymbol).toBe('USDC');
    expect(q.inAmount).toBe(1);
    expect(q.outAmount).toBeGreaterThan(0);
    expect(q.priceImpactPct).toBeGreaterThanOrEqual(0);
    expect(q.route.length).toBeGreaterThan(0);
  });

  it('is honestly unavailable for two identical tokens (no fake swap)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/solana/quote/SOL/SOL/1' });
    expect(res.statusCode).toBe(200);
    const q = res.json();
    expect(q.provenance).toBe('synthetic');
    expect(q.outAmount).toBeNull();
    expect(q.note).toMatch(/different tokens/i);
  });

  it('rejects a non-positive or non-numeric amount at the edge with 400', async () => {
    // The tokens are validated at the edge; the amount now is too, so a malformed
    // path segment never reaches the provider. (The UI only queries amount > 0.)
    for (const bad of ['0', '-5', 'abc']) {
      const res = await app.inject({ method: 'GET', url: `/api/solana/quote/SOL/USDC/${bad}` });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('GET /api/solana/market', () => {
  it('returns a synthetic ecosystem overview with a SOL price and roll-up', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/solana/market' });
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m.provenance).toBe('synthetic');
    expect(m.solPriceUsd).toBeGreaterThan(0);
    expect(m.tokens.length).toBeGreaterThan(0);
    expect(m.totalVolume24hUsd).toBeGreaterThan(0);
    // tokens sorted by 24h volume (descending)
    for (let i = 1; i < m.tokens.length; i++) {
      expect(m.tokens[i].volume24hUsd).toBeLessThanOrEqual(m.tokens[i - 1].volume24hUsd);
    }
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
