import type { FastifyInstance } from 'fastify';
import type { DataProvider } from '../providers';
import { ProviderError } from '../providers';
import { config } from '../config';
import { COPILOT_SYSTEM_PREAMBLE, buildContext, callClaude } from '../ai';
import type { ChatMessage } from '../ai';
import { createRateLimiter } from '../rateLimit';
import { normalizeSymbol } from './shared';

// The AI copilot calls a paid upstream (Anthropic). Cap it per caller — far
// below the global request limiter — so one client can't run up the operator's
// bill even while staying under the general rate limit.
const AI_CHAT_WINDOW_MS = 60_000;
const AI_CHAT_MAX_PER_WINDOW = 10;

/**
 * AI copilot route. Calls a paid upstream (Anthropic), so it is 503 without a
 * server key and per-caller rate-limited before building context or reaching
 * Claude.
 */
export function registerAiRoutes(app: FastifyInstance, provider: DataProvider): void {
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

      const symbol = normalizeSymbol(req.body?.symbol) || undefined;
      const context = await buildContext(provider, symbol);
      const system = `${COPILOT_SYSTEM_PREAMBLE}\n\nLIVE DATA:\n${context}`;
      const content = await callClaude({ system, messages, model: config.aiModel, apiKey });
      return { role: 'assistant', content };
    },
  );
}
