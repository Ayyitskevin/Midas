/**
 * In-memory login throttle — the auth layer's brake against credential
 * stuffing and password guessing. Tracks consecutive failures per key
 * (username|ip); at the threshold the pair is locked out for a cooldown.
 * In-memory by design (resets on restart, like the trading ledger): the goal
 * is to make online guessing impractically slow, not to persist punishment.
 * Clock injected per call, so the behavior is unit-testable.
 */
export interface LoginThrottle {
  /** Milliseconds until this key may try again, or null when allowed. */
  check(key: string, nowMs: number): number | null;
  /** Record a failed attempt. */
  fail(key: string, nowMs: number): void;
  /** Clear the key after a successful login. */
  succeed(key: string): void;
  size(): number;
}

export function createLoginThrottle(
  maxFails = 5,
  lockoutMs = 60_000,
  maxEntries = 10_000,
): LoginThrottle {
  const entries = new Map<string, { fails: number; lastFailAt: number }>();

  // Bound memory under a spray attack: drop expired streaks first, then the
  // oldest entries (insertion order) if something is still flooding us.
  const gc = (nowMs: number): void => {
    if (entries.size <= maxEntries) return;
    for (const [k, v] of entries) {
      if (nowMs - v.lastFailAt > lockoutMs) entries.delete(k);
      if (entries.size <= maxEntries) return;
    }
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) return;
      entries.delete(oldest);
    }
  };

  return {
    check(key, nowMs) {
      const e = entries.get(key);
      if (!e || e.fails < maxFails) return null;
      const until = e.lastFailAt + lockoutMs;
      if (nowMs >= until) {
        entries.delete(key); // lockout served — fresh slate
        return null;
      }
      return until - nowMs;
    },
    fail(key, nowMs) {
      if (!key) return;
      const e = entries.get(key);
      if (e && nowMs - e.lastFailAt <= lockoutMs) {
        e.fails += 1;
        e.lastFailAt = nowMs;
      } else {
        // A stale streak (quiet for a full cooldown) restarts at 1.
        entries.set(key, { fails: 1, lastFailAt: nowMs });
      }
      gc(nowMs);
    },
    succeed(key) {
      entries.delete(key);
    },
    size: () => entries.size,
  };
}
