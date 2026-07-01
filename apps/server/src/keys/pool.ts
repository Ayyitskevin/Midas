import type { DataProvider } from '../providers';
import type { KeyRepo, UserExchangeKeys } from './repo';

/**
 * Per-user provider resolution (HOSTED_KEYS_DESIGN.md, PR 2). Anonymous
 * callers and users without stored keys get the base (operator env-keyed)
 * provider — self-host behavior unchanged. Users with stored keys get a
 * cached provider built from THEIR credentials, isolated from the operator's
 * env (no secondary venue, no stream).
 *
 * Scope guard: the pool is consulted by account READ routes only. Trading
 * routes stay pinned to the base provider and the operator's gates until
 * per-user trading ships with its own review (PR 3 / roadmap-v2 Week 3).
 */

export interface ProviderPool {
  for(userId: string | undefined): DataProvider;
  /** Drop a cached provider after a key set/delete. */
  invalidate(userId: string): void;
  size(): number;
}

const MAX_CACHED = 25;

export function createProviderPool(deps: {
  base: DataProvider;
  repo: KeyRepo | null;
  /** Builds a provider from decrypted creds (tests inject a stub). */
  factory: (keys: UserExchangeKeys) => DataProvider;
}): ProviderPool {
  const cache = new Map<string, DataProvider>();

  return {
    for(userId) {
      if (!userId || !deps.repo) return deps.base;
      const cached = cache.get(userId);
      if (cached) return cached;
      const keys = deps.repo.get(userId);
      if (!keys) return deps.base;
      let provider: DataProvider;
      try {
        provider = deps.factory(keys);
      } catch {
        // Bad exchange id / construction failure → honest fallback to base
        // rather than a 500 on every read.
        return deps.base;
      }
      cache.set(userId, provider);
      if (cache.size > MAX_CACHED) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      return provider;
    },
    invalidate(userId) {
      cache.delete(userId);
    },
    size: () => cache.size,
  };
}
