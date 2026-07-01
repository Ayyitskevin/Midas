import { describe, it, expect } from 'vitest';
import { postWebhookText } from './webhook';

describe('postWebhookText', () => {
  it('POSTs a Discord/Slack-compatible payload to the URL', () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: unknown, init?: unknown) => {
      calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
      return new Response('ok');
    }) as typeof fetch;
    postWebhookText('http://hook.example/x', 'hello', fetchImpl);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://hook.example/x');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ content: 'hello', text: 'hello' });
  });

  it('is a no-op without a URL and swallows delivery failures', async () => {
    let called = 0;
    postWebhookText('', 'hello', (async () => {
      called += 1;
      return new Response('ok');
    }) as typeof fetch);
    expect(called).toBe(0);

    // A failing webhook must never surface to the caller (fire-and-forget).
    postWebhookText('http://hook.example/x', 'x', (async () => {
      throw new Error('endpoint down');
    }) as typeof fetch);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
