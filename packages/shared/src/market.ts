/**
 * Market-data shapes — quotes, candles, order books, venue compare, liquidations,
 * on-chain/DEX pools, derivatives, funding and the screener row. Part of the
 * @midas/shared data contract (re-exported from index.ts).
 */

import type { Interval, Range } from './chart';
import type { DataReceipt } from './dataTrust';
import { netSpreadBps, roundTripFeesBps } from './fees';

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
  /** Epoch millis reported by the source; null when the source omits time. */
  asOf: number | null;
  /** Versioned source evidence for this quote. */
  receipt?: DataReceipt;
}

/** Response to a history (candles) request. */
export interface HistoryResponse {
  symbol: string;
  interval: Interval;
  range: Range;
  currency: string;
  candles: Candle[];
  /** Versioned source evidence for this history series. */
  receipt?: DataReceipt;
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
  /** Executable base-asset size at the reported bid; null/absent when unknown. */
  bidSize?: number | null;
  /** Executable base-asset size at the reported ask; null/absent when unknown. */
  askSize?: number | null;
  changePercent: number;
  /** Base-asset 24h volume. */
  volume: number | null;
  timestamp: number | null;
  receipt?: DataReceipt;
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
  /**
   * Round-trip reference taker fees (buy leg + sell leg) in bps, from the static
   * reference schedule in fees.ts; null when the legs are unresolved or either
   * venue is missing from the schedule. Excludes withdrawal/transfer costs.
   */
  feeBps: number | null;
  /**
   * `spreadBps − feeBps` — the crossed spread net of reference taker fees; null
   * when the spread or either venue's fee tier is unknown (never assumed 0).
   */
  netSpreadBps: number | null;
  /** True only when complete fee, size, and aligned-time evidence yields a positive net spread. */
  netCrossed: boolean;
  /** Maximum common executable base-asset size across the selected legs. */
  executableSize: number | null;
  /** Absolute source timestamp difference between the selected legs. */
  timestampSkewMs: number | null;
  /** Why an executable net calculation is unavailable; empty only with complete evidence. */
  netLimitations: string[];
  /** (max − min) / min of last price across venues, in bps — how much venues disagree; null with < 2. */
  dispersionBps: number | null;
  /** Cheapest last price across venues; null if none. */
  priceMin: number | null;
  /** Dearest last price across venues; null if none. */
  priceMax: number | null;
  /** Derived lineage for the cross-venue calculation. */
  receipt?: DataReceipt;
}

/**
 * Reduce a symbol's per-venue quotes into a cross-venue arb row: the best bid
 * (sell here) and best ask (buy here) across venues, their spread in bps (the
 * arb signal — positive means a crossed, gross-of-fees arb), that spread net of
 * reference taker fees (`feeBps`/`netSpreadBps`/`netCrossed` — the actionable
 * figure), and the last-price dispersion (how much venues disagree). A net
 * figure additionally requires positive bid/ask sizes and source timestamps
 * aligned within `VENUE_ARB_MAX_TIMESTAMP_SKEW_MS`. Pure;
 * ignores venues with a non-positive price and bid/ask legs that are null or
 * ≤ 0. `spreadBps` and `dispersionBps` are null unless at least two venues
 * quote; the net fields are null whenever the spread, a leg's fee tier, size,
 * or aligned timestamp evidence is unknown.
 */
export const VENUE_ARB_MAX_TIMESTAMP_SKEW_MS = 10_000;
/** Absolute quote age allowed for an actionable top-of-book comparison. */
export const VENUE_ARB_MAX_QUOTE_AGE_MS = 30_000;

export function computeVenueArbRow(
  symbol: string,
  quotes: VenueQuote[],
  evaluatedAtMs: number = Date.now(),
): VenueArbRow {
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
  // Net of reference taker fees (buy at bestAsk's venue, sell at bestBid's).
  // Null whenever the spread or either venue's fee tier is unknown — a gross
  // crossed book with unknown fees is not shown as actionable.
  const feeBps = crossVenue && bestBid && bestAsk ? roundTripFeesBps(bestAsk.exchange, bestBid.exchange) : null;
  const bestBidQuote = bestBid
    ? quotes.find((quote) => quote.exchange === bestBid.exchange && quote.bid === bestBid.value)
    : undefined;
  const bestAskQuote = bestAsk
    ? quotes.find((quote) => quote.exchange === bestAsk.exchange && quote.ask === bestAsk.value)
    : undefined;
  const bidSize = positiveFinite(bestBidQuote?.bidSize);
  const askSize = positiveFinite(bestAskQuote?.askSize);
  const executableSize = crossVenue && bidSize !== null && askSize !== null ? Math.min(bidSize, askSize) : null;
  const bidTime = finiteTimestamp(bestBidQuote?.timestamp);
  const askTime = finiteTimestamp(bestAskQuote?.timestamp);
  const timestampSkewMs = crossVenue && bidTime !== null && askTime !== null ? Math.abs(bidTime - askTime) : null;
  const netLimitations: string[] = [];
  if (crossVenue) {
    if (feeBps === null) netLimitations.push('A required venue fee tier is unknown.');
    if (executableSize === null) netLimitations.push('Executable bid/ask size is unknown.');
    if (timestampSkewMs === null) netLimitations.push('A required leg timestamp is unknown.');
    else if (timestampSkewMs > VENUE_ARB_MAX_TIMESTAMP_SKEW_MS) {
      netLimitations.push(
        `Selected leg timestamps are ${timestampSkewMs}ms apart (maximum ${VENUE_ARB_MAX_TIMESTAMP_SKEW_MS}ms).`,
      );
    }
    for (const [leg, quote, timestamp] of [
      ['bid', bestBidQuote, bidTime],
      ['ask', bestAskQuote, askTime],
    ] as const) {
      if (timestamp === null) continue;
      const ageMs = evaluatedAtMs - timestamp;
      if (!Number.isFinite(ageMs) || ageMs < 0) {
        netLimitations.push(`Selected ${leg} timestamp is in the future (clock skew).`);
      } else if (ageMs > VENUE_ARB_MAX_QUOTE_AGE_MS) {
        netLimitations.push(
          `Selected ${leg} quote is ${ageMs}ms old (maximum ${VENUE_ARB_MAX_QUOTE_AGE_MS}ms).`,
        );
      }
      if (!quote?.receipt) {
        netLimitations.push(`Selected ${leg} quote has no source receipt.`);
      } else if (quote.receipt.freshness.state !== 'fresh') {
        netLimitations.push(`Selected ${leg} receipt is not fresh.`);
      }
    }
  } else {
    netLimitations.push('Distinct buy and sell venues are required.');
  }
  const net = netLimitations.length === 0 && bestBid && bestAsk
    ? netSpreadBps(spreadBps, bestAsk.exchange, bestBid.exchange)
    : null;
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
    feeBps,
    netSpreadBps: net,
    netCrossed: net !== null && net > 0,
    executableSize,
    timestampSkewMs,
    netLimitations,
    dispersionBps,
    priceMin,
    priceMax,
  };
}

