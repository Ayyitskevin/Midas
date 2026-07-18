/**
 * Market-data shapes — quotes, candles, order books, venue compare, liquidations,
 * on-chain/DEX pools, derivatives, funding and the screener row. Part of the
 * @midas/shared data contract (re-exported from index.ts).
 */

import type { Interval, Range } from './chart';

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

/** One venue's top-of-book for a symbol, in the cross-venue arb screener. */
export interface VenuePricePoint {
  exchange: string;
  bid: number | null;
  ask: number | null;
  /** Last / mid price. */
  price: number;
}

/**
 * One row of the cross-venue arb screener — a symbol's price disagreement
 * across the compare set, reduced to the sell-here / buy-here legs and the
 * spread. Extends the single-symbol ARB view to a whole board so the widest
 * cross-venue dispersions (and any crossed books) sort to the top.
 */
export interface VenueArbRow {
  /** Display symbol, e.g. BTC/USDT. */
  symbol: string;
  /** Per-venue top-of-book, sorted by price (dearest first). */
  venues: VenuePricePoint[];
  /** Highest bid across venues — sell here; null if none reported. */
  bestBid: { exchange: string; value: number } | null;
  /** Lowest ask across venues — buy here; null if none reported. */
  bestAsk: { exchange: string; value: number } | null;
  /** (bestBid − bestAsk) / bestAsk in basis points; null with < 2 quoting venues. Positive ⇒ crossed. */
  spreadBps: number | null;
  /** True when the highest bid exceeds the lowest ask across venues — a gross-of-fees arb. */
  crossed: boolean;
  /** (max − min) / min of last price across venues, in bps — how much venues disagree; null with < 2. */
  dispersionBps: number | null;
  /** Cheapest last price across venues; null if none. */
  priceMin: number | null;
  /** Dearest last price across venues; null if none. */
  priceMax: number | null;
}

/**
 * Reduce a symbol's per-venue quotes into a cross-venue arb row: the best bid
 * (sell here) and best ask (buy here) across venues, their spread in bps (the
 * arb signal — positive means a crossed, gross-of-fees arb), and the last-price
 * dispersion (how much venues disagree). Pure; ignores venues with a
 * non-positive price and bid/ask legs that are null or ≤ 0. `spreadBps` and
 * `dispersionBps` are null unless at least two venues quote.
 */
