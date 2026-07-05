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

/**
 * The Midas release version — the single place it is defined. The server
 * reports it at /api/health, the static demo mirrors it, and the web app's
 * update toast compares against it.
 */
export const MIDAS_VERSION = '0.5.0';

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

// ---------------------------------------------------------------------------
// Solana / on-chain (read-only)
// ---------------------------------------------------------------------------

/** Whether a Solana snapshot is a real RPC read, synthetic demo data, or unavailable. */
export type SolanaProvenance = 'live' | 'synthetic' | 'unavailable';

/**
 * A read-only snapshot of Solana network health.
 *
 * Non-custodial and read-only by construction: assembled from public
 * getEpochInfo / getSupply / getRecentPerformanceSamples / getVoteAccounts RPC
 * calls — Midas never signs or sends a transaction. Honestly labeled:
 * `synthetic` in the offline/demo build, `unavailable` when no RPC is configured
 * or the node errors, `live` only for a real read. Every metric is nullable so a
 * partial read degrades a field, not the whole panel.
 */
export interface SolanaNetwork {
  /** Where the read came from, e.g. 'rpc:mainnet-beta' or 'mock'. */
  source: string;
  provenance: SolanaProvenance;
  /** Honest caveat: why the data is synthetic/unavailable, or null when live. */
  note: string | null;
  /** Current confirmed absolute slot; null if unknown. */
  slot: number | null;
  /** Current epoch; null if unknown. */
  epoch: number | null;
  /** Progress through the current epoch, 0–100; null if unknown. */
  epochProgressPct: number | null;
  /** Recent transactions per second, from a performance sample; null if unknown. */
  tps: number | null;
  /** Current-epoch active validator count; null if unknown. */
  validatorCount: number | null;
  /** Total active stake, in whole SOL (lamports / 1e9); null if unknown. */
  totalStakeSol: number | null;
  /** Circulating SOL supply, in whole SOL; null if unknown. */
  circulatingSupplySol: number | null;
  /** Total SOL supply, in whole SOL; null if unknown. */
  totalSupplySol: number | null;
  /** SOL spot price in USD (from the market-data provider); null when it can't be priced. */
  solPriceUsd: number | null;
  /** Epoch millis the snapshot was assembled. */
  asOf: number;
}

/** A single SPL-token (or native SOL) holding within a Solana wallet. */
export interface SolanaTokenHolding {
  /** SPL mint address (base-58), or 'native' for SOL itself. */
  mint: string;
  /** Ticker when the mint is known (e.g. 'USDC'), else a shortened mint. */
  symbol: string;
  /** Human amount, decimals-scaled (NOT raw base units); null if unknown. */
  amount: number | null;
  /** USD value of the holding; null when it can't be priced. */
  valueUsd: number | null;
}

/**
 * A read-only snapshot of a Solana wallet's holdings.
 *
 * Non-custodial by construction: keyed ONLY by a public base-58 address and
 * assembled from read-only getBalance / getTokenAccountsByOwner RPC calls —
 * Midas never holds a key, signs, or moves funds, and no write path exists.
 * Honestly labeled like every other Midas snapshot.
 */
export interface SolanaWallet {
  /** Where the read came from, e.g. 'rpc:mainnet-beta' or 'mock'. */
  source: string;
  provenance: SolanaProvenance;
  /** Honest caveat: why the data is synthetic/unavailable, or null when live. */
  note: string | null;
  /** The public address queried (base-58, case preserved). */
  address: string;
  /** Native SOL balance, in whole SOL (lamports / 1e9); null if unknown. */
  solBalance: number | null;
  /** SPL token holdings (may be empty). */
  tokens: SolanaTokenHolding[];
  /** Total USD value of SOL + priced tokens; null when nothing could be priced. */
  totalValueUsd: number | null;
  /** Epoch millis the snapshot was assembled. */
  asOf: number;
}

/** A trending Solana token (its top pool), from a live on-chain source or synthetic demo. */
export interface SolanaTrendingToken {
  /** Base-token ticker, e.g. 'WIF'. */
  symbol: string;
  /** Top-pool pair label, e.g. 'WIF/SOL'. */
  pair: string;
  /** The DEX the top pool is on, e.g. 'raydium'. */
  dex: string;
  /** Spot price in USD; null if unknown. */
  priceUsd: number | null;
  /** 24h price change, percent; null if unknown. */
  change24hPct: number | null;
  /** Trailing 24h swap volume, USD; null if unknown. */
  volume24hUsd: number | null;
  /** Pool liquidity (TVL), USD; null if unknown. */
  liquidityUsd: number | null;
}

