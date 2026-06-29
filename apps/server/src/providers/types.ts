import type {
  AccountPositions,
  Balances,
  DerivativesInfo,
  DexPools,
  FundingHistoryPoint,
  OpenOrders,
  OrderRequest,
  PlacedOrder,
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
  /** On-chain/DEX pool snapshot for a base asset, honestly labeled live/synthetic/unavailable. */
  getDexPools(symbol: string): Promise<DexPools>;
  /** Read-only account balances (non-custodial; keyed via the operator's env), honestly labeled. */
  getBalances(): Promise<Balances>;
  /** Read-only open orders (non-custodial; reads only — never places/cancels), honestly labeled. */
  getOpenOrders(): Promise<OpenOrders>;
  /** Read-only open positions (non-custodial; reads only), honestly labeled. */
  getPositions(): Promise<AccountPositions>;
  /** Recent funding settlements for a perp (optional — crypto providers only). */
  getFundingHistory?(symbol: string, limit: number): Promise<FundingHistoryPoint[]>;
  /**
   * Place a LIVE order (optional — ccxt only). The single write in the data layer.
   * Reached only when live trading is explicitly enabled, validated and capped by
   * the route; providers that omit it cannot trade.
   */
  placeOrder?(req: OrderRequest): Promise<PlacedOrder>;
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
