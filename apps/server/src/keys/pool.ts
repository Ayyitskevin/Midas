import type { DataProvider } from '../providers';
import type { KeyRepo, UserExchangeKeys } from './repo';

/**
 * Per-user provider resolution (HOSTED_KEYS_DESIGN.md, PR 2–3). Without a
 * per-user key store, account reads keep the self-hosted base-provider model.
 * Once the store is enabled, account reads use the authenticated caller's own
 * cached provider or return unavailable. A missing user identity also fails
 * closed, so an auth misconfiguration cannot expose the operator's env-keyed
 * account.
 *
 * Two accessors with different fallback rules:
 * - {@link ProviderPool.accountFor} (reads): returns the base only when the
 *   per-user store is off; otherwise it returns the caller's provider or null.
 * - {@link ProviderPool.userFor} (trading + per-user loops): returns null
 *   instead of falling back — a user's writes and background polling must
 *   NEVER silently land on the operator's account.
 */

export interface ProviderPool {
  /** Account provider for this caller, or null when per-user credentials are unavailable. */
  accountFor(userId: string | undefined): DataProvider | null;
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
      // Bad exchange id / construction failure → null. Account reads surface
      // that honestly; they never fall back to the operator's credentials.
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
    accountFor: (userId) => {
      // No per-user store (normal self-host) keeps the operator provider. With
      // a store, an authenticated caller is a tenant boundary and must use
      // only their own credentials.
      if (!deps.repo) return deps.base;
      return userFor(userId);
    },
    userFor,
    invalidate(userId) {
      cache.delete(userId);
    },
    size: () => cache.size,
  };
}
