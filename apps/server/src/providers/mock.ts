import type {
  AccountFills,
  AccountPositions,
  Balances,
  CancelResult,
  CoinUniverse,
  DerivativesInfo,
  DexPools,
  DvolSnapshot,
  DvolSymbol,
  FundingHistoryPoint,
  HistoryResponse,
  LiquidationsProvenance,
  NewsItem,
  OiDelta,
  OiDeltaWindow,
  OpenOrders,
  OptionsChain,
  OrderBook,
  Quote,
  ScreenerRow,
  SearchResult,
  SolanaMarket,
  SolanaNetwork,
  SolanaStaking,
  SolanaSwapQuote,
  SolanaTokenInfo,
  SolanaTrending,
  SolanaValidators,
  SolanaWallet,
  TermStructure,
  VenueDerivatives,
  VenueLiquidations,
  VenueScreen,
  VenueQuote,
} from '@midas/shared';
import type { DataProvider, HistoryOptions, ScreenerOptions } from './types';
import { ProviderError } from './types';
import {
  buildProviderCapabilities,
  providerReceipt,
  withProviderDerivedReceipt,
  withProviderReceipt,
  type CapabilityDefinition,
} from './receipts';
import {
  mockExchangeQuotes,
  mockFundingHistory,
  mockHistory,
  mockNews,
  mockOrderBook,
  mockQuote,
  mockQuotes,
  mockScreen,
  mockVenueScreen,
  mockSearch,
} from './mock/market';
import {
  mockDerivatives,
  mockDexPools,
  mockLiquidationsProvenance,
  mockVenueDerivatives,
  mockVenueLiquidations,
} from './mock/derivatives';
import {
  mockSolanaDexPools,
  mockSolanaMarket,
  mockSolanaNetwork,
  mockSolanaQuote,
  mockSolanaStaking,
  mockSolanaToken,
  mockSolanaTrending,
  mockSolanaValidators,
  mockSolanaWallet,
} from './mock/solana';
import { mockBalances, mockFills, mockOpenOrders, mockPositions } from './mock/account';
import { mockCoinUniverse } from './mock/coins';
import { mockDvol, mockOptionsChain, mockTermStructure } from './mock/options';
import { mockOiDelta } from './mock/oiDelta';

export const MOCK_PROVIDER_VERSION = '1.0.0';

const syntheticCapability = (
  method: string,
  coverage: string,
  expectedCadenceMs: number | null,
  maxAgeMs: number | null,
  methodologyId = 'midas.mock.seeded',
): CapabilityDefinition => ({
  method,
  support: 'supported',
  auth: 'none',
  mode: 'synthetic',
  venue: null,
  coverage,
  expectedCadenceMs,
  maxAgeMs,
  cacheTtlMs: null,
  methodology: { id: methodologyId, version: '1.0.0', formula: null },
  caveats: ['Deterministic synthetic fixture data; never real market or account evidence.'],
});

