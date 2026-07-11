/**
 * Solana / on-chain read-only snapshot types (network, wallet, validators,
 * staking, SPL token, DEX markets, Jupiter quote). Part of the @midas/shared
 * data contract (re-exported from index.ts).
 */

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
