import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Exchange } from 'ccxt';
import { CcxtProvider } from './ccxt';
import { runProviderConformanceKit, type ProviderConformanceProbe } from './conformanceKit';
import { createProvider } from './index';
import { MockProvider } from './mock';
import { YahooProvider } from './yahoo';

const NOW = Date.parse('2026-08-01T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ROUTE_DERIVED_FAMILY_EVIDENCE = {
  funding: 'Projected from a derivatives receipt and checked by dataCoverage.test and boardEnvelopes.test.',
  'open-interest': 'Projected from a derivatives receipt and checked by dataCoverage.test and boardEnvelopes.test.',
  'open-interest-history': 'Consumed inside the OI-delta derivation checked by oiDelta.test and dataCoverage.test.',
  'venue-arbitrage': 'Derived from venue-quote receipts and checked by venueArb.test and boardEnvelopes.test.',
} as const;

afterEach(() => {
  vi.useRealTimers();
});

function yahooChartResponse(): Response {
  return new Response(JSON.stringify({
    chart: {
      result: [{
        meta: {
          symbol: 'AAPL',
          currency: 'USD',
          regularMarketPrice: 200,
          chartPreviousClose: 190,
          regularMarketVolume: 1_000,
          regularMarketTime: Math.floor((NOW - 1_000) / 1_000),
        },
        timestamp: [Math.floor((NOW - 60_000) / 1_000), Math.floor(NOW / 1_000)],
        indicators: {
          quote: [{
            open: [190, 195],
            high: [201, 202],
            low: [189, 194],
            close: [198, 200],
            volume: [10, 20],
          }],
        },
      }],
      error: null,
    },
  }), { status: 200 });
}

