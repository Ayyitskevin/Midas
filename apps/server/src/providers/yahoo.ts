import type {
  AccountFills,
  AccountPositions,
  Balances,
  Candle,
  DerivativesInfo,
  DexPools,
  HistoryResponse,
  LiquidationsProvenance,
  MarketState,
  NewsItem,
  OpenOrders,
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
  VenueDerivatives,
  VenueQuote,
} from '@midas/shared';
import { partialEvidenceLimitation } from '@midas/shared';
import type { DataProvider, HistoryOptions, ScreenerOptions } from './types';
import { ProviderError } from './types';
import {
  buildProviderCapabilities,
  providerUnavailableReceipt,
  withProviderReceipt,
  type CapabilityDefinition,
} from './receipts';
import { INTERVAL_SECONDS } from './util';

/**
 * Live market data from Yahoo Finance's public JSON endpoints.
 *
 * This provider deliberately uses only the *crumbless* endpoints (chart +
 * search), so it works without the cookie/crumb handshake Yahoo now requires
 * for `quoteSummary`. A current-price quote is derived from the chart `meta`
 * block, which carries enough for the terminal's quote and description views.
 *
 * Note: requires outbound network access to query{1,2}.finance.yahoo.com. In
 * restricted/sandboxed environments use the `mock` provider instead.
 */
const CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SEARCH_BASE = 'https://query2.finance.yahoo.com/v1/finance/search';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const YAHOO_PROVIDER_VERSION = '1.0.0';

const unsupported = (method: string, caveat: string): CapabilityDefinition => ({
  method,
  support: 'unsupported',
  auth: 'none',
  mode: 'unavailable',
  venue: null,
  coverage: null,
  expectedCadenceMs: null,
  maxAgeMs: null,
  cacheTtlMs: null,
  methodology: null,
  caveats: [caveat],
});

const YAHOO_CAPABILITIES = buildProviderCapabilities({
  providerId: 'yahoo',
  providerVersion: YAHOO_PROVIDER_VERSION,
  source: 'yahoo',
  capabilities: {
    quote: {
      method: 'getQuote', support: 'supported', auth: 'public', mode: 'live', source: 'yahoo-chart', venue: null,
      coverage: 'Yahoo Finance symbols served by the public chart endpoint', expectedCadenceMs: 60_000,
      maxAgeMs: 300_000, cacheTtlMs: null, methodology: null,
      caveats: ['Public, unofficial endpoint availability and exchange delay vary by instrument.'],
    },
    history: {
      method: 'getHistory', support: 'supported', auth: 'public', mode: 'live', source: 'yahoo-chart', venue: null,
      coverage: 'Yahoo Finance symbols, requested interval and range', expectedCadenceMs: 60_000,
      maxAgeMs: 120_000, cacheTtlMs: null, methodology: null,
      caveats: ['Bars missing any OHLCV field are omitted rather than zero-filled.'],
    },
    funding: unsupported('getDerivatives', 'Yahoo does not publish crypto perpetual funding.'),
    'funding-history': unsupported('getFundingHistory', 'Yahoo does not publish crypto perpetual funding history.'),
    'open-interest': unsupported('getDerivatives', 'Yahoo does not publish crypto perpetual open interest.'),
    'open-interest-history': unsupported('getOiDelta', 'Yahoo does not publish crypto perpetual OI history.'),
    'open-interest-delta': unsupported('getOiDelta', 'Yahoo does not publish crypto perpetual OI history.'),
    derivatives: unsupported('getDerivatives', 'Yahoo does not provide the bundled crypto derivatives dataset.'),
    'venue-derivatives': unsupported('getVenueDerivatives', 'Yahoo does not provide cross-venue crypto derivatives.'),
    liquidations: unsupported('liquidationsProvenance', 'Yahoo does not publish crypto liquidation events.'),
    'venue-quotes': unsupported('getExchangeQuotes', 'Yahoo does not provide executable cross-venue crypto quotes.'),
    'venue-arbitrage': unsupported('getExchangeQuotes', 'Yahoo cannot supply the venue evidence required for arbitrage.'),
    options: unsupported('getDvol|getFuturesTermStructure|getOptionsChain', 'This adapter has no Yahoo options/DVOL implementation.'),
    balances: unsupported('getBalances', 'Yahoo is not an authenticated exchange-account provider.'),
    'account-orders': unsupported('getOpenOrders', 'Yahoo is not an authenticated exchange-account provider.'),
    'account-positions': unsupported('getPositions', 'Yahoo is not an authenticated exchange-account provider.'),
    'account-fills': unsupported('getFills', 'Yahoo is not an authenticated exchange-account provider.'),
  },
});

