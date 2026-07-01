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
import type { OrderRequest, PlacedOrder } from '@midas/shared';
import type { DataProvider } from './providers';
import { ProviderError } from './providers';
import { ccxtKeysConfigured } from './providers/balances';
import { config } from './config';
import {
  checkDailyCap,
  computeTradingStatus,
  createDailyLedger,
  createIdempotencyCache,
  estimateNotionalUsd,
  validateOrderRequest,
  type TradingConfig,
} from './trading';
import { COPILOT_SYSTEM_PREAMBLE, buildContext, callClaude } from './ai';
import type { ChatMessage } from './ai';
import { postWebhookText } from './webhook';

const DEFAULT_INTERVAL: Interval = '1d';
const DEFAULT_RANGE: Range = '6mo';
const MAX_BATCH_SYMBOLS = 50;

function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Fire-and-forget operator notification to the configured alert webhook.
 * Live account mutations — order placed, order canceled — are exactly the
 * events an operator wants pushed out-of-band; failures never affect the
 * request. (Fill notifications come from the account watcher, which shares
 * the same webhook via postWebhookText.)
 */
function notifyWebhook(text: string): void {
  postWebhookText(config.alertWebhook, text);
}

/** Register all Midas API routes against the given provider. */
export function registerRoutes(app: FastifyInstance, provider: DataProvider): void {
  app.get('/api/health', async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
      provider: provider.name,
      live: provider.live,
      time: Date.now(),
      version: config.version,
    };
  });

  app.get<{ Params: { symbol: string } }>('/api/quote/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing symbol', 400);
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
    if (!symbol) throw new ProviderError('Missing symbol', 400);

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
    if (!symbol) throw new ProviderError('Missing symbol', 400);
    const depthRaw = Number(req.query.depth);
    const depth =
      Number.isFinite(depthRaw) && depthRaw > 0 ? Math.min(Math.floor(depthRaw), 100) : 25;
    return provider.getOrderBook(symbol, depth);
  });

  app.get<{ Params: { symbol: string } }>('/api/exchange-quotes/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing symbol', 400);
    return provider.getExchangeQuotes(symbol);
  });

  // Per-venue funding & open interest for a perp across the compare set.
  app.get<{ Params: { symbol: string } }>('/api/venue-derivatives/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing symbol', 400);
    return provider.getVenueDerivatives(symbol);
  });

  app.get<{ Params: { symbol: string } }>('/api/derivatives/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing symbol', 400);
    return provider.getDerivatives(symbol);
  });

  app.get<{ Params: { symbol: string } }>('/api/onchain/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing symbol', 400);
    return provider.getDexPools(symbol);
  });

  // Read-only account reads (non-custodial; keys live only in the operator's
  // server env). Account-wide, so no symbol. Auth-guarded when auth is enabled —
  // these are not public prefixes, so the onRequest guard covers them.
  app.get('/api/balances', async () => provider.getBalances());
  app.get('/api/orders', async () => provider.getOpenOrders());
  app.get('/api/positions', async () => provider.getPositions());
  app.get<{ Querystring: { symbol?: string } }>('/api/fills', async (req) => {
    const symbol = req.query.symbol ? normalizeSymbol(req.query.symbol) : undefined;
    return provider.getFills(symbol);
  });

  // --- Live trading (opt-in, OFF by default) -------------------------------
  // Every gate lives in trading.ts (pure + tested). The status endpoint tells
  // the UI whether placement is possible; the POST is the ONLY write path, and
  // it re-checks the gate, validates, and enforces a hard notional cap on every
  // request before reaching the provider's single createOrder call.
  const tradingCfg: TradingConfig = {
    enabled: config.tradingEnabled,
    allowNoAuth: config.tradingAllowNoAuth,
    maxOrderUsd: config.maxOrderUsd,
    maxDailyUsd: config.maxDailyUsd,
    authEnabled: config.authEnabled,
    corsOrigin: config.corsOrigin,
  };
  // Cumulative UTC-day notional across all placed orders (in-memory; a restart
  // resets the budget — the restart is also the kill switch).
  const dailyLedger = createDailyLedger();
  const tradingStatus = () =>
    computeTradingStatus(
      tradingCfg,
      {
        providerName: provider.name,
        providerLive: provider.live,
        hasKeys: ccxtKeysConfigured(),
      },
      dailyLedger.used(Date.now()),
    );

  app.get('/api/trading/status', async () => tradingStatus());

  // Recent placements by clientOrderId, so a retry/double-submit returns the
  // original acknowledgement instead of placing twice.
  const placedOrders = createIdempotencyCache();

  app.post<{ Body: OrderRequest }>('/api/orders', async (req, reply) => {
    const status = tradingStatus();
    if (!status.enabled) {
      reply.status(403);
      return { error: 'TradingDisabled', message: status.reason, statusCode: 403 };
    }
    const v = validateOrderRequest(req.body);
    if (!v.ok) throw new ProviderError(v.errors.join(' '), 400);
    if (!provider.placeOrder) throw new ProviderError('This provider cannot place orders.', 501);

    const body: OrderRequest = { ...req.body, symbol: normalizeSymbol(req.body.symbol) };

    // Idempotency: a duplicate clientOrderId within the TTL is answered from
    // the cache — the exchange is never asked to place a second time.
    if (body.clientOrderId) {
      const duplicate = placedOrders.recall(body.clientOrderId, Date.now());
      if (duplicate) {
        app.log.warn({ clientOrderId: body.clientOrderId }, 'duplicate order suppressed (idempotency)');
        return duplicate;
      }
    }

    // Hard notional caps: price the order and reject anything over the
    // per-order ceiling OR anything that would breach the cumulative daily cap.
    let placedNotional: number | null = null;
    if (status.maxOrderUsd != null || status.dailyCapUsd != null) {
      let refPrice: number | null = null;
      if (body.type === 'market') {
        try {
          refPrice = (await provider.getQuote(body.symbol)).price;
        } catch {
          refPrice = null;
        }
      }
      const notional = estimateNotionalUsd(body, refPrice);
      if (notional == null) {
        throw new ProviderError('Could not price the order to enforce the notional caps — rejected.', 400);
      }
      if (status.maxOrderUsd != null && notional > status.maxOrderUsd) {
        throw new ProviderError(
          `Order notional ~$${Math.round(notional)} exceeds the per-order cap of $${status.maxOrderUsd} (raise MIDAS_MAX_ORDER_USD to allow it).`,
          400,
        );
      }
      const dailyReject = checkDailyCap(status.dailyCapUsd, dailyLedger.used(Date.now()), notional);
      if (dailyReject) throw new ProviderError(dailyReject, 400);
      placedNotional = notional;
    }

    // Audit: every live placement attempt is logged with who/what.
    app.log.warn(
      { symbol: body.symbol, side: body.side, type: body.type, amount: body.amount, userId: req.userId },
      'LIVE order placement',
    );
    // Reserve against the daily cap BEFORE placing, so two in-flight orders
    // can't both squeeze under it while the exchange call is awaited; release
    // the reservation if the placement fails.
    if (placedNotional != null) dailyLedger.add(placedNotional, Date.now());
    let placed: PlacedOrder;
    try {
      placed = await provider.placeOrder(body);
    } catch (err) {
      if (placedNotional != null) dailyLedger.add(-placedNotional, Date.now());
      throw err;
    }
    if (body.clientOrderId) placedOrders.remember(body.clientOrderId, placed, Date.now());
    notifyWebhook(
      `🟢 LIVE order placed — ${body.side.toUpperCase()} ${body.amount} ${body.symbol} ${body.type}` +
        `${body.type === 'limit' ? ` @ ${body.price}` : ''} (id ${placed.id}, status ${placed.status})`,
    );
    return placed;
  });

  // Cancel a resting order. Risk-reducing, but still a write: gated by the
  // exact same trading switches as placement, audited and notified.
  app.delete<{ Params: { id: string }; Querystring: { symbol?: string } }>(
    '/api/orders/:id',
    async (req, reply) => {
      const status = tradingStatus();
      if (!status.enabled) {
        reply.status(403);
        return { error: 'TradingDisabled', message: status.reason, statusCode: 403 };
      }
      const id = req.params.id.trim();
      const symbol = req.query.symbol ? normalizeSymbol(req.query.symbol) : '';
      if (!id) throw new ProviderError('Missing order id', 400);
      if (!symbol) throw new ProviderError('Missing symbol (most exchanges require it to cancel)', 400);
      if (!provider.cancelOrder) throw new ProviderError('This provider cannot cancel orders.', 501);

      app.log.warn({ orderId: id, symbol, userId: req.userId }, 'LIVE order cancel');
      const result = await provider.cancelOrder(id, symbol);
      notifyWebhook(`🔴 LIVE order canceled — ${symbol} order ${result.id} (status ${result.status})`);
      return result;
    },
  );

  app.get<{ Params: { symbol: string }; Querystring: { limit?: string } }>(
    '/api/funding-history/:symbol',
    async (req) => {
      const symbol = normalizeSymbol(req.params.symbol);
      if (!symbol) throw new ProviderError('Missing symbol', 400);
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
    const q = (req.query.q ?? '').trim();
    if (q.length === 0) return [];
    return provider.search(q);
  });

  app.get<{ Querystring: { symbol?: string } }>('/api/news', async (req) => {
    const symbol = req.query.symbol ? normalizeSymbol(req.query.symbol) : undefined;
    return provider.getNews(symbol);
  });

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

      const messages = (req.body?.messages ?? [])
        .filter(
          (m): m is ChatMessage =>
            !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
        )
        .slice(-12);
      if (messages.length === 0) throw new ProviderError('No messages provided', 400);

      const symbol = req.body?.symbol ? normalizeSymbol(req.body.symbol) : undefined;
      const context = await buildContext(provider, symbol);
      const system = `${COPILOT_SYSTEM_PREAMBLE}\n\nLIVE DATA:\n${context}`;
      const content = await callClaude({ system, messages, model: config.aiModel, apiKey });
      return { role: 'assistant', content };
    },
  );
}
