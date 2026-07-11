import type { FastifyInstance } from 'fastify';
import type { DataProvider } from '../providers';
import { ProviderError } from '../providers';
import { normalizeSymbol, normalizeSolanaAddress } from './shared';

/**
 * Read-only Solana / on-chain routes (network, wallet, DeFi markets,
 * validators, staking, SPL token, Jupiter quote, ecosystem overview).
 * Non-custodial: public RPC / aggregator reads only, never a transaction.
 * Providers without a Solana source answer an honest 'unavailable' snapshot.
 */
export function registerSolanaRoutes(app: FastifyInstance, provider: DataProvider): void {
  // Read-only Solana network health. Non-custodial: public RPC reads only, never
  // a transaction. Providers without a Solana source answer honest 'unavailable'.
  app.get('/api/solana/network', async () => {
    if (provider.getSolanaNetwork) return provider.getSolanaNetwork();
    return {
      source: provider.name,
      provenance: 'unavailable' as const,
      note: 'This provider has no Solana source.',
      slot: null,
      epoch: null,
      epochProgressPct: null,
      tps: null,
      validatorCount: null,
      totalStakeSol: null,
      circulatingSupplySol: null,
      totalSupplySol: null,
      solPriceUsd: null,
      asOf: Date.now(),
    };
  });

  // Read-only Solana wallet inspector, keyed by a public base-58 address. The
  // address is CASE-SENSITIVE — validated by its own base-58 gate, never through
  // normalizeSymbol (which would uppercase and corrupt it).
  app.get<{ Params: { address: string } }>('/api/solana/wallet/:address', async (req) => {
    const address = normalizeSolanaAddress(req.params.address);
    if (!address) throw new ProviderError('Missing or invalid Solana address', 400);
    if (provider.getSolanaWallet) return provider.getSolanaWallet(address);
    return {
      source: provider.name,
      provenance: 'unavailable' as const,
      note: 'This provider has no Solana source.',
      address,
      solBalance: null,
      tokens: [],
      totalValueUsd: null,
      asOf: Date.now(),
    };
  });

  // Read-only Solana DeFi markets: trending tokens + per-asset Solana DEX pools.
  app.get('/api/solana/trending', async () => {
    if (provider.getSolanaTrending) return provider.getSolanaTrending();
    return {
      source: provider.name,
      provenance: 'unavailable' as const,
      note: 'This provider has no Solana source.',
      tokens: [],
      asOf: Date.now(),
    };
  });

  app.get<{ Params: { symbol: string } }>('/api/solana/pools/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    if (provider.getSolanaDexPools) return provider.getSolanaDexPools(symbol);
    return {
      symbol: symbol.split('/')[0],
      provenance: 'unavailable' as const,
      note: 'This provider has no Solana source.',
      pools: [],
    };
  });

  // Read-only Solana staking: validator leaderboard + native staking economics.
  app.get('/api/solana/validators', async () => {
    if (provider.getSolanaValidators) return provider.getSolanaValidators();
    return {
      source: provider.name,
      provenance: 'unavailable' as const,
      note: 'This provider has no Solana source.',
      totalStakeSol: null,
      validatorCount: null,
      delinquentCount: null,
      validators: [],
      asOf: Date.now(),
    };
  });

  app.get('/api/solana/staking', async () => {
    if (provider.getSolanaStaking) return provider.getSolanaStaking();
    return {
      source: provider.name,
      provenance: 'unavailable' as const,
      note: 'This provider has no Solana source.',
      inflationPct: null,
      stakedRatioPct: null,
      nominalApyPct: null,
      realApyPct: null,
      epochsPerYear: null,
      asOf: Date.now(),
    };
  });

  // Read-only SPL token (mint) explorer. Non-custodial: read-only RPC only. The
  // mint is base-58 (case-sensitive) so it uses the address gate, not the symbol one.
  app.get<{ Params: { mint: string } }>('/api/solana/token/:mint', async (req) => {
    const mint = normalizeSolanaAddress(req.params.mint);
    if (!mint) throw new ProviderError('Missing or invalid Solana mint address', 400);
    if (provider.getSolanaToken) return provider.getSolanaToken(mint);
    return {
      source: provider.name,
      provenance: 'unavailable' as const,
      note: 'This provider has no Solana source.',
      mint,
      symbol: mint,
      program: null,
      decimals: null,
      supply: null,
      mintAuthority: null,
      mintAuthorityActive: null,
      freezeAuthority: null,
      freezeAuthorityActive: null,
      priceUsd: null,
      asOf: Date.now(),
    };
  });

  // Read-only Jupiter swap quote — QUOTE ONLY, never a swap transaction, so the
  // non-custodial invariant holds. Tokens are tickers; amount is whole input tokens.
  app.get<{ Params: { input: string; output: string; amount: string } }>(
    '/api/solana/quote/:input/:output/:amount',
    async (req) => {
      const input = normalizeSymbol(req.params.input);
      const output = normalizeSymbol(req.params.output);
      if (!input || !output) throw new ProviderError('Missing or invalid token', 400);
      const amount = Number(req.params.amount);
      // Validate the amount at the edge — like the tokens above — so a malformed
      // path segment (NaN/negative/zero) is an honest 400, not a dispatch to the
      // provider. The UI only ever queries with amount > 0; this guards direct callers.
      if (!Number.isFinite(amount) || amount <= 0) throw new ProviderError('Invalid amount', 400);
      if (provider.getSolanaQuote) return provider.getSolanaQuote(input, output, amount);
      return {
        source: provider.name,
        provenance: 'unavailable' as const,
        note: 'This provider has no Solana source.',
        inputSymbol: input,
        outputSymbol: output,
        inputMint: '',
        outputMint: '',
        inAmount: null,
        outAmount: null,
        price: null,
        priceImpactPct: null,
        slippageBps: null,
        route: [],
        asOf: Date.now(),
      };
    },
  );

  // Read-only Solana ecosystem market overview. Read-only market data; no signing.
  app.get('/api/solana/market', async () => {
    if (provider.getSolanaMarket) return provider.getSolanaMarket();
    return {
      source: provider.name,
      provenance: 'unavailable' as const,
      note: 'This provider has no Solana source.',
      solPriceUsd: null,
      totalVolume24hUsd: null,
      totalLiquidityUsd: null,
      tokenCount: null,
      tokens: [],
      asOf: Date.now(),
    };
  });
}
