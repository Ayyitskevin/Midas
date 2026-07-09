import type { FastifyInstance } from 'fastify';
import { isInterval, isRange } from '@midas/shared';
import type {
  FundingRow,
  HealthResponse,
  Interval,
  LiquidationEvent,
  LiquidationsFeed,
  Range,
} from '@midas/shared';
import type { TradingStatus } from '@midas/shared';
import type { DataProvider } from './providers';
import { ProviderError } from './providers';
import { config } from './config';
import { EXECUTION_SAFETY_HOLD_REASON, executionSafetyHoldStatus } from './trading';
import { COPILOT_SYSTEM_PREAMBLE, buildContext, callClaude } from './ai';
import type { ChatMessage } from './ai';
import { createRateLimiter } from './rateLimit';

const DEFAULT_INTERVAL: Interval = '1d';
const DEFAULT_RANGE: Range = '6mo';
const MAX_BATCH_SYMBOLS = 50;
// The AI copilot calls a paid upstream (Anthropic). Cap it per caller — far
// below the global request limiter — so one client can't run up the operator's
// bill even while staying under the general rate limit.
const AI_CHAT_WINDOW_MS = 60_000;
const AI_CHAT_MAX_PER_WINDOW = 10;

// Real instruments across providers: BTC/USDT:USDT, BRK-B, ^GSPC, EURUSD=X.
const SYMBOL_RE = /^[A-Z0-9/:^=._-]{1,64}$/;

/**
 * Uppercase + bound every symbol at the API edge. Anything outside the
 * charset/length is junk that would otherwise flow unbounded into provider
 * lookups, stream keys and error messages; it normalizes to '' and the
 * routes answer 400.
 */
function normalizeSymbol(raw: string): string {
  const s = raw.trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : '';
}

// Base-58 alphabet (no 0/O/I/l) — a Solana address is 32–44 of these chars.
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Bound a Solana address at the API edge. Unlike symbols, base-58 is
 * CASE-SENSITIVE — uppercasing corrupts a valid address — so this only trims
 * and charset/length-checks. It's a sanity gate, not full validity (the RPC is
 * the source of truth); junk normalizes to '' and the route answers 400.
 */
function normalizeSolanaAddress(raw: string): string {
  const s = raw.trim();
  return SOLANA_ADDRESS_RE.test(s) ? s : '';
}

/** Resolves the provider for a request (per-user keys); defaults to the base provider. */
export interface ProviderResolver {
  for(userId: string | undefined): DataProvider;
  /** The user's OWN provider or null — never a base fallback (trading path). */
  userFor(userId: string | undefined): DataProvider | null;
}

/** Stored-key facts the trading gate needs; secrets never pass through here. */
export type KeyMetaLookup = (userId: string) => { canTrade: boolean } | null;

