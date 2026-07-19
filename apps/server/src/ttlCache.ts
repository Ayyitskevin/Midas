/**
 * A tiny async TTL cache with single-flight de-duplication.
 *
 * Keys map to a value cached for `ttlMs`. Concurrent misses on the same key
 * share ONE in-flight computation instead of each triggering the (expensive)
 * work, so a burst of requests collapses to a single upstream sweep. This is
 * what makes a fan-out route (e.g. cross-venue funding, which reads N perps ×
 * M venues per request) safe to expose on a multi-tenant hosted instance:
 * concurrent users and client polling within the window reuse one result.
 *
 * A rejected computation is never cached and clears its in-flight slot, so the
 * next call retries. `now` is injectable for deterministic tests.
 */
export interface TtlCache<T> {
  get(key: string, compute: () => Promise<T>): Promise<T>;
}

/**
 * Default cap on distinct cached keys. Bounds the Map so a route keyed by
 * user-controlled input can't grow it without limit (see {@link prune}).
 */
const DEFAULT_MAX_ENTRIES = 500;

export function createTtlCache<T>(
  ttlMs: number,
  now: () => number = Date.now,
  maxEntries: number = DEFAULT_MAX_ENTRIES,
): TtlCache<T> {
  const fresh = new Map<string, { value: T; at: number }>();
  const inflight = new Map<string, Promise<T>>();

  return {
    get(key, compute) {
      const hit = fresh.get(key);
      if (hit) {
        if (now() - hit.at < ttlMs) return Promise.resolve(hit.value);
        fresh.delete(key); // expired — drop it now rather than let it linger
      }

      const pending = inflight.get(key);
      if (pending) return pending;

      const p = (async () => {
        try {
          const value = await compute();
          fresh.set(key, { value, at: now() });
          prune(fresh, ttlMs, now(), maxEntries);
          return value;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, p);
      return p;
    },
  };
}

/**
 * Keep the cache bounded: sweep entries past their TTL, then, if still over the
 * cap, evict oldest-first (a Map preserves insertion order). Without this an
 * entry keyed by user input that is requested once and never again would stay
 * forever — a junk-key spray is otherwise unbounded memory growth on a public
 * route.
 */
function prune<T>(
  fresh: Map<string, { value: T; at: number }>,
  ttlMs: number,
  t: number,
  maxEntries: number,
): void {
  for (const [k, v] of fresh) {
    if (t - v.at >= ttlMs) fresh.delete(k);
  }
  if (fresh.size > maxEntries) {
    let excess = fresh.size - maxEntries;
    for (const k of fresh.keys()) {
      if (excess-- <= 0) break;
      fresh.delete(k);
    }
  }
}
