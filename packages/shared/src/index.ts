/**
 * @midas/shared — the data contract shared between the Midas server and web client.
 *
 * Keep this package free of runtime dependencies: it is consumed as raw TypeScript
 * source by both the Fastify server (via tsx) and the Vite web client (via alias),
 * so anything imported here must be safe in both Node and browser environments.
 */

// ---------------------------------------------------------------------------
// Chart granularity
// ---------------------------------------------------------------------------

/** Candle granularity, mirroring the intervals Yahoo Finance accepts. */
export type Interval =
  | '1m'
  | '2m'
  | '5m'
  | '15m'
  | '30m'
  | '60m'
  | '90m'
  | '1d'
  | '1wk'
  | '1mo';

/** Lookback window for a history request. */
export type Range =
  | '1d'
  | '5d'
  | '1mo'
  | '3mo'
  | '6mo'
  | '1y'
  | '2y'
  | '5y'
  | 'max';

export const INTERVALS: readonly Interval[] = [
  '1m',
  '2m',
  '5m',
  '15m',
  '30m',
  '60m',
  '90m',
  '1d',
  '1wk',
  '1mo',
];

export const RANGES: readonly Range[] = [
  '1d',
  '5d',
  '1mo',
  '3mo',
  '6mo',
  '1y',
  '2y',
  '5y',
  'max',
];

// ---------------------------------------------------------------------------
// Market data shapes
// ---------------------------------------------------------------------------

/** Trading status of a symbol's primary exchange. */
export type MarketState =
  | 'PRE'
  | 'REGULAR'
  | 'POST'
  | 'CLOSED'
  | 'UNKNOWN';

/** A single OHLCV bar. `time` is a Unix timestamp in **seconds** (UTC). */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A point-in-time snapshot quote for a single security. */
export interface Quote {
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  marketState: MarketState;
  /** Last traded / regular-market price. */
  price: number;
  previousClose: number;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  /** Absolute change vs previous close. */
  change: number;
  /** Percentage change vs previous close (e.g. 1.23 means +1.23%). */
  changePercent: number;
  volume: number | null;
  marketCap: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  /** Epoch millis of the underlying data point, for staleness display. */
  asOf: number;
}

/** Response to a history (candles) request. */
export interface HistoryResponse {
  symbol: string;
  interval: Interval;
  range: Range;
  currency: string;
  candles: Candle[];
}

/** A security returned by the search / security-finder endpoint. */
export interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  /** e.g. EQUITY, ETF, INDEX, CRYPTOCURRENCY, CURRENCY, FUTURE. */
  type: string;
}

/** A news headline, optionally tied to one or more symbols. */
export interface NewsItem {
  id: string;
  title: string;
  publisher: string;
  link: string;
  /** Epoch millis. */
  publishedAt: number;
  relatedSymbols: string[];
  summary?: string;
}

/** A single price level in an order book. */
export interface OrderBookLevel {
  price: number;
  amount: number;
}

/** Level-2 order book (depth of market) snapshot. */
export interface OrderBook {
  symbol: string;
  /** Best (highest) bid first. */
  bids: OrderBookLevel[];
  /** Best (lowest) ask first. */
  asks: OrderBookLevel[];
  /** Epoch millis of the snapshot. */
  timestamp: number;
}

/** A single venue's top-of-book quote, for the multi-exchange compare view. */
export interface VenueQuote {
  exchange: string;
  price: number;
  bid: number | null;
  ask: number | null;
  changePercent: number;
  /** Base-asset 24h volume. */
  volume: number | null;
  timestamp: number;
}

/**
 * A single venue's perpetual funding & open interest, for the cross-exchange
 * derivatives view (same perp, many exchanges). Funding diverges across venues,
 * so comparing them surfaces funding-arbitrage and crowding signals.
 */
export interface VenueDerivatives {
  exchange: string;
  /** Funding rate as a fraction (0.0001 = 0.01%); null if unavailable. */
  fundingRate: number | null;
  /** Epoch millis of the next funding. */
  nextFundingTime: number | null;
  markPrice: number | null;
  /** Open interest notional in quote units; null if unavailable. */
  openInterestValue: number | null;
  timestamp: number;
}