/** Register all Midas API routes against the given provider. */
export function registerRoutes(
  app: FastifyInstance,
  provider: DataProvider,
  pool: ProviderResolver = { for: () => provider, userFor: () => null },
  _keyMeta: KeyMetaLookup = () => null,
): void {
  app.get('/api/health', async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
      provider: provider.name,
      live: provider.live,
      time: Date.now(),
      version: config.version,
      demo: config.demoMode,
    };
  });

  app.get<{ Params: { symbol: string } }>('/api/quote/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    return provider.getQuote(symbol);
  });

  app.get<{ Querystring: { symbols?: string } }>('/api/quotes', async (req) => {
    const raw = req.query.symbols ?? '';
    const symbols = Array.from(
      new Set(
        raw
          .split(',')
          .map(normalizeSymbol)
          .filter(Boolean),
      ),
    ).slice(0, MAX_BATCH_SYMBOLS);
    if (symbols.length === 0) return [];
    return provider.getQuotes(symbols);
  });

  app.get<{
    Params: { symbol: string };
    Querystring: { interval?: string; range?: string };
  }>('/api/history/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);

    const interval = req.query.interval && isInterval(req.query.interval)
      ? req.query.interval
      : DEFAULT_INTERVAL;
    const range = req.query.range && isRange(req.query.range)
      ? req.query.range
      : DEFAULT_RANGE;

    return provider.getHistory(symbol, { interval, range });
  });

  app.get<{
    Params: { symbol: string };
    Querystring: { depth?: string };
  }>('/api/orderbook/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    const depthRaw = Number(req.query.depth);
    const depth =
      Number.isFinite(depthRaw) && depthRaw > 0 ? Math.min(Math.floor(depthRaw), 100) : 25;
    return provider.getOrderBook(symbol, depth);
  });

  app.get<{ Params: { symbol: string } }>('/api/exchange-quotes/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    return provider.getExchangeQuotes(symbol);
  });

  // Per-venue funding & open interest for a perp across the compare set.
  app.get<{ Params: { symbol: string } }>('/api/venue-derivatives/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    return provider.getVenueDerivatives(symbol);
  });

  app.get<{ Params: { symbol: string } }>('/api/derivatives/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    return provider.getDerivatives(symbol);
  });

  app.get<{ Params: { symbol: string } }>('/api/onchain/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    return provider.getDexPools(symbol);
  });

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

  // Read-only account reads (non-custodial). Account-wide, so no symbol.
  // Auth-guarded when auth is enabled — these are not public prefixes, so the
  // onRequest guard covers them. Per-user keys (when stored) resolve these
  // READS to that user's own exchange client; everyone else gets the
  // operator's env-keyed provider. The trading section below follows the same
  // resolution with stricter rules (no base fallback) — see resolveTrading.
  app.get('/api/balances', async (req) => pool.for(req.userId).getBalances());
  app.get('/api/orders', async (req) => pool.for(req.userId).getOpenOrders());
  app.get('/api/positions', async (req) => pool.for(req.userId).getPositions());
  app.get<{ Querystring: { symbol?: string } }>('/api/fills', async (req) => {
    const symbol = req.query.symbol ? normalizeSymbol(req.query.symbol) : undefined;
    return pool.for(req.userId).getFills(symbol);
  });
  // Read-only single-order lookup — powers TICKET's post-placement tracking
  // (placed → partial → filled/canceled) and the account watcher's
  // closed-order resolution. A read, so it is NOT gated by the trading
  // switches — only by the provider actually supporting the lookup.
  app.get<{ Params: { id: string }; Querystring: { symbol?: string } }>(
    '/api/orders/:id',
    async (req) => {
      const id = req.params.id.trim();
      const symbol = req.query.symbol ? normalizeSymbol(req.query.symbol) : '';
      if (!id) throw new ProviderError('Missing order id', 400);
      if (!symbol) throw new ProviderError('Missing symbol (most exchanges require it to look up an order)', 400);
      const reader = pool.for(req.userId);
      if (!reader.getOrder) throw new ProviderError('This provider cannot look up orders.', 501);
      return reader.getOrder(id, symbol);
    },
  );

  // --- Execution safety hold -------------------------------------------------
  // Market, account-read, paper, and preview routes stay available. The two
  // mutation endpoints fail closed regardless of keys or environment flags.
  // Existing resting orders must be managed directly at the exchange.
  const heldStatus: TradingStatus = executionSafetyHoldStatus(provider.name);

  app.get('/api/trading/status', async () => heldStatus);

  const safetyHoldResponse = () => ({
    error: 'TradingSafetyHold',
    message: EXECUTION_SAFETY_HOLD_REASON,
    statusCode: 503,
  });

  app.post('/api/orders', async (_req, reply) => {
    reply.status(503);
    return safetyHoldResponse();
  });

  app.delete('/api/orders/:id', async (_req, reply) => {
    reply.status(503);
    return safetyHoldResponse();
  });

  app.get<{ Params: { symbol: string }; Querystring: { limit?: string } }>(
    '/api/funding-history/:symbol',
    async (req) => {
      const symbol = normalizeSymbol(req.params.symbol);
      if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
      if (!provider.getFundingHistory) {
        throw new ProviderError('Funding history not supported by this provider', 501, symbol);
      }
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 90;
      return provider.getFundingHistory(symbol, limit);
    },
  );

  app.get<{ Querystring: { quote?: string; sort?: string; limit?: string } }>(
    '/api/screener',
    async (req) => {
      const limitRaw = Number(req.query.limit);
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50;
      return provider.screen({ quote: req.query.quote, sort: req.query.sort, limit });
    },
  );

  // Funding-rates board: the top-N perps by volume with their funding + OI.
  // Composed from screen() + getDerivatives() so every provider supports it.
  app.get<{ Querystring: { quote?: string; limit?: string } }>('/api/funding', async (req) => {
    const quote = (req.query.quote ?? 'USDT').toUpperCase();
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 60) : 30;
    const rows = await provider.screen({ quote, sort: 'volume', limit });
    const board = await Promise.all(
      rows.map(async (r): Promise<FundingRow | null> => {
        try {
          const d = await provider.getDerivatives(r.symbol);
          return {
            symbol: r.symbol,
            fundingRate: d.fundingRate,
            nextFundingTime: d.nextFundingTime,
            markPrice: d.markPrice,
            openInterestValue: d.openInterestValue,
          };
        } catch {
          return null;
        }
      }),
    );
    return board.filter((x): x is FundingRow => x !== null);
  });

  // Market-wide liquidations feed: the recent liquidations across the top-N
  // perps merged into one newest-first stream. Composed from screen() +
  // getDerivatives() so every provider supports it.
  app.get<{ Querystring: { quote?: string; limit?: string } }>('/api/liquidations', async (req) => {
    const quote = (req.query.quote ?? 'USDT').toUpperCase();
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 60) : 30;
    const rows = await provider.screen({ quote, sort: 'volume', limit });
    const perSymbol = await Promise.all(
      rows.map(async (r): Promise<LiquidationEvent[]> => {
        try {
          const d = await provider.getDerivatives(r.symbol);
          return d.recentLiquidations.map((l) => ({
            symbol: r.symbol,
            side: l.side,
            price: l.price,
            amount: l.amount,
            value: l.price * l.amount,
            timestamp: l.timestamp,
          }));
        } catch {
          return [];
        }
      }),
    );
    const events = perSymbol.flat().sort((a, b) => b.timestamp - a.timestamp).slice(0, 120);
    const feed: LiquidationsFeed = {
      events,
      meta: { ...provider.liquidationsProvenance(), asOf: Date.now() },
    };
    return feed;
  });

  app.get<{ Querystring: { q?: string } }>('/api/search', async (req) => {
    const q = (req.query.q ?? '').trim().slice(0, 64);
    if (q.length === 0) return [];
    return provider.search(q);
  });

  app.get<{ Querystring: { symbol?: string } }>('/api/news', async (req) => {
    const symbol = req.query.symbol ? normalizeSymbol(req.query.symbol) : undefined;
    return provider.getNews(symbol);
  });

  const aiChatLimiter = createRateLimiter(AI_CHAT_WINDOW_MS, AI_CHAT_MAX_PER_WINDOW);

  app.post<{ Body: { messages?: ChatMessage[]; symbol?: string } }>(
    '/api/ai/chat',
    async (req, reply) => {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        reply.status(503);
        return {
          error: 'AIUnavailable',
          message: 'AI copilot requires ANTHROPIC_API_KEY on the server.',
          statusCode: 503,
        };
      }

      // Cost brake: this route calls a paid upstream, so cap it per caller
      // (authenticated user when present, else IP) before building context or
      // reaching Claude.
      const waitMs = aiChatLimiter.check(req.userId ?? req.ip, Date.now());
      if (waitMs != null) {
        reply.status(429);
        return {
          error: 'TooManyRequests',
          message: `AI copilot rate limit reached — try again in ${Math.ceil(waitMs / 1000)}s.`,
          statusCode: 429,
        };
      }

      const messages = (req.body?.messages ?? [])
        .filter(
          (m): m is ChatMessage =>
            !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
        )
        .slice(-12);
      if (messages.length === 0) throw new ProviderError('No messages provided', 400);
      const totalChars = messages.reduce((n, m) => n + m.content.length, 0);
      if (totalChars > 32_000) {
        throw new ProviderError('Conversation too large — 32k characters max per request.', 400);
      }

      const symbol = req.body?.symbol ? normalizeSymbol(req.body.symbol) : undefined;
      const context = await buildContext(provider, symbol);
      const system = `${COPILOT_SYSTEM_PREAMBLE}\n\nLIVE DATA:\n${context}`;
      const content = await callClaude({ system, messages, model: config.aiModel, apiKey });
      return { role: 'assistant', content };
    },
  );
}
