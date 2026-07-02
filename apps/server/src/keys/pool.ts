import type { DataProvider } from '../providers';
import type { KeyRepo, UserExchangeKeys } from './repo';

/**
 * Per-user provider resolution (HOSTED_KEYS_DESIGN.md, PR 2–3). Anonymous
 * callers and users without stored keys get the base (operator env-keyed)
 * provider — self-host behavior unchanged. Users with stored keys get a
 * cached provider built from THEIR credentials, isolated from the operator's
 * env (no secondary venue, no stream).
 *
 * Two accessors with different fallback rules:
 * - {@link ProviderPool.for} (reads): falls back to base, so a read never
 *   500s just because a user's stored keys are broken.
 * - {@link ProviderPool.userFor} (trading + per-user loops): returns null
 *   instead of falling back — a user's writes and background polling must
 *   NEVER silently land on the operator's account.
 */

export interface ProviderPool {
  for(userId: string | undefined): DataProvider;
  /**
   * The user's OWN provider or null (no keys stored / undecryptable /
   * construction failed). Never the base provider.
   */
  userFor(userId: string | undefined): DataProvider | null;
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

  const userFor = (userId: string | undefined): DataProvider | null => {
    if (!userId || !deps.repo) return null;
    const cached = cache.get(userId);
    if (cached) return cached;
    const keys = deps.repo.get(userId);
    if (!keys) return null;
    let provider: DataProvider;
    try {
      provider = deps.factory(keys);
    } catch {
      // Bad exchange id / construction failure → null; `for()` turns that
      // into an honest base fallback for reads.
      return null;
    }
    cache.set(userId, provider);
    if (cache.size > MAX_CACHED) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return provider;
  };

  return {
    for: (userId) => userFor(userId) ?? deps.base,
    userFor,
    invalidate(userId) {
      cache.delete(userId);
    },
    size: () => cache.size,
  };
}