function positiveFinite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function finiteTimestamp(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * A single venue's perpetual funding & open interest, for the cross-exchange
 * derivatives view (same perp, many exchanges). Funding diverges across venues,
 * so comparing them surfaces funding-arbitrage and crowding signals.
 */
export interface VenueDerivatives {
  exchange: string;
  /** Funding rate as a fraction (0.0001 = 0.01%) per settlement interval; null if unavailable. */
  fundingRate: number | null;
  /**
   * Hours between funding settlements (1 = hourly, 4/8 = the common cadences);
   * null when the venue does not report it. Funding cadence varies by venue, so
   * consumers must never assume 8h — an unknown interval means no annualized or
   * cross-venue-normalized figure can be honestly derived from `fundingRate`.
   */
  fundingIntervalHours?: number | null;
  /** Epoch millis of the next funding. */
  nextFundingTime: number | null;
  markPrice: number | null;
  /** Open interest notional in quote units; null if unavailable. */
  openInterestValue: number | null;
  /** Upstream observation timestamp; null when the venue omits it. */
  timestamp: number | null;
  receipt?: DataReceipt;
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
  /**
   * Venue this event was observed on. Optional for back-compatibility with
   * single-source feeds; a cross-venue aggregate always sets it, because an
   * untagged event in a merged stream cannot be attributed or audited.
   */
  source?: string;
}

/**
 * Recent public liquidations observed on one venue for one perp.
 *
 * `available: false` is a first-class result, not an error: a venue that
 * publishes no public feed contributes an honest zero to coverage instead of
 * failing the whole fan-out.
 */
export interface VenueLiquidations {
  /** Venue display name or id. */
  exchange: string;
  /** Whether this venue exposes a public liquidation feed at all. */
  available: boolean;
  /** Events observed from this venue. Empty when unavailable or simply quiet. */
  liquidations: Liquidation[];
  /** Newest upstream observation time; null when nothing was observed. */
  timestamp: number | null;
  receipt?: DataReceipt;
}

/** One symbol's liquidations as seen across the configured venue set. */
export interface SymbolVenueLiquidations {
  symbol: string;
  venues: VenueLiquidations[];
}

/**
 * A cross-venue liquidation roll-up.
 *
 * `multiple` is the headline honesty number: how much larger the union across
 * venues is than the single reference venue alone. It is a **lower bound on a
 * lower bound** — every contributing feed is itself throttled — and must never
 * be presented as the recovered "true" volume.
 */
export interface LiquidationsAggregate {
  /** Union of every venue's events, newest first, each tagged with its source. */
  events: LiquidationEvent[];
  /** Per-venue observations, ready for {@link computeLiquidationSourceStatuses}. */
  observations: LiquidationSourceObservation[];
  /** Σ notional across every sampled venue. */
  totalValue: number;
  /** The venue used as the single-source denominator. */
  referenceSource: string | null;
  /** Σ notional from {@link referenceSource} alone; null when it was not sampled. */
  referenceValue: number | null;
  /** `totalValue / referenceValue`. Null when the reference contributed nothing. */
  multiple: number | null;
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
  /**
   * Every venue this provider is *configured* to read liquidations from — the
   * denominator of source coverage. Declared capability only: it says nothing
   * about whether a venue was read for any particular sweep, and nothing about
   * how many events it produced. Providers that read exactly one venue may omit
   * it; the feed then reports a single-source status derived from the flat
   * fields above.
   */
  sources?: LiquidationSourceCapability[];
  /**
   * The provider's primary venue, keyed to match {@link sources}. It is the
   * single-source reference the cross-venue aggregate is measured against —
   * what a one-venue feed would have shown — not a claim that only this venue
   * is read. Present because `source` is a display name (`ccxt:binance`) while
   * `sources` is keyed by venue id (`binance`), so the two have to be matched
   * explicitly rather than guessed by position.
   */
  sampledSource?: string;
  receipt?: DataReceipt;
}

/**
 * One venue a provider can read liquidations from, as a *declared capability*.
 *
 * `throttled` is deliberately capability-derived and never inferred from how
 * many events were observed: every public exchange liquidation stream is
 * documented as throttled to ~1/sec and under-reporting many-fold, so a venue
 * that publishes at all publishes a throttled feed. Counting events instead
 * would mislabel a genuinely quiet market as "throttled" and a busy throttled
 * feed as complete.
 */
export interface LiquidationSourceCapability {
  /** Venue id (`binance`, `okx`) or `mock`/`demo` for synthetic sources. */
  source: string;
  /** Whether this venue exposes a public liquidation feed at all. */
  available: boolean;
  /** Whether that public feed is a throttled stream. Capability, not event count. */
  throttled: boolean;
  /** True when this source fabricates events (mock/demo). Never rendered live. */
  synthetic?: boolean;
  /** Honest one-line reason — the throttle caveat, or why there is no feed. */
  note?: string | null;
}

/** What one liquidation source actually produced during a single feed sweep. */
export interface LiquidationSourceObservation {
  /** Must match a {@link LiquidationSourceCapability.source} (case-insensitive). */
  source: string;
  /** Events observed from this source in this sweep. */
  eventCount: number;
  /** Newest observed event time, or null when the source produced nothing. */
  lastEventAt: number | null;
}

/**
 * A configured liquidation source's declared capability joined with what it
 * actually produced this sweep.
 *
 * `stale` is a three-state value on purpose. `null` means *unknown*, and unknown
 * is never rounded to a reassuring `false`: a source that was read but produced
 * no events is indistinguishable from a quiet market, and a source whose newest
 * event is ahead of our clock has told us nothing trustworthy about freshness.
 */
export interface LiquidationSourceStatus {
  source: string;
  /** True when this source was actually read for this feed. */
  sampled: boolean;
  available: boolean;
  throttled: boolean;
  synthetic: boolean;
  eventCount: number;
  lastEventAt: number | null;
  /** `asOf − lastEventAt`; null when no event time is known. Negative = clock skew. */
  ageMs: number | null;
  /** `ageMs > maxAgeMs`; null when freshness is unknowable (see above). */
  stale: boolean | null;
  note: string | null;
}

/**
 * The cross-venue roll-up facts a feed carries alongside its events.
 *
 * Every field is nullable because "not computed" and "computed as zero" are
 * different claims and the panel must be able to tell them apart.
 */
export interface LiquidationsAggregateMeta {
  /** Σ notional across sampled venues; null when no aggregate was computed. */
  totalValue: number | null;
  /** The venue used as the single-source denominator for {@link multiple}. */
  referenceSource: string | null;
  /** Σ notional from the reference venue alone. */
  referenceValue: number | null;
  /**
   * `totalValue / referenceValue` — how much more the union sees than one venue.
   * A **lower bound**: every contributing feed is itself throttled. This is
   * never the recovered "true" volume and must never be labeled as such.
   */
  multiple: number | null;
}

/** How much of the configured source set this feed actually covers. */
export interface LiquidationsCoverage {
  /** Sources the provider is configured to read — the denominator. */
  configured: number;
  /** Sources actually read this sweep. */
  sampled: number;
  /** Sources that returned at least one event. */
  reporting: number;
  /** `reporting / configured`; null when nothing is configured. */
  ratio: number | null;
}

/**
 * How long a liquidation source may go without a new event before it is stale.
 *
 * Derived, not chosen. The `liquidations` dataset family declares
 * `expectedCadenceMs: 1_000` and `maxAgeMs: 60_000` in the provider capability
 * manifest — the documented ~1/sec public-stream throttle. 60s is 60x that
 * expected cadence, so a venue that publishes nothing for a full minute has
 * stopped publishing rather than merely gone quiet between ticks. It is also
 * well above both the panel's 8s poll and the route's cache TTL, so a `stale`
 * label can never be an artifact of Midas's own caching.
 */
export const LIQUIDATION_SOURCE_MAX_AGE_MS = 60_000;

const liquidationSourceKey = (source: string): string => source.trim().toLowerCase();

/**
 * Join declared source capabilities with observed events into per-source status.
 *
 * Pure and clock-injected — `asOf` is a parameter so freshness boundaries are
 * testable rather than wall-clock dependent. An observation whose source matches
 * no declared capability is appended as its own status rather than dropped:
 * silently discarding sampled evidence is exactly the failure this contract
 * exists to prevent.
 */
export function computeLiquidationSourceStatuses(
  capabilities: LiquidationSourceCapability[],
  observations: LiquidationSourceObservation[],
  asOf: number,
  maxAgeMs: number = LIQUIDATION_SOURCE_MAX_AGE_MS,
): LiquidationSourceStatus[] {
  const observed = new Map<string, LiquidationSourceObservation>();
  for (const o of observations) observed.set(liquidationSourceKey(o.source), o);

  const matched = new Set<string>();
  const statuses = capabilities.map((cap) => {
    const key = liquidationSourceKey(cap.source);
    const o = observed.get(key);
    if (o) matched.add(key);
    return liquidationSourceStatus(cap, o, asOf, maxAgeMs);
  });

  for (const o of observations) {
    const key = liquidationSourceKey(o.source);
    if (matched.has(key) || key === '') continue;
    matched.add(key);
    statuses.push(
      liquidationSourceStatus(
        { source: o.source, available: true, throttled: true, note: null },
        o,
        asOf,
        maxAgeMs,
      ),
    );
  }
  return statuses;
}

function liquidationSourceStatus(
  cap: LiquidationSourceCapability,
  o: LiquidationSourceObservation | undefined,
  asOf: number,
  maxAgeMs: number,
): LiquidationSourceStatus {
  const synthetic = Boolean(cap.synthetic);
  const sampled = o !== undefined;
  const eventCount = o && Number.isFinite(o.eventCount) ? Math.max(0, Math.floor(o.eventCount)) : 0;
  const lastEventAt =
    o && o.lastEventAt != null && Number.isFinite(o.lastEventAt) ? o.lastEventAt : null;
  const ageMs = lastEventAt === null ? null : asOf - lastEventAt;

  let stale: boolean | null;
  let note = cap.note ?? null;
  if (!cap.available) {
    stale = null;
    note = cap.note ?? `${cap.source} exposes no public liquidation feed.`;
  } else if (!sampled) {
    stale = null;
    note = 'Configured for cross-venue reads but not sampled by this feed.';
  } else if (ageMs === null) {
    stale = null;
    note = 'Sampled but produced no events — a quiet market and a dropped feed look identical here.';
  } else if (ageMs < 0) {
    stale = null;
    note = 'Newest event is ahead of this clock; freshness is unknown, not fresh.';
  } else {
    stale = ageMs > maxAgeMs;
  }

  return {
    source: cap.source,
    sampled,
    available: cap.available,
    // A source with no public feed has nothing to throttle, and fabricated
    // events are not a throttled upstream stream.
    throttled: cap.available && !synthetic && cap.throttled,
    synthetic,
    eventCount,
    lastEventAt,
    ageMs,
    stale,
    note,
  };
}

/**
 * Union a cross-venue liquidation read into one feed, tagged and measured.
 *
 * **Union, not average, and never deduplicated.** Each venue's liquidations are
 * its own disjoint real events: a position closed on OKX is a different position
 * from one closed on Bybit. This is the opposite of *price*, where N venues are
 * N observations of one quantity and the honest reduction is dispersion (see
 * `computeVenueArbRow`) — summing prices would be meaningless. Deduplicating
 * "similar" liquidations across venues would silently delete real events, and
 * averaging them would understate the market by a factor of the venue count.
 *
 * The resulting total is still a **lower bound**: every contributing feed is
 * independently throttled and documented to under-report, so the union
 * under-reports too. `multiple` measures how much the aggregate recovers over a
 * single venue — not how much of the market is now captured.
 *
 * Pure and clock-free: ordering comes from event timestamps only.
 */
export function computeLiquidationsAggregate(
  perSymbol: SymbolVenueLiquidations[],
  referenceSource: string | null = null,
): LiquidationsAggregate {
  const events: LiquidationEvent[] = [];
  const counts = new Map<string, { source: string; eventCount: number; lastEventAt: number | null }>();

  for (const { symbol, venues } of perSymbol) {
    for (const venue of venues) {
      const key = liquidationSourceKey(venue.exchange);
      if (key === '') continue;
      const entry = counts.get(key) ?? { source: venue.exchange, eventCount: 0, lastEventAt: null };
      // A venue that was read contributes an observation even with zero events —
      // that is what distinguishes "quiet" from "never sampled" downstream.
      counts.set(key, entry);
      for (const l of venue.liquidations) {
        if (!Number.isFinite(l.price) || !Number.isFinite(l.amount) || !Number.isFinite(l.timestamp)) continue;
        events.push({
          symbol,
          side: l.side,
          price: l.price,
          amount: l.amount,
          value: l.price * l.amount,
          timestamp: l.timestamp,
          source: venue.exchange,
        });
        entry.eventCount += 1;
        if (entry.lastEventAt === null || l.timestamp > entry.lastEventAt) entry.lastEventAt = l.timestamp;
      }
    }
  }

  events.sort((a, b) => b.timestamp - a.timestamp);
  const totalValue = events.reduce((sum, e) => sum + e.value, 0);

  const referenceKey = referenceSource === null ? '' : liquidationSourceKey(referenceSource);
  const referenceValue =
    referenceKey === '' || !counts.has(referenceKey)
      ? null
      : events.reduce(
          (sum, e) => (e.source !== undefined && liquidationSourceKey(e.source) === referenceKey ? sum + e.value : sum),
          0,
        );

  return {
    events,
    observations: [...counts.values()],
    totalValue,
    referenceSource,
    referenceValue,
    // A zero denominator yields no multiple rather than Infinity: "the reference
    // venue published nothing" is not "infinitely better coverage".
    multiple: referenceValue !== null && referenceValue > 0 ? totalValue / referenceValue : null,
  };
}

/** Reduce per-source status into the feed's source-coverage ratio. */
export function computeLiquidationsCoverage(
  statuses: LiquidationSourceStatus[],
): LiquidationsCoverage {
  const configured = statuses.length;
  return {
    configured,
    sampled: statuses.filter((s) => s.sampled).length,
    reporting: statuses.filter((s) => s.eventCount > 0).length,
    ratio: configured > 0 ? statuses.filter((s) => s.eventCount > 0).length / configured : null,
  };
}

/** {@link LiquidationsProvenance} stamped with the time the feed was assembled. */
export interface LiquidationsMeta extends LiquidationsProvenance {
  /** Epoch millis the feed was assembled. */
  asOf: number;
  /**
   * Per-source status for every configured source. Required, not optional: an
   * aggregate that hides how many of its sources were absent or stale
   * manufactures confidence it has not earned. This narrows the provenance's
   * declared {@link LiquidationSourceCapability} list — a status carries every
   * capability field plus what the source actually produced.
   */
  sources: LiquidationSourceStatus[];
  /** Source coverage for this sweep. */
  coverage: LiquidationsCoverage;
  /** Cross-venue roll-up facts; all-null when the feed did not fan out. */
  aggregate: LiquidationsAggregateMeta;
}

/** The market-wide liquidations feed plus its provenance metadata. */
export interface LiquidationsFeed {
  events: LiquidationEvent[];
  meta: LiquidationsMeta;
  receipt?: DataReceipt;
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
  /** Current funding rate as a fraction (0.0001 = 0.01%) per settlement interval. */
  fundingRate: number | null;
  /**
   * Hours between funding settlements (1 = hourly, 4/8 = the common cadences);
   * null when the venue does not report it — never assume 8h when annualizing.
   */
  fundingIntervalHours?: number | null;
  /** Epoch millis of the next funding. */
  nextFundingTime: number | null;
  markPrice: number | null;
  indexPrice: number | null;
  /** Open interest in base units. */
  openInterest: number | null;
  /** Open interest notional in quote units. */
  openInterestValue: number | null;
  recentLiquidations: Liquidation[];
  /** Oldest required upstream component timestamp; null when unknown. */
  timestamp: number | null;
  /** Evidence for this bundled funding/OI/liquidations provider snapshot. */
  receipt?: DataReceipt;
}

/** One row of the funding-rates board — a perp's funding + open interest. */
export interface FundingRow {
  /** Display symbol, e.g. BTC/USDT. */
  symbol: string;
  /** Funding rate as a fraction (0.0001 = 0.01%) per settlement interval; null if unavailable. */
  fundingRate: number | null;
  /**
   * Hours between funding settlements; null when the venue does not report it.
   * Annualized figures must be omitted (null), not computed on an assumed 8h.
   */
  fundingIntervalHours?: number | null;
  /** Epoch millis of the next funding. */
  nextFundingTime: number | null;
  markPrice: number | null;
  /** Open interest notional in quote units. */
  openInterestValue: number | null;
  receipt?: DataReceipt;
}

/** One venue's funding rate for a perp, in the cross-venue dispersion board. */
export interface FundingVenuePoint {
  exchange: string;
  /** Raw per-interval funding rate as a fraction (0.0001 = 0.01%); null if unavailable. */
  fundingRate: number | null;
  /** This venue's settlement interval in hours; null when unreported. */
  fundingIntervalHours?: number | null;
  /** Epoch millis of the next funding. */
  nextFundingTime: number | null;
}

/**
 * One row of the cross-venue funding-dispersion board — a perp's funding rate
 * across the compare set, reduced to the spread (the arb signal). Extends the
 * single-perp {@link VenueDerivatives} view to a whole board, so the widest
 * cross-venue funding spreads (the best funding-arb candidates) sort to the top.
 *
 * Venues settle funding on different cadences (1h, 4h, 8h), so every venue's
 * rate is normalized to a per-8h-equivalent before the extremes, mean and
 * spread are computed — `minRate`/`maxRate`/`meanRate`/`spreadBps` are all on
 * that normalized basis. The raw per-interval rates stay on the venue points
 * alongside their intervals.
 */
export interface FundingDispersionRow {
  /** Display symbol, e.g. BTC/USDT. */
  symbol: string;
  /** Per-venue funding points with a known interval, sorted by normalized (per-8h) rate, dearest → cheapest. */
  venues: FundingVenuePoint[];
  /** Lowest normalized (per-8h) funding across venues (fraction); null if none comparable. */
  minRate: number | null;
  /** Highest normalized (per-8h) funding across venues (fraction); null if none comparable. */
  maxRate: number | null;
  /** Mean normalized (per-8h) funding across the comparable venues (fraction); null if none. */
  meanRate: number | null;
  /** (max − min) normalized funding in basis points — the arb signal; null with < 2 comparable venues. */
  spreadBps: number | null;
  /** Venue with the highest normalized funding (dearest to be long → short it); null if none. */
  highVenue: string | null;
  /** Venue with the lowest normalized funding (cheapest to be long → long it); null if none. */
  lowVenue: string | null;
  /** Aggregate open-interest notional across venues (quote units); null if none. */
  totalOiValue: number | null;
  receipt?: DataReceipt;
}

/**
 * Reduce a perp's per-venue derivatives into a cross-venue funding-dispersion
 * row: the funding extremes and their spread (the funding-arb signal — long the
 * cheapest-funded venue, short the dearest), the mean, and aggregate open
 * interest. Pure.
 *
 * Funding settles on different cadences per venue, so each venue's rate is
 * first normalized to a per-8h-equivalent (rate × 8 / intervalHours) — a 0.01%
 * hourly rate is 8× a 0.01% 8h rate, and comparing raw per-interval rates
 * would fabricate (or erase) the spread exactly when intervals differ. Venues
 * that report no funding rate, or no settlement interval, are excluded from
 * the comparison rather than silently compared raw; `spreadBps` is null (no
 * arb signal) unless at least two venues are comparable.
 */
export function computeFundingDispersion(
  symbol: string,
  rows: VenueDerivatives[],
): FundingDispersionRow {
  const comparable = rows
    .filter(
      (r): r is VenueDerivatives & { fundingRate: number; fundingIntervalHours: number } =>
        r.fundingRate != null &&
        Number.isFinite(r.fundingRate) &&
        r.fundingIntervalHours != null &&
        Number.isFinite(r.fundingIntervalHours) &&
        r.fundingIntervalHours > 0,
    )
    .map((r) => ({
      point: {
        exchange: r.exchange,
        fundingRate: r.fundingRate, // raw per-interval rate, labeled by fundingIntervalHours
        fundingIntervalHours: r.fundingIntervalHours,
        nextFundingTime: r.nextFundingTime,
      },
      normalized: (r.fundingRate * 8) / r.fundingIntervalHours, // per-8h-equivalent
    }))
    .sort((a, b) => b.normalized - a.normalized); // dearest → cheapest

  const venues = comparable.map((c) => c.point);
  const maxRate = comparable.length ? comparable[0].normalized : null;
  const minRate = comparable.length ? comparable[comparable.length - 1].normalized : null;
  const highVenue = comparable.length ? comparable[0].point.exchange : null;
  const lowVenue = comparable.length ? comparable[comparable.length - 1].point.exchange : null;
  const meanRate = comparable.length
    ? comparable.reduce((s, c) => s + c.normalized, 0) / comparable.length
    : null;
  const spreadBps =
    comparable.length >= 2 && maxRate !== null && minRate !== null ? (maxRate - minRate) * 10_000 : null;

  let totalOiValue: number | null = null;
  for (const r of rows) {
    if (r.openInterestValue != null && Number.isFinite(r.openInterestValue)) {
      totalOiValue = (totalOiValue ?? 0) + r.openInterestValue;
    }
  }

  return { symbol, venues, minRate, maxRate, meanRate, spreadBps, highVenue, lowVenue, totalOiValue };
}

/** One venue's open interest for a perp, in the cross-venue OI/crowding board. */
export interface VenueOiPoint {
  exchange: string;
  /** Open-interest notional in quote units; null if unavailable. */
  openInterestValue: number | null;
  /** This venue's share of the total OI (0..1); null when the total is unknown. */
  share: number | null;
}

/**
 * One row of the cross-venue OI / crowding board — a perp's open interest
 * aggregated across the compare set, plus how concentrated it is on a single
 * venue. High total OI with a high top-venue share is venue/crowding risk
 * (one exchange holds most of the leverage). Complements FUNDX (funding) and
 * XARB (price) with the size/positioning dimension.
 */
export interface OiConcentrationRow {
  /** Display symbol, e.g. BTC/USDT. */
  symbol: string;
  /** Per-venue OI that reported a value, sorted largest first. */
  venues: VenueOiPoint[];
  /** Aggregate OI notional across venues (quote units); null if none reported. */
  totalOiValue: number | null;
  /** Venue holding the most OI; null if none reported. */
  topVenue: string | null;
  /** Top venue's share of the total (0..1); null if none. */
  topVenueShare: number | null;
  /** Herfindahl concentration index — Σ(shareᵢ²), 0..1 (1 = all on one venue); null if none. */
  herfindahl: number | null;
  /** Number of venues reporting OI. */
  venueCount: number;
  receipt?: DataReceipt;
}

/**
 * Reduce a perp's per-venue derivatives into an OI-concentration row: the
 * aggregate open interest across venues, each venue's share, and how
 * concentrated it is (top-venue share + Herfindahl index). Pure; ignores
 * venues that report no positive OI. A single reporting venue is a valid row
 * (share 1, HHI 1) — that IS maximum crowding, so it is not filtered out here.
 */
export function computeOiConcentration(symbol: string, rows: VenueDerivatives[]): OiConcentrationRow {
  const reporting = rows.filter(
    (r): r is VenueDerivatives & { openInterestValue: number } =>
      r.openInterestValue != null && Number.isFinite(r.openInterestValue) && r.openInterestValue > 0,
  );
  const total = reporting.reduce((s, r) => s + r.openInterestValue, 0);
  const venues: VenueOiPoint[] = reporting
    .map((r) => ({
      exchange: r.exchange,
      openInterestValue: r.openInterestValue,
      share: total > 0 ? r.openInterestValue / total : null,
    }))
    .sort((a, b) => (b.openInterestValue ?? 0) - (a.openInterestValue ?? 0));

  return {
    symbol,
    venues,
    totalOiValue: reporting.length ? total : null,
    topVenue: venues.length ? venues[0].exchange : null,
    topVenueShare: venues.length ? venues[0].share : null,
    herfindahl: total > 0 ? reporting.reduce((s, r) => s + (r.openInterestValue / total) ** 2, 0) : null,
    venueCount: reporting.length,
  };
}

/** One historical funding settlement for a perp. */
export interface FundingHistoryPoint {
  /** Epoch millis of the settlement. */
  time: number;
  /** Funding rate as a fraction (0.0001 = 0.01%); null if unavailable. */
  fundingRate: number | null;
  /** Venue-reported settlement cadence in hours; null/omitted when unknown. */
  fundingIntervalHours?: number | null;
  receipt?: DataReceipt;
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

/** One venue's ticker view of a screened symbol. */
export interface VenueScreenPoint {
  exchange: string;
  price: number;
  changePercent: number | null;
  /** 24h base-asset volume. */
  volume: number | null;
  /** 24h quote (notional) volume. */
  quoteVolume: number | null;
}

/**
 * A screener row as one venue reported it.
 *
 * `changePercent` is nullable here, unlike {@link ScreenerRow}: a venue that
 * omits 24h change still contributes price, volume and breadth to the
 * cross-venue aggregate, and a fabricated 0 would read as "flat" — a claim the
 * venue never made.
 */
export interface VenueScreenRow extends Omit<ScreenerRow, 'changePercent'> {
  changePercent: number | null;
}

/** One venue's whole screener sweep — a single `fetchTickers`-shaped read. */
export interface VenueScreen {
  exchange: string;
  /** False when the venue could not be screened at all; rows is then empty. */
  available: boolean;
  rows: VenueScreenRow[];
  /** Upstream observation time; null when the venue omits it. */
  timestamp: number | null;
  receipt?: DataReceipt;
}

/**
 * How a cross-venue aggregate was derived.
 *
 * Named on every row rather than inferred, because the basis changes with the
 * evidence available: a symbol quoted by six venues with known volumes gets a
 * volume-weighted figure, one with no reported volume anywhere gets a median,
 * and a symbol on a single venue is just that venue. Silently switching between
 * them would make the same column mean three different things.
 */
export type ScreenAggregateBasis = 'volume-weighted' | 'median' | 'single-venue';

/** A screener row aggregated across every venue that quotes the symbol. */
export interface CrossVenueScreenerRow {
  symbol: string;
  name: string;
  /** Per-venue points, dearest price first. */
  venues: VenueScreenPoint[];
  /** How many venues quoted this symbol — the breadth signal. */
  venueCount: number;
  /** Reference price across venues; see {@link basis}. Null when no venue priced it. */
  price: number | null;
  /** Reference 24h change across venues, on the same {@link basis} as `price`. */
  changePercent: number | null;
  /** How `price` and `changePercent` were derived. Null when neither could be. */
  basis: ScreenAggregateBasis | null;
  /**
   * Σ 24h quote volume across quoting venues; null when no venue reports it.
   *
   * Summed, not averaged: each venue's traded volume is its own. This is
   * *reported* volume — exchange-reported figures are widely documented as
   * inflated, so it is a breadth-and-scale signal, never a verified total.
   */
  totalQuoteVolume: number | null;
  /** Σ 24h base-asset volume across quoting venues; null when none report it. */
  totalVolume: number | null;
  /** (max − min) / min of venue price in basis points; null with < 2 quoting venues. */
  priceDispersionBps: number | null;
  receipt?: DataReceipt;
}

const finiteOrNullValue = (value: number | null | undefined): number | null =>
  value != null && Number.isFinite(value) ? value : null;

/**
 * Aggregate per-venue screener sweeps into one cross-venue board.
 *
 * Volume **sums** — each venue's traded volume is its own, so the union is the
 * honest scale signal (the same union-not-average reasoning as cross-venue
 * liquidations). Price does **not** sum: venues are N observations of one
 * quantity, so the aggregate is a weighted central estimate and the spread
 * between them is reported separately as dispersion.
 *
 * Pure. A symbol quoted by one venue is kept, not dropped — `venueCount` says
 * so, which is the point of a cross-venue board.
 */
export function computeCrossVenueScreen(venues: VenueScreen[]): CrossVenueScreenerRow[] {
  const bySymbol = new Map<string, { name: string; points: VenueScreenPoint[] }>();
  for (const venue of venues) {
    if (!venue.available) continue;
    for (const row of venue.rows) {
      const price = finiteOrNullValue(row.price);
      // A venue with no usable price contributes nothing to a price aggregate;
      // dropping it beats carrying a 0 that reads as a 100% dispersion.
      if (price === null || price <= 0) continue;
      const entry = bySymbol.get(row.symbol) ?? { name: row.name || row.symbol, points: [] };
      entry.points.push({
        exchange: venue.exchange,
        price,
        changePercent: finiteOrNullValue(row.changePercent),
        volume: finiteOrNullValue(row.volume),
        quoteVolume: finiteOrNullValue(row.quoteVolume),
      });
      bySymbol.set(row.symbol, entry);
    }
  }

  const rows: CrossVenueScreenerRow[] = [];
  for (const [symbol, { name, points }] of bySymbol) {
    const venuePoints = [...points].sort((a, b) => b.price - a.price);
    const weighted = venuePoints.filter(
      (p): p is VenueScreenPoint & { quoteVolume: number } => p.quoteVolume !== null && p.quoteVolume > 0,
    );
    const weightTotal = weighted.reduce((sum, p) => sum + p.quoteVolume, 0);

    let price: number | null;
    let changePercent: number | null;
    let basis: ScreenAggregateBasis | null;
    if (venuePoints.length === 1) {
      basis = 'single-venue';
      price = venuePoints[0].price;
      changePercent = venuePoints[0].changePercent;
    } else if (weightTotal > 0) {
      basis = 'volume-weighted';
      price = weighted.reduce((sum, p) => sum + p.price * p.quoteVolume, 0) / weightTotal;
      const changeWeighted = weighted.filter((p) => p.changePercent !== null);
      const changeWeight = changeWeighted.reduce((sum, p) => sum + p.quoteVolume, 0);
      changePercent = changeWeight > 0
        ? changeWeighted.reduce((sum, p) => sum + (p.changePercent as number) * p.quoteVolume, 0) / changeWeight
        : null;
    } else {
      // No venue reported usable volume: an unweighted median is the honest
      // central estimate. It is labeled as such rather than passed off as the
      // volume-weighted figure the column normally carries.
      basis = 'median';
      price = median(venuePoints.map((p) => p.price));
      const changes = venuePoints
        .map((p) => p.changePercent)
        .filter((value): value is number => value !== null);
      changePercent = changes.length > 0 ? median(changes) : null;
    }

    const quoteVolumes = venuePoints.map((p) => p.quoteVolume).filter((v): v is number => v !== null);
    const baseVolumes = venuePoints.map((p) => p.volume).filter((v): v is number => v !== null);
    const prices = venuePoints.map((p) => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);

    rows.push({
      symbol,
      name,
      venues: venuePoints,
      venueCount: venuePoints.length,
      price,
      changePercent,
      basis,
      totalQuoteVolume: quoteVolumes.length > 0 ? quoteVolumes.reduce((s, v) => s + v, 0) : null,
      totalVolume: baseVolumes.length > 0 ? baseVolumes.reduce((s, v) => s + v, 0) : null,
      priceDispersionBps: venuePoints.length >= 2 && min > 0 ? ((max - min) / min) * 10_000 : null,
    });
  }
  return rows;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Sort keys the cross-venue screener board understands. */
export const CROSS_VENUE_SCREEN_SORTS = ['volume', 'change', 'price', 'venues', 'dispersion'] as const;
export type CrossVenueScreenSort = (typeof CROSS_VENUE_SCREEN_SORTS)[number];

/**
 * Rank a cross-venue board, descending, with unknowns last.
 *
 * A null metric sorts to the bottom rather than being coerced to 0 — a symbol
 * whose dispersion is unknowable must not outrank one measured at zero.
 */
export function sortCrossVenueScreen(
  rows: CrossVenueScreenerRow[],
  sort: CrossVenueScreenSort = 'volume',
): CrossVenueScreenerRow[] {
  const value = (r: CrossVenueScreenerRow): number | null => {
    switch (sort) {
      case 'change': return r.changePercent;
      case 'price': return r.price;
      case 'venues': return r.venueCount;
      case 'dispersion': return r.priceDispersionBps;
      default: return r.totalQuoteVolume ?? r.totalVolume;
    }
  };
  return [...rows].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av === null && bv === null) return a.symbol.localeCompare(b.symbol);
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  });
}