const MOCK_CAPABILITIES = buildProviderCapabilities({
  providerId: 'mock',
  providerVersion: MOCK_PROVIDER_VERSION,
  source: 'mock',
  capabilities: {
    quote: syntheticCapability('getQuote', 'curated symbols plus deterministic symbol fallback', 60_000, 120_000),
    history: syntheticCapability('getHistory', 'requested symbol, interval and range', null, null),
    funding: syntheticCapability('getDerivatives', 'funding projection from synthetic derivatives snapshot', 3_600_000, 7_200_000),
    'funding-history': syntheticCapability('getFundingHistory', 'up to 500 synthetic 8h settlements', 28_800_000, 57_600_000),
    'open-interest': syntheticCapability('getDerivatives', 'OI projection from synthetic derivatives snapshot', 3_600_000, 7_200_000),
    'open-interest-history': syntheticCapability('getOiDelta', '48 synthetic observations per requested window', null, null),
    'open-interest-delta': syntheticCapability('getOiDelta', '1h, 4h, 24h and 7d windows', null, null, 'midas.oi-delta'),
    derivatives: syntheticCapability('getDerivatives', 'funding, OI and liquidation bundle', 60_000, 120_000),
    'venue-derivatives': syntheticCapability('getVenueDerivatives', 'configured mock compare venues', 60_000, 120_000),
    liquidations: syntheticCapability('liquidationsProvenance|getDerivatives', 'fabricated recent events for panel exercise', 60_000, 120_000),
    'venue-screener': syntheticCapability('getVenueScreen', 'configured mock compare venues', 60_000, 120_000),
    'venue-quotes': syntheticCapability('getExchangeQuotes', 'configured mock compare venues', 60_000, 120_000),
    'venue-arbitrage': {
      ...syntheticCapability('getExchangeQuotes', 'derived from synthetic venue quotes', 60_000, 120_000),
      methodology: {
        id: 'midas.venue-arbitrage-top-of-book',
        version: '1.0',
        formula: 'grossBps = (bestBid - bestAsk) / bestAsk * 10000; netBps = grossBps - referenceTakerFeesBps',
      },
    },
    options: syntheticCapability('getDvol|getFuturesTermStructure|getOptionsChain', 'synthetic BTC/ETH-style options surfaces', 3_600_000, 7_200_000, 'midas.mock.options'),
    balances: syntheticCapability('getBalances', 'fixed synthetic demo account', 60_000, 120_000),
    'account-orders': syntheticCapability('getOpenOrders', 'fixed synthetic demo account', 60_000, 120_000),
    'account-positions': syntheticCapability('getPositions', 'fixed synthetic demo account', 60_000, 120_000),
    'account-fills': syntheticCapability('getFills', 'fixed synthetic demo account', 60_000, 120_000),
  },
});

/**
 * Deterministic synthetic data provider. Prices wiggle minute-to-minute (so the
 * terminal feels alive) but are stable within a given minute, and historical
 * series are fully reproducible for a (symbol, interval, range) triple.
 *
 * The provider is stateless except for one thing: demo orders canceled through
 * {@link MockProvider.cancelOrder} stay canceled for the life of the instance,
 * so the cancel-only posture behaves like a real account (cancel → the order
 * leaves the open-orders list; a repeated cancel is an honest 409).
 */
export class MockProvider implements DataProvider {
  readonly name = 'mock';
  readonly live = false;
  readonly capabilities = MOCK_CAPABILITIES;
  /** Demo-order ids canceled through this instance (keeps the demo book honest). */
  private readonly canceledDemoOrders = new Set<string>();

  constructor(private readonly now: () => number = Date.now) {}

