/**
 * A monotonic "latest wins" gate for async operations that may resolve out of
 * order. Each `start()` hands back a token; `isLatest(token)` is true only for
 * the most recently started operation.
 *
 * Hooks that fire overlapping async work — an interval poll that laps a slow
 * earlier poll, or a debounced push that fires again before the last resolved —
 * use it to apply only the newest result and discard a stale one that lands
 * late. Pure and side-effect free so the ordering logic is unit-testable on its
 * own, away from React's effect lifecycle.
 */
export interface LatestGate {
  /** Begin an operation; returns its token and makes it the current latest. */
  start(): number;
  /** Whether `token` is still the most recently started operation. */
  isLatest(token: number): boolean;
}

export function createLatestGate(): LatestGate {
  let latest = 0;
  return {
    start: () => (latest += 1),
    isLatest: (token: number) => token === latest,
  };
}
