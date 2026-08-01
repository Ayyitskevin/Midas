/**
 * In-memory login throttle — the auth layer's brake against credential
 * stuffing and password guessing. Tracks consecutive failures per key
 * (username|ip); at the threshold the pair is locked out for a cooldown.
 * A per-pair lockout alone gives every fresh username a new budget, so a
 * second, aggregate ceiling tracks failures per IP: at ipMaxFails the whole
 * address is locked out for the same cooldown, whatever usernames it sprays.
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
  /** Milliseconds until this IP may try again, or null when allowed. */
  checkIp(ip: string, nowMs: number): number | null;
  /** Record a failed attempt toward the aggregate per-IP ceiling. */
  failIp(ip: string, nowMs: number): void;
  size(): number;
  ipSize(): number;
}

export function createLoginThrottle(
  maxFails = 5,
  lockoutMs = 60_000,
  maxEntries = 10_000,
  // Higher than the per-pair threshold: several humans can share one address
  // (NAT), but 20 failures a minute from one IP is not a human anymore.
  ipMaxFails = 20,
): LoginThrottle {
  type Entry = { fails: number; lastFailAt: number };
  const entries = new Map<string, Entry>();
  const ipEntries = new Map<string, Entry>();

  // Bound memory under a spray attack: drop expired streaks first, then the
  // oldest entries (insertion order) if something is still flooding us.
  const gc = (map: Map<string, Entry>, nowMs: number): void => {
    if (map.size <= maxEntries) return;
    for (const [k, v] of map) {
      if (nowMs - v.lastFailAt > lockoutMs) map.delete(k);
      if (map.size <= maxEntries) return;
    }
    while (map.size > maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) return;
      map.delete(oldest);
    }
  };

  const checkMap = (map: Map<string, Entry>, key: string, nowMs: number, threshold: number): number | null => {
    const e = map.get(key);
    if (!e || e.fails < threshold) return null;
    const until = e.lastFailAt + lockoutMs;
    if (nowMs >= until) {
      map.delete(key); // lockout served — fresh slate
      return null;
    }
    return until - nowMs;
  };

  const failMap = (map: Map<string, Entry>, key: string, nowMs: number): void => {
    if (!key) return;
    const e = map.get(key);
    if (e && nowMs - e.lastFailAt <= lockoutMs) {
      e.fails += 1;
      e.lastFailAt = nowMs;
    } else {
      // A stale streak (quiet for a full cooldown) restarts at 1.
      map.set(key, { fails: 1, lastFailAt: nowMs });
    }
    gc(map, nowMs);
  };

  return {
    check: (key, nowMs) => checkMap(entries, key, nowMs, maxFails),
    fail: (key, nowMs) => failMap(entries, key, nowMs),
    succeed(key) {
      entries.delete(key);
      // Deliberately NOT cleared on the per-IP map: a stuffer holding one
      // valid account could otherwise reset their aggregate budget at will.
    },
    checkIp: (ip, nowMs) => checkMap(ipEntries, ip, nowMs, ipMaxFails),
    failIp: (ip, nowMs) => failMap(ipEntries, ip, nowMs),
    size: () => entries.size,
    ipSize: () => ipEntries.size,
  };
}
