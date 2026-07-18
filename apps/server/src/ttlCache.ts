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

export function createTtlCache<T>(ttlMs: number, now: () => number = Date.now): TtlCache<T> {
  const fresh = new Map<string, { value: T; at: number }>();
  const inflight = new Map<string, Promise<T>>();

  return {
    get(key, compute) {
      const hit = fresh.get(key);
      if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.value);

      const pending = inflight.get(key);
      if (pending) return pending;

      const p = (async () => {
        try {
          const value = await compute();
          fresh.set(key, { value, at: now() });
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
