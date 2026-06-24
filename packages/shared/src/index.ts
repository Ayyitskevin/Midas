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
