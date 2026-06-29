import type {
  DerivativesInfo,
  FundingHistoryPoint,
  HistoryResponse,
  Interval,
  LiquidationsProvenance,
  NewsItem,
  OrderBook,
  Quote,
  Range,
  ScreenerRow,
  SearchResult,
  VenueDerivatives,
  VenueQuote,
} from '@midas/shared';

export interface ScreenerOptions {
  /** Quote currency to screen, e.g. USDT. */
  quote?: string;
  /** Sort key: 'volume' (default) | 'change' | 'price'. */
  sort?: string;
  limit?: number;
}

export interface HistoryOptions {
  interval: Interval;
  range: Range;
}

/**
 * A pluggable source of market data. Implementations must be safe to construct
 * once and reuse across requests. Anything that can fail against an upstream
 * should throw {@link ProviderError} so the API layer can translate it.
 */
export interface DataProvider {
  /** Stable identifier, e.g. 'yahoo' or 'mock'. */
  readonly name: string;
  /** True if this provider reaches a real upstream; false for synthetic data. */
  readonly live: boolean;

  getQuote(symbol: string): Promise<Quote>;
  getQuotes(symbols: string[]): Promise<Quote[]>;
  getHistory(symbol: string, opts: HistoryOptions): Promise<HistoryResponse>;
  getOrderBook(symbol: string, depth?: number): Promise<OrderBook>;
  getExchangeQuotes(symbol: string): Promise<VenueQuote[]>;
  getDerivatives(symbol: string): Promise<DerivativesInfo>;
  /** Per-venue funding & open interest for a perp, across the compare set (crypto only). */
  getVenueDerivatives(symbol: string): Promise<VenueDerivatives[]>;
  /** Provenance + availability of the liquidation feed, for honest labeling. */
  liquidationsProvenance(): LiquidationsProvenance;
  /** Recent funding settlements for a perp (optional — crypto providers only). */
  getFundingHistory?(symbol: string, limit: number): Promise<FundingHistoryPoint[]>;
  screen(opts: ScreenerOptions): Promise<ScreenerRow[]>;
  search(query: string): Promise<SearchResult[]>;
  getNews(symbol?: string): Promise<NewsItem[]>;
}

/** Error raised by a provider when an upstream lookup fails. */
export class ProviderError extends Error {
  readonly statusCode: number;
  readonly symbol?: string;

  constructor(message: string, statusCode = 502, symbol?: string) {
    super(message);
    this.name = 'ProviderError';
    this.statusCode = statusCode;
    this.symbol = symbol;
  }
}