  async getQuote(symbol: string): Promise<Quote> {
    const quote = await mockQuote(symbol);
    return withProviderReceipt(this, quote, {
      datasetFamily: 'quote',
      instrument: quote.symbol,
      venue: quote.exchange,
      provenance: 'synthetic',
      sourceAsOf: quote.asOf,
      units: { price: quote.currency, volume: 'base-asset' },
      note: 'Synthetic quote for offline/demo use — not real market data.',
    }, this.now());
  }
  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const quotes = await mockQuotes(symbols);
    return quotes.map((quote) => withProviderReceipt(this, quote, {
      datasetFamily: 'quote',
      instrument: quote.symbol,
      venue: quote.exchange,
      provenance: 'synthetic',
      sourceAsOf: quote.asOf,
      units: { price: quote.currency, volume: 'base-asset' },
      note: 'Synthetic quote for offline/demo use — not real market data.',
    }, this.now()));
  }
  getOrderBook(symbol: string, depth = 25): Promise<OrderBook> {
    return mockOrderBook(symbol, depth);
  }
  async getExchangeQuotes(symbol: string): Promise<VenueQuote[]> {
    const rows = await mockExchangeQuotes(symbol);
    return rows.map((row) => withProviderReceipt(this, row, {
      datasetFamily: 'venue-quotes',
      instrument: symbol.toUpperCase(),
      venue: row.exchange,
      provenance: 'synthetic',
      sourceAsOf: row.timestamp,
      units: { price: 'quote-asset', bid: 'quote-asset', ask: 'quote-asset', volume: 'base-asset' },
      note: 'Synthetic venue quote for offline/demo use — not real market data.',
    }, this.now()));
  }
  async getVenueDerivatives(symbol: string): Promise<VenueDerivatives[]> {
    const rows = await mockVenueDerivatives(symbol);
    return rows.map((row) => withProviderReceipt(this, row, {
      datasetFamily: 'venue-derivatives',
      instrument: symbol.toUpperCase(),
      venue: row.exchange,
      provenance: 'synthetic',
      sourceAsOf: row.timestamp,
      units: { fundingRate: 'fraction-per-interval', openInterestValue: 'quote-asset', markPrice: 'quote-asset' },
      note: 'Synthetic venue derivatives for offline/demo use — not real market data.',
    }, this.now()));
  }
  async getVenueScreen(opts: ScreenerOptions): Promise<VenueScreen[]> {
    const rows = await mockVenueScreen(opts);
    return rows.map((row) => withProviderReceipt(this, row, {
      datasetFamily: 'venue-screener',
      venue: row.exchange,
      provenance: 'synthetic',
      sourceAsOf: row.timestamp,
      coverage: `${row.rows.length} synthetic pair(s) for this venue`,
      units: { price: 'quote-asset', volume: 'base-asset', quoteVolume: 'quote-asset' },
      note: 'Synthetic venue screener for offline/demo use — not real market data.',
    }, this.now()));
  }
  async getVenueLiquidations(symbol: string): Promise<VenueLiquidations[]> {
    const rows = await mockVenueLiquidations(symbol);
    return rows.map((row) => withProviderReceipt(this, row, {
      datasetFamily: 'liquidations',
      instrument: symbol.toUpperCase(),
      venue: row.exchange,
      // Synthetic even where the fixture has no feed: an 'unavailable' venue in
      // a fabricated world is still fabricated, and must never read as evidence
      // that a real venue went dark.
      provenance: 'synthetic',
      sourceAsOf: row.timestamp,
      coverage: row.available
        ? `${row.liquidations.length} fabricated liquidation event(s)`
        : 'venue publishes no liquidation feed in the mock fixture',
      units: { price: 'quote-asset', amount: 'base-asset' },
      note: 'Synthetic venue liquidations for offline/demo use — not real market data.',
    }, this.now()));
  }
  async getDerivatives(symbol: string): Promise<DerivativesInfo> {
    const value = await mockDerivatives(symbol);
    return withProviderReceipt(this, value, {
      datasetFamily: 'derivatives',
      instrument: value.symbol,
      provenance: 'synthetic',
      sourceAsOf: value.timestamp,
      coverage: 'funding, open interest and fabricated recent liquidations',
      units: { fundingRate: 'fraction-per-interval', openInterest: 'base-asset', openInterestValue: 'quote-asset', price: 'quote-asset' },
      note: 'Synthetic derivatives snapshot for offline/demo use — not real market data.',
    }, this.now());
  }
  liquidationsProvenance(): LiquidationsProvenance {
    const value = mockLiquidationsProvenance();
    return {
      ...value,
      receipt: providerReceipt(this, {
        datasetFamily: 'liquidations',
        provenance: 'synthetic',
        sourceAsOf: null,
        coverage: 'fabricated event availability declaration',
        units: { amount: 'base-asset', price: 'quote-asset' },
        limitations: ['No upstream/source timestamp exists for fabricated availability metadata.'],
        note: value.note ?? 'Synthetic liquidations are not real market data.',
      }, this.now()),
    };
  }
  getDexPools(symbol: string): Promise<DexPools> {
    return mockDexPools(symbol);
  }
  getSolanaNetwork(): Promise<SolanaNetwork> {
    return mockSolanaNetwork();
  }
  getSolanaWallet(address: string): Promise<SolanaWallet> {
    return mockSolanaWallet(address);
  }
  getSolanaTrending(): Promise<SolanaTrending> {
    return mockSolanaTrending();
  }
  getSolanaDexPools(symbol: string): Promise<DexPools> {
    return mockSolanaDexPools(symbol);
  }
  getSolanaValidators(): Promise<SolanaValidators> {
    return mockSolanaValidators();
  }
  getSolanaStaking(): Promise<SolanaStaking> {
    return mockSolanaStaking();
  }
  getSolanaToken(mint: string): Promise<SolanaTokenInfo> {
    return mockSolanaToken(mint);
  }
  getSolanaQuote(input: string, output: string, amount: number): Promise<SolanaSwapQuote> {
    return mockSolanaQuote(input, output, amount);
  }
  getSolanaMarket(): Promise<SolanaMarket> {
    return mockSolanaMarket();
  }
  async getBalances(): Promise<Balances> {
    const value = await mockBalances();
    return withProviderReceipt(this, value, {
      datasetFamily: 'balances',
      provenance: value.provenance,
      sourceAsOf: value.asOf,
      units: { free: 'asset-units', used: 'asset-units', total: 'asset-units', valueUsd: 'USD' },
      note: value.note,
    }, value.asOf);
  }
  async getOpenOrders(): Promise<OpenOrders> {
    const snapshot = await mockOpenOrders();
    const value = this.canceledDemoOrders.size === 0
      ? snapshot
      : { ...snapshot, orders: snapshot.orders.filter((o) => !this.canceledDemoOrders.has(o.id)) };
    return withProviderReceipt(this, value, {
      datasetFamily: 'account-orders',
      provenance: value.provenance,
      sourceAsOf: value.asOf,
      units: { price: 'quote-asset', amount: 'base-asset', filled: 'base-asset', value: 'quote-asset' },
      note: value.note,
    }, value.asOf);
  }
  /**
   * Deterministic hermetic cancel for the demo book: removes the order from
   * this instance's synthetic open-orders fixture, with an honest 409 for an
   * id the fixture doesn't hold (or already canceled) — the same
   * "no longer open" outcome the ccxt provider maps from a real exchange.
   */
  async cancelOrder(id: string, symbol: string): Promise<CancelResult> {
    const open = (await mockOpenOrders()).orders.some((o) => o.id === id);
    if (!open || this.canceledDemoOrders.has(id)) {
      throw new ProviderError(
        `Order ${id} on ${symbol} is no longer open — already filled or canceled (or never a demo order).`,
        409,
      );
    }
    this.canceledDemoOrders.add(id);
    return { id, symbol, status: 'canceled' };
  }
  async getPositions(): Promise<AccountPositions> {
    const value = await mockPositions();
    return withProviderReceipt(this, value, {
      datasetFamily: 'account-positions',
      provenance: value.provenance,
      sourceAsOf: value.asOf,
      units: { contracts: 'contracts-or-base', notionalUsd: 'USD', price: 'quote-asset', unrealizedPnlUsd: 'USD' },
      note: value.note,
    }, value.asOf);
  }
  async getFills(symbol?: string): Promise<AccountFills> {
    const value = await mockFills(symbol);
    return withProviderReceipt(this, value, {
      datasetFamily: 'account-fills',
      instrument: symbol ?? null,
      provenance: value.provenance,
      sourceAsOf: value.asOf,
      units: { price: 'quote-asset', amount: 'base-asset', cost: 'quote-asset', fee: 'fee-currency' },
      note: value.note,
    }, value.asOf);
  }
  async getFundingHistory(symbol: string, limit: number): Promise<FundingHistoryPoint[]> {
    const points = await mockFundingHistory(symbol, limit);
    return points.map((point) => withProviderReceipt(this, point, {
      datasetFamily: 'funding-history',
      instrument: symbol.toUpperCase(),
      provenance: 'synthetic',
      sourceAsOf: point.time,
      units: { fundingRate: 'fraction-per-settlement', fundingIntervalHours: 'hours' },
      note: 'Synthetic funding history for offline/demo use — not real market data.',
    }, this.now()));
  }
  async getDvol(symbol: DvolSymbol): Promise<DvolSnapshot> {
    const value = await mockDvol(symbol);
    return withProviderReceipt(this, value, {
      datasetFamily: 'options',
      instrument: symbol,
      provenance: value.provenance,
      sourceAsOf: value.asOf,
      coverage: 'synthetic DVOL level and 30-day history',
      units: { value: 'annualized-volatility-percent' },
      note: value.note,
    }, this.now());
  }
  async getFuturesTermStructure(symbol: string): Promise<TermStructure> {
    const value = await mockTermStructure(symbol);
    const rawInput = providerReceipt(this, {
      datasetFamily: 'options',
      instrument: value.underlying,
      provenance: value.provenance,
      sourceAsOf: value.asOf,
      coverage: 'raw synthetic futures and reference prices',
      units: { price: 'USD' },
      note: value.note,
    }, this.now());
    return withProviderDerivedReceipt(this, value, {
      datasetFamily: 'options',
      instrument: value.underlying,
      provenance: value.provenance,
      inputReceipts: [rawInput],
      sourceAsOf: value.asOf,
      coverage: 'synthetic dated-futures term structure',
      units: { price: 'USD', annualizedBasisPct: 'percent' },
      methodology: { id: 'midas.annualized-simple-basis', version: '1.0.0', formula: '(F/S - 1) * 365/days * 100' },
      note: value.note,
    }, this.now());
  }
  async getOptionsChain(symbol: string, expiry?: number | 'nearest'): Promise<OptionsChain> {
    const value = await mockOptionsChain(symbol, expiry);
    const rawInput = providerReceipt(this, {
      datasetFamily: 'options',
      instrument: value.underlying,
      provenance: value.provenance,
      sourceAsOf: value.asOf,
      coverage: 'raw synthetic option marks and open interest',
      units: { strike: 'USD', openInterest: 'contracts', mark: 'USD', iv: 'percent' },
      note: value.note,
    }, this.now());
    return withProviderDerivedReceipt(this, value, {
      datasetFamily: 'options',
      instrument: value.underlying,
      provenance: value.provenance,
      inputReceipts: [rawInput],
      sourceAsOf: value.asOf,
      coverage: 'synthetic options chain with derived max pain and put/call OI ratio',
      units: { strike: 'USD', openInterest: 'contracts', mark: 'USD', iv: 'percent' },
      methodology: { id: 'midas.options-chain-summary', version: '1.0.0', formula: 'max-pain payout minimization; put OI / call OI' },
      note: value.note,
    }, this.now());
  }
  async getOiDelta(symbol: string, window: OiDeltaWindow): Promise<OiDelta> {
    const value = await mockOiDelta(symbol, window);
    const oiInput = providerReceipt(this, {
      datasetFamily: 'open-interest-history',
      instrument: value.symbol,
      provenance: value.provenance,
      sourceAsOf: value.asOf,
      coverage: `${window} synthetic OI history`,
      units: { openInterestValue: 'quote-asset' },
      note: value.note,
    }, this.now());
    const priceInput = providerReceipt(this, {
      datasetFamily: 'history',
      instrument: value.symbol,
      provenance: value.provenance,
      sourceAsOf: value.asOf,
      coverage: `${window} synthetic price history`,
      units: { price: 'quote-asset' },
      note: value.note,
    }, this.now());
    return withProviderDerivedReceipt(this, value, {
      datasetFamily: 'open-interest-delta',
      instrument: value.symbol,
      provenance: value.provenance,
      inputReceipts: [oiInput, priceInput],
      sourceAsOf: value.asOf,
      coverage: `${window} synthetic OI/price alignment`,
      units: { openInterestValue: 'quote-asset', price: 'quote-asset', change: 'percent' },
      methodology: { id: 'midas.oi-delta', version: '1.0.0', formula: '(now/then - 1) * 100; quadrant(sign(ΔOI), sign(Δprice))' },
      note: value.note,
    }, this.now());
  }
  screen(opts: ScreenerOptions): Promise<ScreenerRow[]> {
    return mockScreen(opts);
  }
  async getHistory(symbol: string, opts: HistoryOptions): Promise<HistoryResponse> {
    const value = await mockHistory(symbol, opts);
    const last = value.candles.at(-1);
    return withProviderReceipt(this, value, {
      datasetFamily: 'history',
      instrument: value.symbol,
      provenance: 'synthetic',
      sourceAsOf: last == null ? null : last.time * 1000,
      coverage: `${value.interval} candles over ${value.range}`,
      units: { time: 'unix-seconds', ohlc: value.currency, volume: 'base-asset' },
      limitations: last == null ? ['No candles were generated; source as-of is unknown.'] : [],
      note: 'Synthetic price history for offline/demo use — not real market data.',
    }, this.now());
  }
  search(query: string): Promise<SearchResult[]> {
    return mockSearch(query);
  }
  getNews(symbol?: string): Promise<NewsItem[]> {
    return mockNews(symbol);
  }
  getCoinUniverse(limit: number): Promise<CoinUniverse> {
    return mockCoinUniverse(limit);
  }
}
