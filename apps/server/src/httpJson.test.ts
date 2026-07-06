import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchJsonWithTimeout } from './httpJson';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

/** A minimal fetch stub returning the given ok/status and JSON body. */
function stubFetch(res: { ok: boolean; status: number; body?: unknown }): void {
  globalThis.fetch = (async () => ({
    ok: res.ok,
    status: res.status,
    json: async () => res.body ?? {},
  })) as unknown as typeof fetch;
}

describe('fetchJsonWithTimeout', () => {
  it('returns the parsed JSON body on a 2xx', async () => {
    stubFetch({ ok: true, status: 200, body: { hello: 'world' } });
    expect(await fetchJsonWithTimeout('http://x')).toEqual({ hello: 'world' });
  });

  it('throws on a non-2xx — the callers turn this into an honest unavailable snapshot', async () => {
    stubFetch({ ok: false, status: 503 });
    await expect(fetchJsonWithTimeout('http://x')).rejects.toThrow('HTTP 503');
  });

  it('forwards method + body and merges caller headers over the JSON default', async () => {
    let seen: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seen = init;
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;

    await fetchJsonWithTimeout('http://rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    });

    const headers = seen?.headers as Record<string, string>;
    expect(seen?.method).toBe('POST');
    expect(seen?.body).toBe('{"a":1}');
    expect(headers['content-type']).toBe('application/json');
    expect(headers.Accept).toBe('application/json'); // default preserved
  });

  it('aborts (rejects) when the request outruns the timeout', async () => {
    vi.useFakeTimers();
    // Never resolves on its own — only the timeout's abort can settle it.
    globalThis.fetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;

    const pending = fetchJsonWithTimeout('http://slow', { timeoutMs: 10 });
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
  });
});
