/**
 * Fixed-window per-key request limiter — protection for public surfaces
 * (the demo box above all). In-memory and deliberately simple: the goal is
 * "a public instance survives being popular", not billing-grade metering.
 * Clock injected per call; memory bounded under an address spray.
 */
export interface RateLimiter {
  /** Milliseconds until this key may try again, or null when allowed (and counted). */
  check(key: string, nowMs: number): number | null;
  size(): number;
}

export function createRateLimiter(windowMs: number, maxPerWindow: number, maxKeys = 10_000): RateLimiter {
  const windows = new Map<string, { startedAt: number; count: number }>();

  return {
    check(key, nowMs) {
      let w = windows.get(key);
      if (!w || nowMs - w.startedAt >= windowMs) {
        w = { startedAt: nowMs, count: 0 };
        windows.set(key, w);
        if (windows.size > maxKeys) {
          const oldest = windows.keys().next().value;
          if (oldest !== undefined) windows.delete(oldest);
        }
      }
      w.count += 1;
      if (w.count <= maxPerWindow) return null;
      return w.startedAt + windowMs - nowMs;
    },
    size: () => windows.size,
  };
}