/** Whether a coin-universe snapshot is real, synthetic, or unavailable for this provider. */
export type CoinUniverseProvenance = 'live' | 'synthetic' | 'unavailable';

/**
 * One coin in the market-cap reference universe — the "top N by market cap"
 * view an exchange cannot produce alone. A CEX ticker has price and 24h volume
 * but no circulating supply, so it has no honest market cap (`Quote.marketCap`
 * is null for the ccxt provider). This shape is populated by a reference-data
 * source: synthetic in the explicit mock/demo; current live providers return
 * unavailable until a reference provider is implemented.
 */
export interface CoinRef {
  /** Rank by circulating market cap, 1 = largest. */
  rank: number;
  /** Base asset symbol, uppercased, e.g. 'BTC'. */
  base: string;
  /** Human-readable name, e.g. 'Bitcoin'. */
  name: string;
  /** Latest reference price in USD; null if unknown. */
  priceUsd: number | null;
  /** Circulating-supply market cap in USD (price × circulating supply); null if unknown. */
  marketCapUsd: number | null;
  /** Circulating supply in units of the base asset; null if unknown. */
  circulatingSupply: number | null;
  /** Total / max supply in base units; null if unknown or uncapped. */
  totalSupply: number | null;
  /** Fully-diluted valuation (price × total supply) in USD; null if total supply is unknown. */
  fdvUsd: number | null;
  /** 24h price change percent (e.g. 1.23 = +1.23%); null if unknown. */
  change24hPct: number | null;
  /** Coarse category tag, e.g. 'L1', 'DeFi', 'Meme', 'Payments'; null if untagged. */
  category: string | null;
}

/**
 * The market-cap reference universe (top N coins by circulating market cap),
 * with honest provenance labeling — mirrors {@link DexPools}: `note` is null
 * only when the data is live. `source` and `asOf` follow {@link LiquidationsMeta}.
 */
export interface CoinUniverse {
  /** Coins ranked by market cap, largest first; empty when unavailable. */
  coins: CoinRef[];
  provenance: CoinUniverseProvenance;
  /** Source label, e.g. 'mock' or 'coingecko'. */
  source: string;
  /** Honest caveat: why the data is synthetic/unavailable, or null when live. */
  note: string | null;
  /** Epoch millis the universe was assembled; null when unavailable. */
  asOf: number | null;
}
