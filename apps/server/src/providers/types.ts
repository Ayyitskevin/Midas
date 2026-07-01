import type {
  AccountFills,
  AccountPositions,
  Balances,
  CancelResult,
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
  /** Read-only recent fills / my-trades (non-custodial), honestly labeled. Some venues require a symbol. */
  getFills(symbol?: string): Promise<AccountFills>;
  /**
   * Look up a single order's current state (optional — ccxt only). READ-ONLY:
   * used by the account watcher to resolve how an order left the book, and by
   * the TICKET panel to track a placement to filled/canceled.
   */
  getOrder?(id: string, symbol: string): Promise<PlacedOrder>;
  /**
   * Subscribe to a NUDGE whenever the account's orders change (optional —
   * ccxt.pro watchOrders where the venue supports it). READ-ONLY and
   * best-effort: the account watcher polls immediately on a nudge instead of
   * waiting out its interval, but REST polling remains the source of truth.
   * Returns a stop function, or null when streaming isn't available.
   */
  streamAccountNudge?(onChange: () => void): (() => void) | null;
  /** Recent funding settlements for a perp (optional — crypto providers only). */
  getFundingHistory?(symbol: string, limit: number): Promise<FundingHistoryPoint[]>;
  /**
   * Place a LIVE order (optional — ccxt only). The single write in the data layer.
   * Reached only when live trading is explicitly enabled, validated and capped by
   * the route; providers that omit it cannot trade.
   */
  placeOrder?(req: OrderRequest): Promise<PlacedOrder>;
  /**
   * Cancel a resting order (optional — ccxt only). Risk-REDUCING write, gated
   * by the same trading switches as placement: a trader who can place a limit
   * order must be able to pull it.
   */
  cancelOrder?(id: string, symbol: string): Promise<CancelResult>;
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
