/**
 * Account & trading read-only shapes — balances, open orders, positions, fills,
 * the (held) order-placement request/response, equity series, stored-key metadata
 * and order events. Part of the @midas/shared data contract (re-exported from
 * index.ts).
 */

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
 * A legacy order-placement request retained for client compatibility while the
 * server execution safety hold is active. See {@link TradingStatus}.
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
 * Execution posture plus the reason and limits, so the UI can stay honest about
 * live versus preview-only mode. The current server always reports the execution
 * safety hold.
 */
export interface TradingStatus {
  enabled: boolean;
  /** Why trading is off (when disabled), or a confirmation note when on. */
  reason: string;
  /** Per-order USD notional cap the server enforces, or null if uncapped. */
  maxOrderUsd: number | null;
  /** Cumulative UTC-day USD notional cap, or null if uncapped. */
  dailyCapUsd: number | null;
  /** Notional already placed today (UTC), USD. Zero while execution is held. */
  dailyUsedUsd: number;
  /** The active account-data source, e.g. 'ccxt:binance'. */
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