function ccxtFixture(): { provider: CcxtProvider; malformed: CcxtProvider } {
  const perp = 'BTC/USDT:USDT';
  const primary = {
    id: 'binance',
    name: 'Binance',
    timeframes: { '5m': 1 },
    has: {
      fetchOHLCV: true,
      fetchFundingRate: true,
      fetchFundingRateHistory: true,
      fetchOpenInterest: true,
      fetchOpenInterestHistory: true,
      fetchBalance: true,
      fetchOpenOrders: true,
      fetchPositions: true,
      fetchMyTrades: true,
    },
    fetchTicker: async (symbol: string) => ({
      symbol,
      last: 65_000,
      previousClose: 64_000,
      percentage: 1.5625,
      bid: 64_990,
      ask: 65_010,
      bidVolume: 2,
      askVolume: 3,
      baseVolume: 100,
      timestamp: NOW - 1_000,
    }),
    fetchOHLCV: async () => [
      [NOW - HOUR, 64_000, 64_100, 63_900, 64_000, 10],
      [NOW, 65_000, 65_100, 64_900, 65_000, 12],
    ],
    fetchFundingRate: async () => ({
      fundingRate: 0.0001,
      interval: '8h',
      fundingTimestamp: NOW + 8 * HOUR,
      markPrice: 65_000,
      indexPrice: 64_990,
      timestamp: NOW - 1_000,
    }),
    fetchFundingRateHistory: async () => [{
      timestamp: NOW - 8 * HOUR,
      fundingRate: 0.0001,
      interval: '8h',
    }],
    fetchOpenInterest: async () => ({
      openInterestAmount: 10,
      openInterestValue: 650_000,
      timestamp: NOW - 1_000,
    }),
    fetchOpenInterestHistory: async () => [
      { timestamp: NOW - HOUR, openInterestValue: 600_000 },
      { timestamp: NOW, openInterestValue: 650_000 },
    ],
    fetchBalance: async () => ({
      timestamp: NOW - 1_000,
      total: { USDT: 100 },
      free: { USDT: 100 },
      used: { USDT: 0 },
    }),
    fetchOpenOrders: async () => [{
      id: 'o1', symbol: 'BTC/USDT', side: 'buy', type: 'limit', status: 'open',
      price: 60_000, amount: 0.1, filled: 0, remaining: 0.1, timestamp: NOW - 1_000,
    }],
    fetchPositions: async () => [{
      symbol: perp, side: 'long', contracts: 0.1, notional: 6_500,
      entryPrice: 64_000, markPrice: 65_000, unrealizedPnl: 100,
    }],
    fetchMyTrades: async () => [{
      id: 'f1', order: 'o1', symbol: 'BTC/USDT', side: 'buy',
      price: 64_000, amount: 0.1, cost: 6_400, timestamp: NOW - 1_000,
    }],
  } as unknown as Exchange;

  const futureSymbol = 'BTC/USD:BTC-FUT';
  const callSymbol = 'BTC/USD:BTC-OPT-C';
  const putSymbol = 'BTC/USD:BTC-OPT-P';
  const expiry = NOW + 7 * DAY;
  const markets = {
    [perp]: { symbol: perp, base: 'BTC', swap: true, active: true },
    [futureSymbol]: {
      symbol: futureSymbol, base: 'BTC', future: true, swap: false, active: true, expiry,
    },
    [callSymbol]: {
      symbol: callSymbol, base: 'BTC', option: true, active: true,
      expiry, strike: 65_000, optionType: 'call',
    },
    [putSymbol]: {
      symbol: putSymbol, base: 'BTC', option: true, active: true,
      expiry, strike: 65_000, optionType: 'put',
    },
  };
  const deribit = {
    id: 'deribit',
    name: 'Deribit',
    has: { fetchOptionChain: true },
    markets,
    loadMarkets: async () => markets,
    publicGetGetVolatilityIndexData: async () => ({
      result: { data: [[NOW - DAY, 50, 52, 49, 51], [NOW, 51, 54, 50, 53]] },
    }),
    fetchTickers: async () => ({
      [perp]: { last: 65_000, timestamp: NOW - 1_000 },
      [futureSymbol]: { last: 65_500, timestamp: NOW - 1_000 },
    }),
    fetchOptionChain: async () => ({
      [callSymbol]: {
        openInterest: 100, markPrice: 0.01, underlyingPrice: 65_000,
        timestamp: NOW - 1_000, info: { mark_iv: 55 },
      },
      [putSymbol]: {
        openInterest: 90, markPrice: 0.012, underlyingPrice: 65_000,
        timestamp: NOW - 1_000, info: { mark_iv: 56 },
      },
    }),
  } as unknown as Exchange;

  const provider = new CcxtProvider(
    { exchange: 'binance', apiKey: 'fixture-key', secret: 'fixture-secret' },
    { exchange: primary, compareExchanges: [primary], deribit, now: () => NOW },
  );
  const malformedExchange = {
    id: 'binance',
    name: 'Binance',
    has: {},
    fetchTicker: async () => {
      const error = new Error('GET https://private.invalid?signature=private-value');
      error.name = 'AuthenticationError';
      throw error;
    },
  } as unknown as Exchange;
  const malformed = new CcxtProvider(undefined, {
    exchange: malformedExchange,
    compareExchanges: [],
    deribit: {} as Exchange,
    now: () => NOW,
  });
  return { provider, malformed };
}