/** A single executed trade (print), streamed by the live trades feed. */
export interface Trade {
  price: number;
  amount: number;
  side: 'buy' | 'sell';
  timestamp: number;
}

/** A single liquidation event. */
export interface Liquidation {
  /** 'sell' = a long was liquidated; 'buy' = a short was liquidated. */
  side: 'buy' | 'sell';
  price: number;
  /** Base-asset amount. */
  amount: number;
  timestamp: number;
}

/** A liquidation in the market-wide feed — a {@link Liquidation} tagged with its symbol. */
export interface LiquidationEvent {
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  /** Notional value in the quote currency (price × amount). */
  value: number;
  timestamp: number;
}

/**
 * Provenance + availability for the liquidation feed, so the UI can be honest
 * about where the numbers come from and why they may be empty or unreliable.
 *
 * Liquidation data is the least trustworthy feed in crypto: most exchanges
 * either expose no public liquidation stream at all (Binance removed its public
 * stream in 2021) or throttle it to ~1/sec, which is widely documented to
 * under-report true liquidations many-fold. Rather than silently show an empty
 * "live" feed, Midas labels the source and surfaces the caveat.
 */
export interface LiquidationsProvenance {
  /** Where the data came from — an exchange id/name, or 'mock'. */
  source: string;
  /** Whether the source actually exposes a public liquidation feed. */
  available: boolean;
  /** Honest caveat: why the feed may be empty/partial, the throttling warning, etc. */
  note?: string;
}

/** {@link LiquidationsProvenance} stamped with the time the feed was assembled. */
export interface LiquidationsMeta extends LiquidationsProvenance {
  /** Epoch millis the feed was assembled. */
  asOf: number;
}

/** The market-wide liquidations feed plus its provenance metadata. */
export interface LiquidationsFeed {
  events: LiquidationEvent[];
  meta: LiquidationsMeta;
}

/** Whether an on-chain/DEX snapshot is real, synthetic, or unavailable for this provider. */
export type OnChainProvenance = 'live' | 'synthetic' | 'unavailable';

/** A read-only snapshot of one DEX liquidity pool for a base asset. */
export interface DexPool {
  /** DEX / protocol name, e.g. 'Uniswap v3'. */
  dex: string;
  /** Pool pair label, e.g. 'WETH/USDC'. */
  pair: string;
  /** Spot price in USD implied by the pool; null if unknown. */
  priceUsd: number | null;
  /** Total value locked in the pool, USD; null if unknown. */
  liquidityUsd: number | null;
  /** Trailing 24h swap volume, USD; null if unknown. */
  volume24hUsd: number | null;
  /** Swap fee tier in basis points (e.g. 5, 30, 100); null if n/a. */
  feeBps: number | null;
}

/** On-chain / DEX pools for a base asset, with honest provenance labeling. */
export interface DexPools {
  /** The base asset the pools are for, e.g. ETH. */
  symbol: string;
  provenance: OnChainProvenance;
  /** Honest caveat: why the data is synthetic/unavailable, or null when live. */
  note: string | null;
  pools: DexPool[];
}

/** Whether an account-balances snapshot is a real keyed read, synthetic demo, or unavailable. */
export type BalancesProvenance = 'live' | 'synthetic' | 'unavailable';

/** A single asset's balance within an account. */
export interface AccountBalance {
  /** Asset ticker, e.g. BTC, USDT. */
  asset: string;
  /** Free (available to trade) amount. */
  free: number;
  /** Used (locked in open orders / margin) amount. */
  used: number;
  /** Total holding (free + used). */
  total: number;
  /** Best-effort USD value of the total holding; null when it can't be priced. */
  valueUsd: number | null;
}

/**
 * A read-only snapshot of account balances, with honest provenance labeling.
 *
 * Midas is strictly non-custodial and read-only: balances are fetched with
 * read-only exchange API keys that live only in the operator's own server
 * environment, and the terminal never places orders or moves funds. When no
 * keys are configured the snapshot is honestly `unavailable`; the mock provider
 * returns a clearly-labeled `synthetic` demo book so the panel is useful offline.
 */
