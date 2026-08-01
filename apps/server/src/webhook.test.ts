import { describe, it, expect, vi, afterEach } from 'vitest';
import { postWebhookText } from './webhook';

afterEach(() => {
  vi.restoreAllMocks();
});

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
    vi.spyOn(console, 'warn').mockImplementation(() => {});
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

  it('attaches a timeout AbortSignal so a hung endpoint cannot pin a socket', () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = ((_url: unknown, init?: RequestInit) => {
      signal = init?.signal as AbortSignal;
      return new Promise(() => {}); // hung endpoint — the signal is the escape
    }) as unknown as typeof fetch;
    postWebhookText('http://hook.example/x', 'x', fetchImpl);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(false);
  });

  it('logs a message-only warning on a non-ok status — never the URL or payload', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = (async () => new Response('not found', { status: 404 })) as typeof fetch;
    postWebhookText('http://hook.example/SECRET-TOKEN', 'alert payload text', fetchImpl);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = String(warn.mock.calls[0][0]);
    expect(logged).toContain('404');
    expect(logged).not.toContain('SECRET-TOKEN');
    expect(logged).not.toContain('alert payload text');
  });

  it('logs a message-only warning on a timeout/abort rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // What fetch rejects with when the AbortSignal fires.
    const fetchImpl = (async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    }) as typeof fetch;
    postWebhookText('http://hook.example/SECRET-TOKEN', 'x', fetchImpl);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = String(warn.mock.calls[0][0]);
    expect(logged).toContain('timed out');
    expect(logged).not.toContain('SECRET-TOKEN');
  });

  it('does not log on a successful delivery', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    postWebhookText('http://hook.example/x', 'x', (async () => new Response('ok')) as typeof fetch);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warn).not.toHaveBeenCalled();
  });
});
