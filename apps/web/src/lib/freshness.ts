/**
 * Per-panel freshness: a frozen panel must be visually distinguishable from a
 * live one. These pure helpers back the FreshnessAge indicator — they compute
 * the short age text and the stale decision from a last-update timestamp, so
 * the component stays thin and the rules stay testable. Same honesty principle
 * as boardMeta.ts / sourceStatus.ts: never hide the data, mark its age. Pure
 * and offline.
 */

export interface FreshnessInput {
  /** Epoch ms of the last update (REST success or stream message); null = never. */
  fetchedAt: number | null;
  /** Age (ms) beyond which the data reads stale — per panel, ~2x its refresh cadence. */
  staleAfterMs: number;
  /** True when the panel shows stream-driven data but the socket is down. */
  streamDisconnected?: boolean;
  /** Injectable clock for tests. */
  now?: number;
}

export interface FreshnessView {
  /** Short age text, e.g. 'now' / '12s' / '3m' / '2h' / '5d'; null = nothing to show. */
  text: string | null;
  /** True = render amber (stale age or disconnected stream). Data stays visible. */
  stale: boolean;
}

/** Short age of a duration: 'now', '12s', '3m', '2h', '5d'. */
export function fmtAgeShort(ageMs: number): string {
  const ms = Math.max(0, ageMs);
  if (ms < 10_000) return 'now';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Decide what the per-panel freshness indicator shows. Stale when the last
 * update is older than the panel's threshold, or when the panel's stream is
 * disconnected while it displays stream-driven data.
 */
export function freshnessView(input: FreshnessInput): FreshnessView {
  if (input.fetchedAt == null) return { text: null, stale: false };
  const now = input.now ?? Date.now();
  const age = Math.max(0, now - input.fetchedAt);
  return {
    text: fmtAgeShort(age),
    stale: age > input.staleAfterMs || input.streamDisconnected === true,
  };
}