/**
 * Trending Solana tokens, ranked by 24h volume, with honest provenance labeling.
 * Read-only market discovery — no key, no signing. Synthetic in the demo, live
 * from a DEX aggregator when configured, unavailable otherwise.
 */
export interface SolanaTrending {
  /** Where the read came from, e.g. 'geckoterminal:solana' or 'mock'. */
  source: string;
  provenance: SolanaProvenance;
  /** Honest caveat: why the data is synthetic/unavailable, or null when live. */
  note: string | null;
  tokens: SolanaTrendingToken[];
  /** Epoch millis the snapshot was assembled. */
  asOf: number;
}

/** A single Solana validator's vote-account snapshot (read-only). */
export interface SolanaValidator {
  /** Vote account address (base-58). */
  votePubkey: string;
  /** Node identity pubkey, shortened for display (base-58). */
  identity: string;
  /** Active delegated stake, in whole SOL; null if unknown. */
  activatedStakeSol: number | null;
  /** Commission the validator takes, percent 0–100; null if unknown. */
  commissionPct: number | null;
  /** This validator's share of total active stake, percent; null if unknown. */
  stakeSharePct: number | null;
  /** True when the validator is delinquent (not voting). */
  delinquent: boolean;
  /** The last slot this validator voted on; null if unknown. */
  lastVoteSlot: number | null;
}

/**
 * The Solana validator leaderboard, ranked by active stake, with honest
 * provenance labeling. Read-only (getVoteAccounts RPC) — non-custodial.
 */
export interface SolanaValidators {
  /** Where the read came from, e.g. 'rpc:mainnet-beta' or 'mock'. */
  source: string;
  provenance: SolanaProvenance;
  /** Honest caveat: why the data is synthetic/unavailable, or null when live. */
  note: string | null;
  /** Total active stake across all validators, in whole SOL; null if unknown. */
  totalStakeSol: number | null;
  /** Count of current (voting) validators; null if unknown. */
  validatorCount: number | null;
  /** Count of delinquent validators; null if unknown. */
  delinquentCount: number | null;
  /** The top validators by active stake (capped). */
  validators: SolanaValidator[];
  /** Epoch millis the snapshot was assembled. */
  asOf: number;
}

/**
 * Solana native staking economics, derived from RPC inflation + supply + stake.
 * Read-only and non-custodial. The nominal yield is inflation ÷ the staked
 * ratio; the real yield compounds it across the year's epochs. All fields
 * nullable so a partial read degrades a field, not the whole panel.
 */
export interface SolanaStaking {
  /** Where the read came from, e.g. 'rpc:mainnet-beta' or 'mock'. */
  source: string;
  provenance: SolanaProvenance;
  /** Honest caveat: why the data is synthetic/unavailable, or null when live. */
  note: string | null;
  /** Current total network inflation, percent; null if unknown. */
  inflationPct: number | null;
  /** Share of SOL supply that is actively staked, percent; null if unknown. */
  stakedRatioPct: number | null;
  /** Nominal staking APY (inflation ÷ staked ratio), percent; null if unknown. */
  nominalApyPct: number | null;
  /** Real (epoch-compounded) staking APY, percent; null if unknown. */
  realApyPct: number | null;
  /** Approximate epochs per year used for compounding; null if unknown. */
  epochsPerYear: number | null;
  /** Epoch millis the snapshot was assembled. */
  asOf: number;
}

/**
 * A read-only SPL token (mint) snapshot — supply, decimals and the two
 * authorities that decide token safety. Non-custodial: assembled from
 * getTokenSupply + getAccountInfo (jsonParsed) reads only. The authorities are
 * the headline: an active mint authority means supply can still be inflated; an
 * active freeze authority means holder accounts can be frozen — each null once
 * revoked. Holder count is intentionally absent: a trustworthy count needs an
 * indexer, not a public RPC, so Midas doesn't guess one.
 */