export interface Balances {
  /** Where the balances came from, e.g. 'ccxt:binance' or 'mock'. */
  source: string;
  provenance: BalancesProvenance;
  /** Honest caveat: why the data is synthetic/unavailable, or null when live. */
  note: string | null;
  /** Total portfolio value in USD across priced assets; null if nothing could be priced. */
  totalValueUsd: number | null;
  balances: AccountBalance[];
  /** Epoch millis the snapshot was assembled. */
  asOf: number;
}

/** Whether an account read (orders/positions) is a real keyed read, synthetic demo, or unavailable. */
export type AccountProvenance = 'live' | 'synthetic' | 'unavailable';

/** A single resting (open) order on the account. Read-only — Midas never places or cancels orders. */
export interface OpenOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  /** Order type, e.g. 'limit' | 'market' | 'stop'. */
  type: string;
  /** Limit price; null for market orders. */
  price: number | null;
  /** Ordered base amount. */
  amount: number;
  /** Filled base amount so far. */
  filled: number;
  /** Remaining (unfilled) base amount. */
  remaining: number;
  /** Notional in the quote currency (price × amount); null when not priceable. */
  value: number | null;
  /** Epoch millis the order was placed; null if unknown. */
  timestamp: number | null;
  /** Order status, e.g. 'open' | 'partial'. */
  status: string;
}

/** Read-only snapshot of the account's open orders, with honest provenance labeling. */
export interface OpenOrders {
  /** Where the orders came from, e.g. 'ccxt:binance' or 'mock'. */
  source: string;
  provenance: AccountProvenance;
  /** Honest caveat: why the data is synthetic/unavailable, or null when live. */
  note: string | null;
  orders: OpenOrder[];
  /** Epoch millis the snapshot was assembled. */
  asOf: number;
}

/** A single open derivatives position on the account. Read-only — Midas never opens or closes positions. */
export interface AccountPosition {
  symbol: string;
  side: 'long' | 'short';
  /** Position size in base units / contracts (absolute). */
  contracts: number;
  /** Notional value in the settlement currency (≈ USD for linear perps); null if unknown. */
  notionalUsd: number | null;
  entryPrice: number | null;
  markPrice: number | null;
  /** Unrealized P&L in the settlement currency (≈ USD for linear perps); null if unknown. */
  unrealizedPnlUsd: number | null;
  /** Unrealized P&L as a percentage; null if unknown. */
  pnlPct: number | null;
  liquidationPrice: number | null;
  leverage: number | null;
}

/** Read-only snapshot of the account's open positions, with honest provenance labeling. */
export interface AccountPositions {
  /** Where the positions came from, e.g. 'ccxt:binance' or 'mock'. */
  source: string;
  provenance: AccountProvenance;
  /** Honest caveat: why the data is synthetic/unavailable, or null when live. */
  note: string | null;
  /** Total unrealized P&L across positions (≈ USD); null if none priced. */
  totalUnrealizedPnlUsd: number | null;
  positions: AccountPosition[];
  /** Epoch millis the snapshot was assembled. */
  asOf: number;
}

/** A single executed fill (my-trade) on the account. Read-only. */
export interface AccountFill {
  id: string;
  /** The order this fill executed against; null if the exchange omits it. */
  orderId: string | null;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  /** Filled base amount. */
  amount: number;
  /** Quote notional of the fill (price × amount when the exchange omits it). */
  cost: number;
  /** Fee paid on the fill; null if unknown. */
  fee: number | null;
  feeCurrency: string | null;
  /** 'maker' | 'taker' when the exchange reports it. */
  takerOrMaker: string | null;
  /** Epoch millis of execution; null if unknown. */
  timestamp: number | null;
}

/** Read-only snapshot of recent account fills, with honest provenance labeling. */
export interface AccountFills {
  source: string;
  provenance: AccountProvenance;
  /** Honest caveat: why the data is synthetic/unavailable, or null when live. */
  note: string | null;
  fills: AccountFill[];
  /** Epoch millis the snapshot was assembled. */
  asOf: number;
}

/** The exchange's acknowledgement of a canceled order. */
export interface CancelResult {
  id: string;
  symbol: string;
  status: string;
}