export function computeVenueArbRow(symbol: string, quotes: VenueQuote[]): VenueArbRow {
  const venues: VenuePricePoint[] = quotes
    .map((q) => ({ exchange: q.exchange, bid: q.bid, ask: q.ask, price: q.price }))
    .sort((a, b) => b.price - a.price);

  let bestBid: { exchange: string; value: number } | null = null;
  let bestAsk: { exchange: string; value: number } | null = null;
  let priceMin: number | null = null;
  let priceMax: number | null = null;
  let priced = 0;
  for (const v of venues) {
    if (v.bid != null && v.bid > 0 && (bestBid === null || v.bid > bestBid.value)) {
      bestBid = { exchange: v.exchange, value: v.bid };
    }
    if (v.ask != null && v.ask > 0 && (bestAsk === null || v.ask < bestAsk.value)) {
      bestAsk = { exchange: v.exchange, value: v.ask };
    }
    if (v.price > 0) {
      priced++;
      if (priceMin === null || v.price < priceMin) priceMin = v.price;
      if (priceMax === null || v.price > priceMax) priceMax = v.price;
    }
  }

  // A cross-venue spread needs the two legs on *different* venues; a single
  // venue holding both the best bid and best ask is its own book, not an arb.
  const crossVenue = bestBid !== null && bestAsk !== null && bestBid.exchange !== bestAsk.exchange;
  const spread = crossVenue && bestBid && bestAsk ? bestBid.value - bestAsk.value : null;
  const spreadBps = spread !== null && bestAsk ? (spread / bestAsk.value) * 10_000 : null;
  const dispersionBps =
    priced >= 2 && priceMin !== null && priceMax !== null && priceMin > 0
      ? ((priceMax - priceMin) / priceMin) * 10_000
      : null;

  return {
    symbol,
    venues,
    bestBid,
    bestAsk,
    spreadBps,
    crossed: spread !== null && spread > 0,
    dispersionBps,
    priceMin,
    priceMax,
  };
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
  /**
   * True when the events are synthetic (the in-browser demo). A synthetic feed
   * is NEVER presented as 'live' — the panel shows a 'demo' state instead, even
   * though `available` is true (it does surface events, they just aren't real).
   */
  synthetic?: boolean;
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

/** One venue's funding rate for a perp, in the cross-venue dispersion board. */
export interface FundingVenuePoint {
  exchange: string;
  /** Funding rate as a fraction (0.0001 = 0.01%); null if unavailable. */
  fundingRate: number | null;
  /** Epoch millis of the next funding. */
  nextFundingTime: number | null;
}

/**
 * One row of the cross-venue funding-dispersion board — a perp's funding rate
 * across the compare set, reduced to the spread (the arb signal). Extends the
 * single-perp {@link VenueDerivatives} view to a whole board, so the widest
 * cross-venue funding spreads (the best funding-arb candidates) sort to the top.
 */
export interface FundingDispersionRow {
  /** Display symbol, e.g. BTC/USDT. */
  symbol: string;
  /** Per-venue funding points that reported a rate, sorted dearest → cheapest. */
  venues: FundingVenuePoint[];
  /** Lowest funding across venues (fraction); null if none reported. */
  minRate: number | null;
  /** Highest funding across venues (fraction); null if none reported. */
  maxRate: number | null;
  /** Mean funding across the reporting venues (fraction); null if none. */
  meanRate: number | null;
  /** (max − min) funding in basis points — the arb signal; null with < 2 venues. */
  spreadBps: number | null;
  /** Venue with the highest funding (dearest to be long → short it); null if none. */
  highVenue: string | null;
  /** Venue with the lowest funding (cheapest to be long → long it); null if none. */
  lowVenue: string | null;
  /** Aggregate open-interest notional across venues (quote units); null if none. */
  totalOiValue: number | null;
}

/**
 * Reduce a perp's per-venue derivatives into a cross-venue funding-dispersion
 * row: the funding extremes and their spread (the funding-arb signal — long the
 * cheapest-funded venue, short the dearest), the mean, and aggregate open
 * interest. Pure; ignores venues that report no funding rate. Returned venues
 * are sorted by funding rate, dearest first. `spreadBps` is null (no arb signal)
 * unless at least two venues report a rate.
 */
export function computeFundingDispersion(
  symbol: string,
  rows: VenueDerivatives[],
): FundingDispersionRow {
  const funded = rows
    .filter(
      (r): r is VenueDerivatives & { fundingRate: number } =>
        r.fundingRate != null && Number.isFinite(r.fundingRate),
    )
    .map((r) => ({ exchange: r.exchange, fundingRate: r.fundingRate, nextFundingTime: r.nextFundingTime }))
    .sort((a, b) => b.fundingRate - a.fundingRate); // dearest → cheapest

  const maxRate = funded.length ? funded[0].fundingRate : null;
  const minRate = funded.length ? funded[funded.length - 1].fundingRate : null;
  const highVenue = funded.length ? funded[0].exchange : null;
  const lowVenue = funded.length ? funded[funded.length - 1].exchange : null;
  const meanRate = funded.length
    ? funded.reduce((s, p) => s + p.fundingRate, 0) / funded.length
    : null;
  const spreadBps =
    funded.length >= 2 && maxRate !== null && minRate !== null ? (maxRate - minRate) * 10_000 : null;

  let totalOiValue: number | null = null;
  for (const r of rows) {
    if (r.openInterestValue != null && Number.isFinite(r.openInterestValue)) {
      totalOiValue = (totalOiValue ?? 0) + r.openInterestValue;
    }
  }

  return { symbol, venues: funded, minRate, maxRate, meanRate, spreadBps, highVenue, lowVenue, totalOiValue };
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
