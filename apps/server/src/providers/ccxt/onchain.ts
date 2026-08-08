import type {
  DexPools,
  SolanaMarket,
  SolanaNetwork,
  SolanaStaking,
  SolanaSwapQuote,
  SolanaTokenInfo,
  SolanaTrending,
  SolanaValidators,
  SolanaWallet,
} from '@midas/shared';
import type { CcxtSymbolContext } from './context';

// Re-exported so this module's own import sites keep working; `ccxt/context.ts`
// holds the one definition. This wiring needs only symbol normalization — no
// clock (nothing here stamps an observedAt) and no venue client.
export type { CcxtSymbolContext as CcxtReadContext };
import { dexscreenerEnabled, fetchDexPools } from '../dexscreener';
import { fetchGeckoPools, geckoterminalEnabled } from '../geckoterminal';
import { fetchSolanaNetwork } from '../../solana/network';
import { fetchSolanaWallet } from '../../solana/wallet';
import { fetchSolanaPools, fetchSolanaTrending } from '../../solana/dex';
import { fetchSolanaStaking, fetchSolanaValidators } from '../../solana/staking';
import { fetchSolanaToken } from '../../solana/token';
import { fetchSolanaQuote } from '../../solana/jupiter';
import { fetchSolanaMarket } from '../../solana/market';


/** Best-effort SOL/USDT spot from this exchange for USD valuation; null on failure. */
async function solPrice(ctx: CcxtSymbolContext): Promise<number | null> {
  try {
    return (await ctx.getQuote('SOL/USDT')).price;
  } catch {
    return null;
  }
}

export async function getDexPools(ctx: CcxtSymbolContext, symbol: string): Promise<DexPools> {
  const base = ctx.normalize(symbol).split('/')[0].replace(/:.*$/, '');
  // Opt-in live on-chain read (Dexscreener); otherwise honestly unavailable.
  if (dexscreenerEnabled()) return fetchDexPools(base);
  if (geckoterminalEnabled()) return fetchGeckoPools(base);
  return {
    symbol: base,
    provenance: 'unavailable',
    note: `On-chain/DEX pools need an on-chain source; ${ctx.name} reads centralized exchanges only. Set MIDAS_DEX_SOURCE=dexscreener for a live read.`,
    pools: [],
  };
}

/** Read-only Solana network health (env-gated live RPC; honest 'unavailable' otherwise). */
export async function getSolanaNetwork(ctx: CcxtSymbolContext): Promise<SolanaNetwork> {
  const solPriceUsd = await solPrice(ctx);
  return fetchSolanaNetwork(solPriceUsd);
}

/** Read-only Solana wallet inspector (env-gated live RPC; honest 'unavailable' otherwise). */
export async function getSolanaWallet(ctx: CcxtSymbolContext, address: string): Promise<SolanaWallet> {
  // Price only SOL (from this exchange) + stablecoins (pinned in the mapper);
  // exotic SPL tokens are honestly left unpriced rather than guessed.
  const solPriceUsd = await solPrice(ctx);
  return fetchSolanaWallet(address, (sym) => (sym === 'SOL' ? solPriceUsd : null));
}

/** Trending Solana tokens (env-gated live GeckoTerminal; honest 'unavailable' otherwise). */
export async function getSolanaTrending(): Promise<SolanaTrending> {
  return fetchSolanaTrending();
}

/** Solana-network DEX pools for an asset (env-gated live GeckoTerminal; honest otherwise). */
export async function getSolanaDexPools(ctx: CcxtSymbolContext, symbol: string): Promise<DexPools> {
  const base = ctx.normalize(symbol).split('/')[0].replace(/:.*$/, '');
  return fetchSolanaPools(base);
}

/** Solana validator leaderboard (env-gated live RPC; honest 'unavailable' otherwise). */
export async function getSolanaValidators(): Promise<SolanaValidators> {
  return fetchSolanaValidators();
}

/** Solana native staking economics (env-gated live RPC; honest 'unavailable' otherwise). */
export async function getSolanaStaking(): Promise<SolanaStaking> {
  return fetchSolanaStaking();
}

/** SPL token (mint) explorer (env-gated live RPC; honest 'unavailable' otherwise). */
export async function getSolanaToken(ctx: CcxtSymbolContext, mint: string): Promise<SolanaTokenInfo> {
  // Price only SOL (from this exchange) + stablecoins (pinned in the mapper);
  // exotic mints are honestly left unpriced rather than guessed.
  const solPriceUsd = await solPrice(ctx);
  return fetchSolanaToken(mint, (sym) => (sym === 'SOL' ? solPriceUsd : null));
}

/** Read-only Jupiter swap quote — QUOTE ONLY, never a swap tx (env-gated; honest otherwise). */
export async function getSolanaQuote(input: string, output: string, amount: number): Promise<SolanaSwapQuote> {
  return fetchSolanaQuote(input, output, amount);
}

/** Solana ecosystem market overview (env-gated live GeckoTerminal; honest otherwise). */
export async function getSolanaMarket(ctx: CcxtSymbolContext): Promise<SolanaMarket> {
  return fetchSolanaMarket(await solPrice(ctx));
}
