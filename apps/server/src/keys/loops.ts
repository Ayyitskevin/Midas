import { createAccountWatcher, type AccountWatchHandle } from '../accountWatch';
import { EquityRepo, startEquityLoop, type EquityLoop } from '../equity';
import type { DataProvider } from '../providers';
import type { KeyRepo } from './repo';

/**
 * Per-user background loop sets (HOSTED_KEYS_DESIGN.md, PR 3): each keyed
 * user gets their own account watcher (fill events for THEIR account, into
 * THEIR feed) and equity snapshot loop, started when their keys are stored
 * and stopped when they're deleted. Bounded by a keyed-user cap so a hosted
 * box degrades predictably: users beyond the cap keep per-request reads but
 * run no background loops (and the events/equity routes say so honestly).
 *
 * Isolation rules, enforced by construction:
 * - Loops only ever run against the user's OWN provider (pool.userFor —
 *   never the base fallback), so a broken key can't poll the operator's
 *   account on a user's behalf.
 * - No operator webhook: user fill events surface only in the user's
 *   in-terminal feed. (Per-user webhooks are a future user setting.)
 * - The operator's own loops (index.ts) are untouched.
 */

export interface UserLoopsDeps {
  repo: KeyRepo;
  pool: { userFor(userId: string | undefined): DataProvider | null };
  /** Watcher cadence in ms (0 = watchers off). Caller floors it. */
  watchMs: number;
  /** Equity snapshot cadence in ms (0 = equity off). Caller floors it. */
  equityMs: number;
  /** Per-user snapshot file; undefined = in-memory (tests). */
  equityFileFor?: (userId: string) => string | undefined;
  /** Keyed users allowed to run loops (default 25). */
  maxUsers?: number;
  onError?: (userId: string, err: unknown) => void;
  /** Called when the cap refuses a user's loops (log hook). */
  onRefused?: (userId: string) => void;
}

interface LoopSet {
  watcher: AccountWatchHandle | null;
  watcherTimer: ReturnType<typeof setInterval> | null;
  equityRepo: EquityRepo | null;
  equityLoop: EquityLoop | null;
}

export interface UserLoops {
  /** Start — or rebuild after a key change — the loop set for a keyed user. */
  ensure(userId: string): void;
  /** Stop + forget a user's loops (key deleted). */
  drop(userId: string): void;
  watcherFor(userId: string): AccountWatchHandle | null;
  equityRepoFor(userId: string): EquityRepo | null;
  size(): number;
  stopAll(): void;
}

const DEFAULT_MAX_USERS = 25;

export function createUserLoops(deps: UserLoopsDeps): UserLoops {
  const maxUsers = deps.maxUsers ?? DEFAULT_MAX_USERS;
  const sets = new Map<string, LoopSet>();

  const stopSet = (set: LoopSet): void => {
    if (set.watcherTimer) clearInterval(set.watcherTimer);
    set.equityLoop?.stop();
  };

  const drop = (userId: string): void => {
    const set = sets.get(userId);
    if (!set) return;
    stopSet(set);
    sets.delete(userId);
  };

  return {
    ensure(userId) {
      // A key change invalidates the old provider — rebuild from scratch.
      drop(userId);
      if (!deps.repo.metaFor(userId)) return; // keys gone → stay dropped
      if (deps.watchMs <= 0 && deps.equityMs <= 0) return; // both loops off
      if (sets.size >= maxUsers) {
        deps.onRefused?.(userId);
        return;
      }
      const provider = deps.pool.userFor(userId);
      // No usable user provider → no loops. NEVER poll the base provider on
      // a user's behalf: that would put the operator's account activity in a
      // user's feed.
      if (!provider) return;

      const set: LoopSet = { watcher: null, watcherTimer: null, equityRepo: null, equityLoop: null };
      if (deps.watchMs > 0) {
        // No notify: user events stay in the user's feed, not the operator's
        // webhook.
        set.watcher = createAccountWatcher({
          provider,
          onError: (err) => deps.onError?.(userId, err),
        });
        set.watcherTimer = setInterval(() => void set.watcher?.tick(), deps.watchMs);
        set.watcherTimer.unref?.();
      }
      if (deps.equityMs > 0) {
        set.equityRepo = new EquityRepo(deps.equityFileFor?.(userId));
        set.equityLoop = startEquityLoop(set.equityRepo, provider, deps.equityMs, (err) =>
          deps.onError?.(userId, err),
        );
      }
      sets.set(userId, set);
    },
    drop,
    watcherFor: (userId) => sets.get(userId)?.watcher ?? null,
    equityRepoFor: (userId) => sets.get(userId)?.equityRepo ?? null,
    size: () => sets.size,
    stopAll() {
      for (const set of sets.values()) stopSet(set);
      sets.clear();
    },
  };
}

/** Filesystem-safe per-user equity snapshot filename. */
export function userEquityFileName(userId: string): string {
  return `equity-${userId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
}