export interface SolanaTokenInfo {
  /** Where the read came from, e.g. 'rpc:mainnet-beta' or 'mock'. */
  source: string;
  provenance: SolanaProvenance;
  /** Honest caveat: why the data is synthetic/unavailable, or null when live. */
  note: string | null;
  /** The mint address queried (base-58, case preserved). */
  mint: string;
  /** Ticker when the mint is known (e.g. 'USDC'), else a shortened mint. */
  symbol: string;
  /** Token program: 'spl-token', 'spl-token-2022', or null if unknown. */
  program: string | null;
  /** Decimal places; null if unknown. */
  decimals: number | null;
  /** Total supply in whole tokens (decimals-scaled); null if unknown. */
  supply: number | null;
  /** Mint authority (base-58), or null when revoked / unread. */
  mintAuthority: string | null;
  /** True when a mint authority is set (supply can still grow), false when revoked, null when unread. */
  mintAuthorityActive: boolean | null;
  /** Freeze authority (base-58), or null when revoked / unread. */
  freezeAuthority: string | null;
  /** True when a freeze authority is set (accounts can be frozen), false when revoked, null when unread. */
  freezeAuthorityActive: boolean | null;
  /** Spot price in USD when known (a known/stable mint); null otherwise. */
  priceUsd: number | null;
  /** Epoch millis the snapshot was assembled. */
  asOf: number;
}

/** One hop in a Jupiter swap route. */
export interface SolanaSwapHop {
  /** AMM/DEX label, e.g. 'Orca', or a shortened pool key when unlabeled. */
  dex: string;
  /** Percent of the trade routed through this hop; null if unknown. */
  percent: number | null;
}

/**
 * A read-only Jupiter swap quote — the best-route price and impact for a trade,
 * QUOTE ONLY. Non-custodial by construction: Midas fetches a price estimate and
 * never builds, signs, or sends the swap transaction, so the "exactly two
 * exchange writes" invariant is untouched. Amounts are decimals-scaled (whole
 * tokens); price is output per 1 input. Env-gated live (MIDAS_SOLANA_JUPITER);
 * synthetic-but-labeled in the demo, honest unavailable otherwise.
 */
export interface SolanaSwapQuote {
  /** Where the quote came from, e.g. 'jupiter' or 'mock'. */
  source: string;
  provenance: SolanaProvenance;
  /** Honest caveat: why the data is synthetic/unavailable, or null when live. */
  note: string | null;
  /** Input token ticker. */
  inputSymbol: string;
  /** Output token ticker. */
  outputSymbol: string;
  /** Input mint (base-58). */
  inputMint: string;
  /** Output mint (base-58). */
  outputMint: string;
  /** Input amount, in whole tokens; null if unknown. */
  inAmount: number | null;
  /** Quoted output amount, in whole tokens; null if unknown. */
  outAmount: number | null;
  /** Price: output tokens per 1 input token; null if unknown. */
  price: number | null;
  /** Price impact of the trade, percent; null if unknown. */
  priceImpactPct: number | null;
  /** Slippage tolerance used, basis points; null if unknown. */
  slippageBps: number | null;
  /** The route hops (may be empty). */
  route: SolanaSwapHop[];
  /** Epoch millis the snapshot was assembled. */
  asOf: number;
}

/** One token row in the Solana ecosystem overview. */
export interface SolanaMarketToken {
  /** Base-token ticker, e.g. 'WIF'. */
  symbol: string;
  /** Spot price in USD; null if unknown. */
  priceUsd: number | null;
  /** 24h price change, percent; null if unknown. */
  change24hPct: number | null;
  /** Trailing 24h swap volume, USD; null if unknown. */
  volume24hUsd: number | null;
  /** Pool liquidity (TVL), USD; null if unknown. */
  liquidityUsd: number | null;
}

/**
 * A read-only Solana ecosystem market overview — SOL's spot price up top, an
 * aggregate 24h-volume / liquidity roll-up across the busiest tokens, and a
 * compact top-tokens list. The macro companion to STREND's ranked list.
 * Read-only market data (a DEX aggregator + the market provider's SOL price);
 * no key, no signing. Synthetic in the demo, live when configured, unavailable
 * otherwise.
 */