/**
 * A request to place a live order. Live trading is strictly opt-in and off by
 * default — see {@link TradingStatus}. Midas only places an order when the
 * operator has explicitly enabled trading and provisioned trade-permissioned
 * keys; every order is gated, validated and notional-capped server-side.
 */
export interface OrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  /** Order size in base units. */
  amount: number;
  /** Limit price (required for limit; ignored for market). */
  price?: number | null;
  /** Idempotency key so a retry / double-submit does not double-place. */
  clientOrderId?: string;
}

/** The exchange's response to a placed order. */
export interface PlacedOrder {
  id: string;
  clientOrderId: string | null;
  symbol: string;
  side: 'buy' | 'sell';
  type: string;
  amount: number;
  price: number | null;
  filled: number;
  status: string;
  /** Epoch millis the order was accepted; null if unknown. */
  timestamp: number | null;
}

/**
 * Whether live order placement is currently enabled, plus the reason and limits —
 * so the UI can stay honest about LIVE vs preview mode and never imply an order
 * can be placed when it can't (or vice versa).
 */
export interface TradingStatus {
  enabled: boolean;
  /** Why trading is off (when disabled), or a confirmation note when on. */
  reason: string;
  /** Per-order USD notional cap the server enforces, or null if uncapped. */
  maxOrderUsd: number | null;
  /** Cumulative UTC-day USD notional cap, or null if uncapped. */
  dailyCapUsd: number | null;
  /** Notional already placed today (UTC), USD. Resets on server restart. */
  dailyUsedUsd: number;
  /** The source that would receive orders, e.g. 'ccxt:binance'. */
  source: string;
}

/** Perpetual-swap derivatives snapshot: funding, open interest, liquidations. */
export interface DerivativesInfo {
  /** The perp symbol the data is for (e.g. BTC/USDT:USDT). */
  symbol: string;
  /** Current funding rate as a fraction (0.0001 = 0.01%). */
  fundingRate: number | null;
  /** Epoch millis of the next funding. */
  nextFundingTime: number | null;
  markPrice: number | null;
  indexPrice: number | null;
  /** Open interest in base units. */
  openInterest: number | null;
  /** Open interest notional in quote units. */
  openInterestValue: number | null;
  recentLiquidations: Liquidation[];
  timestamp: number;
}

/** One row of the funding-rates board — a perp's funding + open interest. */
export interface FundingRow {
  /** Display symbol, e.g. BTC/USDT. */
  symbol: string;
  /** Funding rate as a fraction (0.0001 = 0.01%); null if unavailable. */
  fundingRate: number | null;
  /** Epoch millis of the next funding. */
  nextFundingTime: number | null;
  markPrice: number | null;
  /** Open interest notional in quote units. */
  openInterestValue: number | null;
}

/** One historical funding settlement for a perp. */
export interface FundingHistoryPoint {
  /** Epoch millis of the settlement. */
  time: number;
  /** Funding rate as a fraction (0.0001 = 0.01%); null if unavailable. */
  fundingRate: number | null;
}

/** A single row in the crypto screener. */
export interface ScreenerRow {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  /** 24h base-asset volume. */
  volume: number | null;
  /** 24h quote (notional) volume. */
  quoteVolume: number | null;
}

// ---------------------------------------------------------------------------
// API envelopes
// ---------------------------------------------------------------------------

/** Standard error body returned by the API on failure. */
export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

/** Metadata about the running server, surfaced at /api/health. */
export interface HealthResponse {
  status: 'ok';
  provider: string;
  /** Whether the active provider reaches a live upstream or returns synthetic data. */
  live: boolean;
  time: number;
  version: string;
}

// ---------------------------------------------------------------------------
// Type guards / helpers
// ---------------------------------------------------------------------------

export function isInterval(value: string): value is Interval {
  return (INTERVALS as readonly string[]).includes(value);
}

export function isRange(value: string): value is Range {
  return (RANGES as readonly string[]).includes(value);
}

// Alert data contract + pure evaluator, shared by client and server.
export * from './alerts';

// Auth data contract, shared by client and server.
export * from './auth';
