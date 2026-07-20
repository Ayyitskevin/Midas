/**
 * Shared data-honesty helpers for provenance envelopes.
 *
 * Contract (mirrors DexPools / CoinUniverse / Solana snapshots):
 * - `live` → `note` is null (no caveat)
 * - `synthetic` / `unavailable` → `note` is a non-empty human string explaining why
 *
 * Pure functions only — safe in Node and browser (no runtime deps).
 */

/** Canonical three-way provenance label used across market, account, and Solana. */
export type DataProvenance = 'live' | 'synthetic' | 'unavailable';

/**
 * True when the note field is honest for the given provenance.
 * Empty string is treated as missing (not a valid caveat).
 */
export function provenanceNoteConsistent(
  provenance: DataProvenance,
  note: string | null | undefined,
): boolean {
  if (provenance === 'live') {
    return note == null || note === '';
  }
  return typeof note === 'string' && note.trim().length > 0;
}

/**
 * Repair a provenance envelope so it never ships without a caveat when the
 * data is synthetic or unavailable. Live data always clears the note.
 *
 * Does not invent market numbers — only fills/clears the honesty `note`.
 */
export function withHonestNote<T extends { provenance: DataProvenance; note: string | null }>(
  envelope: T,
  fallbackNote: string,
): T {
  if (envelope.provenance === 'live') {
    if (envelope.note == null) return envelope;
    return { ...envelope, note: null };
  }
  if (typeof envelope.note === 'string' && envelope.note.trim().length > 0) {
    return envelope;
  }
  const note = fallbackNote.trim() || 'Data is not live; see provider status.';
  return { ...envelope, note };
}

/** UI badge copy for a provenance value — never maps synthetic → LIVE. */
export function provenanceBadge(
  provenance: DataProvenance,
): { label: string; tone: 'live' | 'demo' | 'off' } {
  if (provenance === 'live') return { label: 'LIVE', tone: 'live' };
  if (provenance === 'synthetic') return { label: 'DEMO', tone: 'demo' };
  return { label: 'UNAVAILABLE', tone: 'off' };
}
