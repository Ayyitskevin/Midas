import type {
  Candle,
  DerivativesInfo,
  DexPools,
  HistoryResponse,
  LiquidationsProvenance,
  MarketState,
  NewsItem,
  OrderBook,
  Quote,
  ScreenerRow,
  SearchResult,
  VenueDerivatives,
  VenueQuote,
} from '@midas/shared';
import type { DataProvider, HistoryOptions, ScreenerOptions } from './types';
import { ProviderError } from './types';

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

  async getQuote(symbol: string): Promise<Quote> {
    const result = await this.fetchChart(symbol, '1d', '1d');
    return this.quoteFromChart(symbol, result);
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

    for (let i = 0; i < timestamps.length; i++) {
      const open = quote.open?.[i];
      const high = quote.high?.[i];
      const low = quote.low?.[i];
      const close = quote.close?.[i];
      if (open == null || high == null || low == null || close == null) continue;
      candles.push({
        time: timestamps[i],
        open,
        high,
        low,
        close,
        volume: quote.volume?.[i] ?? 0,
      });
    }

    return {
      symbol: result.meta.symbol ?? symbol.toUpperCase(),
      interval: opts.interval,
      range: opts.range,
      currency: result.meta.currency ?? 'USD',
      candles,
    };
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
    return {
      source: this.name,
      available: false,
      note: 'Liquidations are a crypto feature — switch to the ccxt provider.',
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
    if (err) throw new ProviderError(err.description ?? 'Yahoo chart error', 404, symbol);

    const result = data.chart?.result?.[0];
    if (!result?.meta) throw new ProviderError(`No data for symbol ${symbol}`, 404, symbol);
    return result;
  }

  private quoteFromChart(symbol: string, result: YahooChartResult): Quote {
    const meta = result.meta;
    const price = meta.regularMarketPrice ?? meta.previousClose ?? 0;
    const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
    const change = price - previousClose;
    const firstOpen = result.indicators?.quote?.[0]?.open?.find((v) => v != null) ?? null;

    return {
      symbol: meta.symbol ?? symbol.toUpperCase(),
      name: meta.longName ?? meta.shortName ?? meta.symbol ?? symbol.toUpperCase(),
      currency: meta.currency ?? 'USD',
      exchange: meta.fullExchangeName ?? meta.exchangeName ?? '',
      marketState: this.marketStateFromMeta(meta),
      price,
      previousClose,
      open: firstOpen,
      dayHigh: meta.regularMarketDayHigh ?? null,
      dayLow: meta.regularMarketDayLow ?? null,
      change,
      changePercent: previousClose === 0 ? 0 : (change / previousClose) * 100,
      volume: meta.regularMarketVolume ?? null,
      marketCap: null, // not available on the crumbless chart endpoint
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
      asOf: meta.regularMarketTime ? meta.regularMarketTime * 1000 : Date.now(),
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
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
    } catch (cause) {
      throw new ProviderError(
        `Failed to reach Yahoo Finance (${(cause as Error).message}). ` +
          `If you are in a restricted environment, use MIDAS_DATA_PROVIDER=mock.`,
        502,
      );
    }
    if (!res.ok) {
      throw new ProviderError(`Yahoo Finance responded ${res.status}`, res.status === 404 ? 404 : 502);
    }
    return (await res.json()) as T;
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
