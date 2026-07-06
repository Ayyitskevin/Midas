/**
 * One place for the "GET/POST JSON with a hard timeout, throw on failure" dance
 * that the server's live upstreams share (Solana RPC, Jupiter, GeckoTerminal,
 * Dexscreener). Every one of those callers treats a throw as its degradation
 * signal — it turns any rejection into an honest `unavailable`/`error` snapshot —
 * so this helper's contract is deliberately simple: resolve with the parsed JSON
 * on a 2xx, otherwise throw (transport error, timeout/abort, or a non-2xx
 * status). The timeout timer is always cleared, on both success and failure.
 *
 * Note: the Yahoo provider intentionally does NOT use this. It has no timeout and
 * raises a typed ProviderError carrying the upstream HTTP status (which the REST
 * layer maps to a response code) — a different contract from the throw-to-
 * unavailable-snapshot family here.
 */

export interface FetchJsonOptions {
  method?: 'GET' | 'POST';
  /** Extra request headers, merged over the default `Accept: application/json`. */
  headers?: Record<string, string>;
  /** Already-serialized request body (POST). */
  body?: string;
  /** Abort the request after this many milliseconds (default 6000). */
  timeoutMs?: number;
}

/** Fetch JSON with a hard timeout; throws on transport failure, abort, or non-2xx. */
export async function fetchJsonWithTimeout(url: string, options: FetchJsonOptions = {}): Promise<unknown> {
  const { method = 'GET', headers, body, timeoutMs = 6000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...headers },
      ...(body !== undefined ? { body } : {}),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