export interface SolanaMarket {
  /** Where the read came from, e.g. 'geckoterminal:solana' or 'mock'. */
  source: string;
  provenance: SolanaProvenance;
  /** Honest caveat: why the data is synthetic/unavailable, or null when live. */
  note: string | null;
  /** SOL spot price in USD; null if unknown. */
  solPriceUsd: number | null;
  /** Aggregate trailing-24h volume across the listed tokens, USD; null if unknown. */
  totalVolume24hUsd: number | null;
  /** Aggregate pool liquidity across the listed tokens, USD; null if unknown. */
  totalLiquidityUsd: number | null;
  /** Number of tokens in the roll-up; null if unknown. */
  tokenCount: number | null;
  /** Top tokens by 24h volume (capped). */
  tokens: SolanaMarketToken[];
  /** Epoch millis the snapshot was assembled. */
  asOf: number;
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
  /** Venue the row came from (multi-venue accounts); absent for a single venue. */
  venue?: string;
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
  /** Venue the row came from (multi-venue accounts); absent for a single venue. */
  venue?: string;
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
  /** Venue the row came from (multi-venue accounts); absent for a single venue. */
  venue?: string;
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
  /** Venue the row came from (multi-venue accounts); absent for a single venue. */
  venue?: string;
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

/**
 * What happened to an order between two open-order snapshots:
 * - 'new'      — appeared on the book (placed via Midas or externally)
 * - 'fill'     — partially executed (still open; filled increased)
 * - 'filled'   — left the book fully executed
 * - 'canceled' — left the book canceled / expired / rejected
 * - 'closed'   — left the book but the final status could not be resolved
 *                (the provider has no order lookup) — honestly unknown.
 */
export type AccountOrderEventKind = 'new' | 'fill' | 'filled' | 'canceled' | 'closed';

/** One observed order transition on the live account. Read-only — observation, never action. */
export interface AccountOrderEvent {
  /** Monotonic id within this server run — poll with ?since= to get only new events. */
  id: number;
  /** Epoch millis the watcher observed the transition (not when the exchange executed it). */
  at: number;
  kind: AccountOrderEventKind;
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  /** Order (limit) price; null for market orders / unknown. */
  price: number | null;
  /** Ordered base amount. */
  amount: number;
  /** Cumulative filled base amount at observation. */
  filled: number;
  /** Base amount newly filled since the previous snapshot; null when not a fill. */
  filledDelta: number | null;
  /** Exchange status when known ('open', 'closed', 'canceled', …); null if unknown. */
  status: string | null;
}

/**
 * Operational self-description: which background capabilities this server is
 * actually running. Powers the SYS panel — the honest answer to "is the
 * watcher on? is anything streaming? what version is this?" without reading
 * server logs.
 */
export interface SystemStatus {
  provider: string;
  live: boolean;
  demo: boolean;
  version: string;
  /** Epoch millis the server process started (uptime = now - startedAt). */
  startedAt: number;
  accountWatch: { on: boolean; intervalMs: number | null };
  /** Whether a ccxt.pro order stream is nudging the watcher. */
  streamNudge: boolean;
  digest: { on: boolean; hours: number | null };
  equity: { on: boolean; intervalMs: number | null };
  tradingEnabled: boolean;
  authEnabled: boolean;
}

/** One periodic snapshot of real account value (read-only observation). */
export interface EquityPoint {
  /** Epoch millis the snapshot was taken. */
  at: number;
  /** Total account value in USD across priced assets. */
  totalUsd: number;
  /** Unrealized P&L across open positions at that moment; null if unknown. */
  unrealizedPnlUsd: number | null;
}

/** The account equity series the server has accumulated. */
export interface AccountEquityResponse {
  /** Whether the snapshot loop is running (keys + live provider + interval > 0). */
  watching: boolean;
  /** Why it is off, or null when running. */
  note: string | null;
  /** Oldest → newest. */
  points: EquityPoint[];
}

/**
 * Metadata about a user's stored exchange keys — the ONLY key shape the API
 * ever returns. Secrets are write-only: encrypted at rest server-side and
 * never included in any response after the PUT.
 */
export interface AccountKeysMeta {
  /** ccxt exchange id, e.g. 'binance'. */
  exchange: string;
  /** Last 4 characters of the API key, for recognition only. */
  keyLast4: string;
  /** User explicitly marked the key as trade-permissioned. */
  canTrade: boolean;
  createdAt: number;
}

/** GET /api/account/keys — the stored key's metadata, or null when none. */
export interface AccountKeysResponse {
  keys: AccountKeysMeta | null;
}

/** PUT /api/account/keys request body (write-only; never echoed back). */
export interface AccountKeysInput {
  exchange: string;
  apiKey: string;
  secret: string;
  /** Exchange passphrase, where the venue requires one (e.g. OKX, KuCoin). */
  password?: string;
  canTrade?: boolean;
}

/** The account event feed: what the server-side order watcher has observed. */
export interface AccountEventsResponse {
  /** Whether the watcher loop is running (keys + live provider + interval > 0). */
  watching: boolean;
  /** Newest event id (0 when none yet) — pass back as ?since= on the next poll. */
  latestId: number;
  /** Events with id > since, oldest first. */
  events: AccountOrderEvent[];
  /** Why the watcher is off, or null when it is running. */
  note: string | null;
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
  /** True when the server runs in public-demo posture (mock data, no trading, no signup). */
  demo?: boolean;
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