describe('provider capability conformance', () => {
  const venueArbitrageMethodology = {
    id: 'midas.venue-arbitrage-top-of-book',
    version: '1.0',
    formula: 'grossBps = (bestBid - bestAsk) / bestAsk * 10000; netBps = grossBps - referenceTakerFeesBps',
  };

  it('fails closed on an unknown provider id instead of silently selecting synthetic data', () => {
    expect(() => createProvider('m0ck-typo')).toThrow(/Unknown data provider/);
  });

  it('runs the reusable deterministic contract against every active Mock method', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const provider = new MockProvider(() => NOW);
    expect(provider.capabilities.capabilities['venue-arbitrage'].methodology)
      .toEqual(venueArbitrageMethodology);
    const probes: ProviderConformanceProbe[] = [
      { label: 'quote', methods: ['getQuote'], datasetFamily: 'quote', expectation: 'receipt', run: () => provider.getQuote('BTC/USDT') },
      { label: 'history', methods: ['getHistory'], datasetFamily: 'history', expectation: 'receipt', run: () => provider.getHistory('BTC/USDT', { interval: '5m', range: '1d' }) },
      { label: 'derivatives', methods: ['getDerivatives'], datasetFamily: 'derivatives', expectation: 'receipt', run: () => provider.getDerivatives('BTC/USDT') },
      { label: 'liquidations declaration', methods: ['liquidationsProvenance'], datasetFamily: 'liquidations', expectation: 'receipt', run: () => provider.liquidationsProvenance() },
      { label: 'venue derivatives', methods: ['getVenueDerivatives'], datasetFamily: 'venue-derivatives', expectation: 'receipt', run: () => provider.getVenueDerivatives('BTC/USDT') },
      { label: 'venue quotes', methods: ['getExchangeQuotes'], datasetFamily: 'venue-quotes', expectation: 'receipt', run: () => provider.getExchangeQuotes('BTC/USDT') },
      { label: 'funding history', methods: ['getFundingHistory'], datasetFamily: 'funding-history', expectation: 'receipt', run: () => provider.getFundingHistory('BTC/USDT', 2) },
      { label: 'OI delta', methods: ['getOiDelta'], datasetFamily: 'open-interest-delta', expectation: 'receipt', run: () => provider.getOiDelta('BTC/USDT', '24h') },
      { label: 'DVOL', methods: ['getDvol'], datasetFamily: 'options', expectation: 'receipt', run: () => provider.getDvol('BTC') },
      { label: 'term structure', methods: ['getFuturesTermStructure'], datasetFamily: 'options', expectation: 'receipt', run: () => provider.getFuturesTermStructure('BTC') },
      { label: 'options chain', methods: ['getOptionsChain'], datasetFamily: 'options', expectation: 'receipt', run: () => provider.getOptionsChain('BTC') },
      { label: 'balances', methods: ['getBalances'], datasetFamily: 'balances', expectation: 'receipt', run: () => provider.getBalances() },
      { label: 'orders', methods: ['getOpenOrders'], datasetFamily: 'account-orders', expectation: 'receipt', run: () => provider.getOpenOrders() },
      { label: 'positions', methods: ['getPositions'], datasetFamily: 'account-positions', expectation: 'receipt', run: () => provider.getPositions() },
      { label: 'fills', methods: ['getFills'], datasetFamily: 'account-fills', expectation: 'receipt', run: () => provider.getFills('BTC/USDT') },
    ];
    const report = await runProviderConformanceKit({
      provider,
      nowMs: NOW,
      probes,
      routeDerivedFamilyEvidence: ROUTE_DERIVED_FAMILY_EVIDENCE,
    });
    expect(report.providerId).toBe('mock');
    expect(report.receiptsChecked).toBeGreaterThan(probes.length);
    expect(report.issues).toEqual([]);
  });

  it('fails when an active capability family has neither a direct probe nor route evidence', async () => {
    const provider = new MockProvider(() => NOW);
    const report = await runProviderConformanceKit({ provider, nowMs: NOW, probes: [] });
    expect(report.issues).toContain(
      'active capability family was neither probed nor explicitly route-derived: funding',
    );
  });

  it('runs live, unavailable, and malformed Yahoo scenarios without network access', async () => {
    const provider = new YahooProvider({
      now: () => NOW,
      fetch: (async () => yahooChartResponse()) as typeof globalThis.fetch,
    });
    const malformed = new YahooProvider({
      now: () => NOW,
      fetch: (async () => {
        throw new Error('Bearer private-token-value');
      }) as typeof globalThis.fetch,
    });
    const probes: ProviderConformanceProbe[] = [
      { label: 'Yahoo quote', methods: ['getQuote'], datasetFamily: 'quote', expectation: 'receipt', run: () => provider.getQuote('AAPL') },
      { label: 'Yahoo history', methods: ['getHistory'], datasetFamily: 'history', expectation: 'receipt', run: () => provider.getHistory('AAPL', { interval: '1m', range: '1d' }) },
      { label: 'Yahoo unsupported liquidation', methods: ['liquidationsProvenance'], datasetFamily: 'liquidations', expectation: 'unavailable', run: () => provider.liquidationsProvenance() },
      { label: 'Yahoo transport error', methods: [], expectation: 'error', run: () => malformed.getQuote('AAPL') },
    ];
    const report = await runProviderConformanceKit({ provider, nowMs: NOW, probes });
    expect(report.providerId).toBe('yahoo');
    expect(report.receiptsChecked).toBe(3);
    expect(report.issues).toEqual([]);
  });

  it('runs every runtime-active CCXT method plus a sanitized failure hermetically', async () => {
    const { provider, malformed } = ccxtFixture();
    expect(provider.capabilities.capabilities['venue-arbitrage'].methodology)
      .toEqual(venueArbitrageMethodology);
    for (const capability of Object.values(provider.capabilities.capabilities)) {
      if (capability.mode !== 'live') continue;
      expect(capability.expectedCadenceMs, capability.datasetFamily).not.toBeNull();
      expect(capability.maxAgeMs, capability.datasetFamily).not.toBeNull();
    }
    const probes: ProviderConformanceProbe[] = [
      { label: 'CCXT quote', methods: ['getQuote'], datasetFamily: 'quote', expectation: 'receipt', run: () => provider.getQuote('BTC/USDT') },
      { label: 'CCXT history', methods: ['getHistory'], datasetFamily: 'history', expectation: 'receipt', run: () => provider.getHistory('BTC/USDT', { interval: '5m', range: '1d' }) },
      { label: 'CCXT derivatives', methods: ['getDerivatives'], datasetFamily: 'derivatives', expectation: 'receipt', run: () => provider.getDerivatives('BTC/USDT') },
      { label: 'CCXT liquidation declaration', methods: ['liquidationsProvenance'], datasetFamily: 'liquidations', expectation: 'unavailable', run: () => provider.liquidationsProvenance() },
      { label: 'CCXT venue derivatives', methods: ['getVenueDerivatives'], datasetFamily: 'venue-derivatives', expectation: 'receipt', run: () => provider.getVenueDerivatives('BTC/USDT') },
      { label: 'CCXT venue quotes', methods: ['getExchangeQuotes'], datasetFamily: 'venue-quotes', expectation: 'receipt', run: () => provider.getExchangeQuotes('BTC/USDT') },
      { label: 'CCXT funding history', methods: ['getFundingHistory'], datasetFamily: 'funding-history', expectation: 'receipt', run: () => provider.getFundingHistory('BTC/USDT', 2) },
      { label: 'CCXT OI delta', methods: ['getOiDelta'], datasetFamily: 'open-interest-delta', expectation: 'receipt', run: () => provider.getOiDelta('BTC/USDT', '1h') },
      { label: 'CCXT DVOL', methods: ['getDvol'], datasetFamily: 'options', expectation: 'receipt', run: () => provider.getDvol('BTC') },
      { label: 'CCXT term structure', methods: ['getFuturesTermStructure'], datasetFamily: 'options', expectation: 'receipt', run: () => provider.getFuturesTermStructure('BTC') },
      { label: 'CCXT options chain', methods: ['getOptionsChain'], datasetFamily: 'options', expectation: 'receipt', run: () => provider.getOptionsChain('BTC') },
      { label: 'CCXT balances', methods: ['getBalances'], datasetFamily: 'balances', expectation: 'receipt', run: () => provider.getBalances() },
      { label: 'CCXT orders', methods: ['getOpenOrders'], datasetFamily: 'account-orders', expectation: 'receipt', run: () => provider.getOpenOrders() },
      { label: 'CCXT positions', methods: ['getPositions'], datasetFamily: 'account-positions', expectation: 'receipt', run: () => provider.getPositions() },
      { label: 'CCXT fills', methods: ['getFills'], datasetFamily: 'account-fills', expectation: 'receipt', run: () => provider.getFills('BTC/USDT') },
      { label: 'CCXT sanitized upstream error', methods: [], expectation: 'error', run: () => malformed.getQuote('BTC/USDT') },
    ];
    const report = await runProviderConformanceKit({
      provider,
      nowMs: NOW,
      probes,
      routeDerivedFamilyEvidence: ROUTE_DERIVED_FAMILY_EVIDENCE,
    });
    expect(report.providerId).toBe('ccxt');
    expect(report.receiptsChecked).toBeGreaterThanOrEqual(14);
    expect(report.issues).toEqual([]);
  });
});