export interface YahooProviderDeps {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function finitePositiveOrNull(value: unknown): number | null {
  return isFiniteNumber(value) && value > 0 ? value : null;
}

function finiteNonNegativeOrNull(value: unknown): number | null {
  return isFiniteNumber(value) && value >= 0 ? value : null;
}

interface YahooChartMeta {
  symbol?: string;
  currency?: string;
  exchangeName?: string;
  fullExchangeName?: string;
  instrumentType?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketTime?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  longName?: string;
  shortName?: string;
  currentTradingPeriod?: {
    pre?: { start: number; end: number };
    regular?: { start: number; end: number };
    post?: { start: number; end: number };
  };
}

interface YahooChartResult {
  meta: YahooChartMeta;
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      close?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
  };
}

export class YahooProvider implements DataProvider {
  readonly name = 'yahoo';
  readonly live = true;
  readonly capabilities = YAHOO_CAPABILITIES;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly now: () => number;

  constructor(deps: YahooProviderDeps = {}) {
    this.fetchImpl = deps.fetch ?? globalThis.fetch;
    this.now = deps.now ?? Date.now;
  }

  async getQuote(symbol: string): Promise<Quote> {
    const result = await this.fetchChart(symbol, '1d', '1d');
    const quote = this.quoteFromChart(symbol, result);
    return withProviderReceipt(this, quote, {
      datasetFamily: 'quote',
      instrument: quote.symbol,
      venue: quote.exchange,
      provenance: 'live',
      sourceAsOf: result.meta.regularMarketTime ? quote.asOf : null,
      units: { price: quote.currency, volume: 'shares-or-contracts' },
      limitations: [
        ...(result.meta.regularMarketTime ? [] : ['Yahoo omitted its market timestamp; source as-of is unknown.']),
        ...(quote.currency === 'UNKNOWN'
          ? [partialEvidenceLimitation('Yahoo omitted the quote currency; price units are unknown.')]
          : []),
        ...(quote.volume === null
          ? [partialEvidenceLimitation('Yahoo omitted valid market-volume evidence.')]
          : []),
      ],
      note: null,
    }, this.now());
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const settled = await Promise.allSettled(symbols.map((s) => this.getQuote(s)));
    return settled
      .filter((r): r is PromiseFulfilledResult<Quote> => r.status === 'fulfilled')
      .map((r) => r.value);
  }

  async getHistory(symbol: string, opts: HistoryOptions): Promise<HistoryResponse> {
    const result = await this.fetchChart(symbol, opts.interval, opts.range);
    const timestamps = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0] ?? {};
    const candles: Candle[] = [];

