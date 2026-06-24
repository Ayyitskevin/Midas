import type { FastifyInstance } from 'fastify';
import { isInterval, isRange } from '@midas/shared';
import type { HealthResponse, Interval, Range } from '@midas/shared';
import type { DataProvider } from './providers';
import { ProviderError } from './providers';
import { config } from './config';
import { COPILOT_SYSTEM_PREAMBLE, buildContext, callClaude } from './ai';
import type { ChatMessage } from './ai';

const DEFAULT_INTERVAL: Interval = '1d';
const DEFAULT_RANGE: Range = '6mo';
const MAX_BATCH_SYMBOLS = 50;

function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase();
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

  app.get<{ Params: { symbol: string } }>('/api/derivatives/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing symbol', 400);
    return provider.getDerivatives(symbol);
  });

  app.get<{ Querystring: { quote?: string; sort?: string; limit?: string } }>(
    '/api/screener',
    async (req) => {
      const limitRaw = Number(req.query.limit);
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50;
      return provider.screen({ quote: req.query.quote, sort: req.query.sort, limit });
    },
  );

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
