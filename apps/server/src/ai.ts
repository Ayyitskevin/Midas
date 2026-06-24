import type { DataProvider } from './providers';
import { ProviderError } from './providers';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Build a compact, live-data context block to ground the copilot's answers:
 * the active symbol's quote + headlines, plus the day's top movers. Best-effort —
 * any piece that fails is simply omitted.
 */
export async function buildContext(provider: DataProvider, symbol?: string): Promise<string> {
  const lines: string[] = [
    `Data provider: ${provider.name} (${provider.live ? 'live' : 'synthetic/dev data'}).`,
  ];

  if (symbol) {
    try {
      const q = await provider.getQuote(symbol);
      const sign = q.changePercent >= 0 ? '+' : '';
      lines.push(
        `\n${q.symbol} (${q.name}) on ${q.exchange}: last ${q.price} ${q.currency}, ` +
          `${sign}${q.changePercent.toFixed(2)}% 24h; day ${q.dayLow ?? '?'}-${q.dayHigh ?? '?'}; ` +
          `vol ${q.volume ?? '?'}.`,
      );
    } catch {
      // quote unavailable
    }
    try {
      const news = await provider.getNews(symbol);
      if (news.length) {
        lines.push(
          `Recent ${symbol} headlines:\n` +
            news.slice(0, 5).map((n) => `- ${n.title} (${n.publisher})`).join('\n'),
        );
      }
    } catch {
      // news unavailable
    }
  }

  try {
    const movers = await provider.screen({ sort: 'change', limit: 8 });
    if (movers.length) {
      lines.push(
        `Top movers (24h):\n` +
          movers
            .map((m) => `- ${m.symbol} ${m.changePercent >= 0 ? '+' : ''}${m.changePercent.toFixed(2)}% @ ${m.price}`)
            .join('\n'),
      );
    }
  } catch {
    // screener unavailable for this provider
  }

  return lines.join('\n');
}

export const COPILOT_SYSTEM_PREAMBLE =
  'You are Midas Copilot, an AI analyst embedded in a self-hosted crypto trading terminal. ' +
  'Answer concisely and practically, like a crypto trading-desk analyst. Ground your answers in ' +
  'the LIVE DATA below; if the data is synthetic/dev, you may note that. When useful, suggest ' +
  'Midas commands the user can run: DES (overview), GP (chart), BOOK (order book), ALLQ ' +
  '(multi-exchange), FUND (funding/OI/liquidations), SCR (screener). Keep answers short unless ' +
  'asked to elaborate. You are not a financial adviser; do not give individualized investment advice.';

/** Call the Anthropic Messages API and return the assistant's text. */
export async function callClaude(opts: {
  system: string;
  messages: ChatMessage[];
  model: string;
  apiKey: string;
}): Promise<string> {
  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: 1024,
        system: opts.system,
        messages: opts.messages,
      }),
    });
  } catch (cause) {
    throw new ProviderError(`Failed to reach Anthropic API: ${(cause as Error).message}`, 502);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(
      `Anthropic API ${res.status}: ${text.slice(0, 300)}`,
      res.status === 401 ? 401 : 502,
    );
  }

  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
}