    let omitted = 0;
    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = timestamps[i];
      const open = quote.open?.[i];
      const high = quote.high?.[i];
      const low = quote.low?.[i];
      const close = quote.close?.[i];
      const volume = quote.volume?.[i];
      if (
        !isFiniteNumber(timestamp) || timestamp <= 0 ||
        !isFiniteNumber(open) || open <= 0 ||
        !isFiniteNumber(high) || high <= 0 ||
        !isFiniteNumber(low) || low <= 0 ||
        !isFiniteNumber(close) || close <= 0 ||
        !isFiniteNumber(volume) || volume < 0
      ) {
        omitted += 1;
        continue;
      }
      candles.push({
        time: timestamp,
        open,
        high,
        low,
        close,
        volume,
      });
    }

    if (timestamps.length === 0) {
      throw new ProviderError(`Yahoo returned no history rows for ${symbol}`, 502, symbol, 'upstream-unavailable');
    }
    if (candles.length === 0) {
      throw new ProviderError(
        `Yahoo returned only malformed history rows for ${symbol}`,
        502,
        symbol,
        'malformed-upstream',
      );
    }

    const value: HistoryResponse = {
      symbol: result.meta.symbol ?? symbol.toUpperCase(),
      interval: opts.interval,
      range: opts.range,
      currency: result.meta.currency?.trim() || 'UNKNOWN',
      candles,
    };
    const last = candles.at(-1);
    const cadenceMs = INTERVAL_SECONDS[opts.interval] * 1_000;
    return withProviderReceipt(this, value, {
      datasetFamily: 'history',
      instrument: value.symbol,
      provenance: 'live',
      sourceAsOf: last == null ? null : last.time * 1000,
      coverage: `${value.interval} candles over ${value.range}`,
      expectedCadenceMs: cadenceMs,
      maxAgeMs: cadenceMs * 2,
      units: { time: 'unix-seconds', ohlc: value.currency, volume: 'shares-or-contracts' },
      limitations: [
        ...(omitted > 0
          ? [partialEvidenceLimitation(`${omitted} upstream bars missing OHLCV evidence were omitted.`)]
          : []),
        ...(last == null ? ['No complete candle was returned; source as-of is unknown.'] : []),
        ...(value.currency === 'UNKNOWN'
          ? [partialEvidenceLimitation('Yahoo omitted the history currency; OHLC units are unknown.')]
          : []),
      ],
      note: null,
    }, this.now());
  }

  async getOrderBook(symbol: string): Promise<OrderBook> {
    // Yahoo's public endpoints don't expose Level-2 depth.
    throw new ProviderError(
      'Order book (Level 2) is not available from the Yahoo provider — use the ccxt provider for crypto depth',
      501,
      symbol,
    );
  }

  async getExchangeQuotes(symbol: string): Promise<VenueQuote[]> {
    throw new ProviderError(
      'Multi-exchange compare is a crypto feature — use the ccxt provider',
      501,
      symbol,
    );
  }

  async getVenueDerivatives(symbol: string): Promise<VenueDerivatives[]> {
    throw new ProviderError(
      'Cross-exchange derivatives is a crypto feature — use the ccxt provider',
      501,
      symbol,
    );
  }

  async getDerivatives(symbol: string): Promise<DerivativesInfo> {
    throw new ProviderError(
      'Derivatives (funding / OI / liquidations) is a crypto feature — use the ccxt provider',
      501,
      symbol,
    );
  }

  liquidationsProvenance(): LiquidationsProvenance {
    const note = 'Liquidations are a crypto feature — switch to the ccxt provider.';
    return {
      source: this.name,
      available: false,
      note,
      sources: [{ source: this.name, available: false, throttled: false, synthetic: false, note }],
      sampledSource: this.name,
      receipt: providerUnavailableReceipt(this, {
        datasetFamily: 'liquidations',
        coverage: 'availability declaration only',
        units: { amount: 'base-asset', price: 'quote-asset' },
        note,
      }, this.now()),
    };
  }

  async getDexPools(symbol: string): Promise<DexPools> {
    return {
      symbol: symbol.split('/')[0].toUpperCase(),
      provenance: 'unavailable',
      note: 'On-chain/DEX data is a crypto feature — switch to the ccxt provider.',
      pools: [],
    };
  }

  async getSolanaNetwork(): Promise<SolanaNetwork> {
    return {
      source: this.name,
      provenance: 'unavailable',
      note: 'Solana data is a crypto feature — switch to the ccxt provider (and set MIDAS_SOLANA_RPC for a live read).',
      slot: null,
      epoch: null,
      epochProgressPct: null,
      tps: null,
      validatorCount: null,
      totalStakeSol: null,
      circulatingSupplySol: null,
      totalSupplySol: null,
      solPriceUsd: null,
      asOf: Date.now(),
    };
  }

  async getSolanaWallet(address: string): Promise<SolanaWallet> {
    return {
      source: this.name,
      provenance: 'unavailable',
      note: 'Solana data is a crypto feature — switch to the ccxt provider (and set MIDAS_SOLANA_RPC for a live read).',
      address,
      solBalance: null,
      tokens: [],
      totalValueUsd: null,
      asOf: Date.now(),
    };
  }

  async getSolanaTrending(): Promise<SolanaTrending> {
    return {
      source: this.name,
      provenance: 'unavailable',
      note: 'Solana data is a crypto feature — switch to the ccxt provider (and set MIDAS_DEX_SOURCE=geckoterminal for a live read).',
      tokens: [],
      asOf: Date.now(),
    };
  }

  async getSolanaDexPools(symbol: string): Promise<DexPools> {
    return {
      symbol: symbol.split('/')[0].toUpperCase(),
      provenance: 'unavailable',
      note: 'Solana DEX data is a crypto feature — switch to the ccxt provider (and set MIDAS_DEX_SOURCE=geckoterminal).',
      pools: [],
    };
  }

  async getSolanaValidators(): Promise<SolanaValidators> {
    return {
      source: this.name,
      provenance: 'unavailable',
      note: 'Solana data is a crypto feature — switch to the ccxt provider (and set MIDAS_SOLANA_RPC for a live read).',
      totalStakeSol: null,
      validatorCount: null,
      delinquentCount: null,
      validators: [],
      asOf: Date.now(),
    };
  }

  async getSolanaStaking(): Promise<SolanaStaking> {
    return {
      source: this.name,
      provenance: 'unavailable',
      note: 'Solana data is a crypto feature — switch to the ccxt provider (and set MIDAS_SOLANA_RPC for a live read).',
      inflationPct: null,
      stakedRatioPct: null,
      nominalApyPct: null,
      realApyPct: null,
      epochsPerYear: null,
      asOf: Date.now(),
    };
  }

  async getSolanaToken(mint: string): Promise<SolanaTokenInfo> {
    return {
      source: this.name,
      provenance: 'unavailable',
      note: 'Solana data is a crypto feature — switch to the ccxt provider (and set MIDAS_SOLANA_RPC for a live read).',
      mint,
      symbol: mint,
      program: null,
      decimals: null,
      supply: null,
      mintAuthority: null,
      mintAuthorityActive: null,
      freezeAuthority: null,
      freezeAuthorityActive: null,
      priceUsd: null,
      asOf: Date.now(),
    };
  }

  async getSolanaQuote(input: string, output: string): Promise<SolanaSwapQuote> {
    return {
      source: this.name,
      provenance: 'unavailable',
      note: 'Solana swap quotes are a crypto feature — switch to the ccxt provider (and set MIDAS_SOLANA_JUPITER for a live read).',
      inputSymbol: input.toUpperCase(),
      outputSymbol: output.toUpperCase(),
      inputMint: '',
      outputMint: '',
      inAmount: null,
      outAmount: null,
      price: null,
      priceImpactPct: null,
      slippageBps: null,
      route: [],
      asOf: Date.now(),
    };
  }

  async getSolanaMarket(): Promise<SolanaMarket> {
    return {
      source: this.name,
      provenance: 'unavailable',
      note: 'Solana data is a crypto feature — switch to the ccxt provider (and set MIDAS_DEX_SOURCE=geckoterminal for a live read).',
      solPriceUsd: null,
      totalVolume24hUsd: null,
      totalLiquidityUsd: null,
      tokenCount: null,
      tokens: [],
      asOf: Date.now(),
    };
  }

  async getBalances(): Promise<Balances> {
    const value: Balances = {
      source: this.name,
      provenance: 'unavailable',
      note: 'Account balances are a crypto-exchange feature — switch to the ccxt provider and supply read-only API keys.',
      totalValueUsd: null,
      balances: [],
      asOf: this.now(),
    };
    return { ...value, receipt: providerUnavailableReceipt(this, {
      datasetFamily: 'balances', sourceAsOf: null,
      units: { free: 'asset-units', used: 'asset-units', total: 'asset-units', valueUsd: 'USD' },
      note: value.note ?? 'Balances are unavailable from Yahoo.',
    }, this.now()) };
  }

  async getOpenOrders(): Promise<OpenOrders> {
    const value: OpenOrders = {
      source: this.name,
      provenance: 'unavailable',
      note: 'Open orders are a crypto-exchange feature — switch to the ccxt provider and supply read-only API keys.',
      orders: [],
      asOf: this.now(),
    };
    return { ...value, receipt: providerUnavailableReceipt(this, {
      datasetFamily: 'account-orders', sourceAsOf: null,
      units: { price: 'quote-asset', amount: 'base-asset', value: 'quote-asset' },
      note: value.note ?? 'Open orders are unavailable from Yahoo.',
    }, this.now()) };
  }

  async getPositions(): Promise<AccountPositions> {
    const value: AccountPositions = {
      source: this.name,
      provenance: 'unavailable',
      note: 'Open positions are a crypto-exchange feature — switch to the ccxt provider and supply read-only API keys.',
      totalUnrealizedPnlUsd: null,
      positions: [],
      asOf: this.now(),
    };
    return { ...value, receipt: providerUnavailableReceipt(this, {
      datasetFamily: 'account-positions', sourceAsOf: null,
      units: { contracts: 'contracts-or-base', notionalUsd: 'USD', unrealizedPnlUsd: 'USD' },
      note: value.note ?? 'Positions are unavailable from Yahoo.',
    }, this.now()) };
  }

  async getFills(): Promise<AccountFills> {
    const value: AccountFills = {
      source: this.name,
      provenance: 'unavailable',
      note: 'Account fills are a crypto-exchange feature — switch to the ccxt provider and supply read-only API keys.',
      fills: [],
      asOf: this.now(),
    };
    return { ...value, receipt: providerUnavailableReceipt(this, {
      datasetFamily: 'account-fills', sourceAsOf: null,
      units: { price: 'quote-asset', amount: 'base-asset', cost: 'quote-asset', fee: 'fee-currency' },
      note: value.note ?? 'Fills are unavailable from Yahoo.',
    }, this.now()) };
  }

  async screen(_opts: ScreenerOptions): Promise<ScreenerRow[]> {
    throw new ProviderError('The screener is a crypto feature — use the ccxt provider', 501);
  }

  async search(query: string): Promise<SearchResult[]> {
    const url = `${SEARCH_BASE}?q=${encodeURIComponent(query)}&quotesCount=15&newsCount=0&enableFuzzyQuery=false`;
    const data = await this.fetchJson<{ quotes?: YahooSearchQuote[] }>(url);
    return (data.quotes ?? [])
      .filter((q) => Boolean(q.symbol))
      .map((q) => ({
        symbol: q.symbol,
        name: q.shortname ?? q.longname ?? q.symbol,
        exchange: q.exchDisp ?? q.exchange ?? '',
        type: (q.quoteType ?? 'EQUITY').toUpperCase(),
      }));
  }

  async getNews(symbol?: string): Promise<NewsItem[]> {
    const query = symbol && symbol.trim() ? symbol : 'stock market';
    const url = `${SEARCH_BASE}?q=${encodeURIComponent(query)}&quotesCount=0&newsCount=20`;
    const data = await this.fetchJson<{ news?: YahooNews[] }>(url);
    return (data.news ?? []).map((n) => ({
      id: n.uuid ?? n.link,
      title: n.title,
      publisher: n.publisher ?? 'Yahoo Finance',
      link: n.link,
      publishedAt: (n.providerPublishTime ?? 0) * 1000,
      relatedSymbols: n.relatedTickers ?? (symbol ? [symbol.toUpperCase()] : []),
    }));
  }

  // -- internals -----------------------------------------------------------

  private async fetchChart(
    symbol: string,
    interval: string,
    range: string,
  ): Promise<YahooChartResult> {
    const url = `${CHART_BASE}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
    const data = await this.fetchJson<{
      chart?: { result?: YahooChartResult[]; error?: { description?: string } };
    }>(url);

    const err = data.chart?.error;
    if (err) throw new ProviderError(`No Yahoo Finance data is available for symbol ${symbol}`, 404, symbol);

    const result = data.chart?.result?.[0];
    if (!result?.meta) throw new ProviderError(`No data for symbol ${symbol}`, 404, symbol);
    return result;
  }

  private quoteFromChart(symbol: string, result: YahooChartResult): Quote {
    const meta = result.meta;
    const price = meta.regularMarketPrice;
    const previousClose = meta.chartPreviousClose ?? meta.previousClose;
    if (price == null || !Number.isFinite(price) || price <= 0) {
      throw new ProviderError(`No usable price for symbol ${symbol}`, 502, symbol, 'malformed-upstream');
    }
    if (previousClose == null || !Number.isFinite(previousClose) || previousClose <= 0) {
      throw new ProviderError(`No usable previous close for symbol ${symbol}`, 502, symbol, 'malformed-upstream');
    }
    const change = price - previousClose;
    const firstOpen = finitePositiveOrNull(result.indicators?.quote?.[0]?.open?.find((v) => v != null));

    return {
      symbol: meta.symbol ?? symbol.toUpperCase(),
      name: meta.longName ?? meta.shortName ?? meta.symbol ?? symbol.toUpperCase(),
      currency: meta.currency?.trim() || 'UNKNOWN',
      exchange: meta.fullExchangeName ?? meta.exchangeName ?? '',
      marketState: this.marketStateFromMeta(meta),
      price,
      previousClose,
      open: firstOpen,
      dayHigh: finitePositiveOrNull(meta.regularMarketDayHigh),
      dayLow: finitePositiveOrNull(meta.regularMarketDayLow),
      change,
      changePercent: (change / previousClose) * 100,
      volume: finiteNonNegativeOrNull(meta.regularMarketVolume),
      marketCap: null, // not available on the crumbless chart endpoint
      fiftyTwoWeekHigh: finitePositiveOrNull(meta.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: finitePositiveOrNull(meta.fiftyTwoWeekLow),
      asOf: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
    };
  }

  private marketStateFromMeta(meta: YahooChartMeta): MarketState {
    const period = meta.currentTradingPeriod;
    const t = meta.regularMarketTime;
    if (!period?.regular || t == null) return 'UNKNOWN';
    if (period.pre && t >= period.pre.start && t < period.pre.end) return 'PRE';
    if (t >= period.regular.start && t < period.regular.end) return 'REGULAR';
    if (period.post && t >= period.post.start && t < period.post.end) return 'POST';
    return 'CLOSED';
  }

  private async fetchJson<T>(url: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
    } catch (cause) {
      void cause;
      throw new ProviderError(
        'Failed to reach Yahoo Finance. If you are in a restricted environment, use MIDAS_DATA_PROVIDER=mock.',
        502,
      );
    }
    if (!res.ok) {
      throw new ProviderError(`Yahoo Finance responded ${res.status}`, res.status === 404 ? 404 : 502);
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new ProviderError('Yahoo Finance returned a malformed JSON response', 502, undefined, 'malformed-upstream');
    }
  }
}

interface YahooSearchQuote {
  symbol: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  exchange?: string;
  quoteType?: string;
}

interface YahooNews {
  uuid?: string;
  title: string;
  publisher?: string;
  link: string;
  providerPublishTime?: number;
  relatedTickers?: string[];
}
