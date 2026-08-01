/**
 * Board-envelope honesty: map the BoardMeta provenance/freshness wrapper of the
 * fan-out boards (funding, dispersion, venue arb, OI concentration) to a
 * user-facing badge. Same principle as sourceStatus.ts — a cached or synthetic
 * board must be visually distinguishable from a fresh live one, and the server's
 * caveat note is surfaced, never smoothed over. Pure and offline.
 */

import type { BoardMeta } from '@midas/shared';

export interface BoardMetaView {
  /** Tailwind bg-color class for the status dot. */
  dotClass: string;
  /** Honest tooltip. */
  title: string;
  /** Source label, e.g. 'mock' or the ccxt exchange id. */
  source: string;
  /** Short status: 'live' | 'cached' | 'synthetic' | 'unavailable'. */
  label: 'live' | 'cached' | 'synthetic' | 'unavailable';
  /** Age of the board, e.g. '42s ago' / '3m ago'. */
  ageText: string;
  /** The server's caveat note, when attached. */
  note: string | null;
  /** True when the note deserves the loud amber banner vs the quiet one. */
  warn: boolean;
}

/** Age of a timestamp as short text: 'now', '42s ago', '3m ago', '2h ago', '5d ago'. */
export function fmtAge(epochMs: number, now: number): string {
  const diff = now - epochMs;
  if (diff < 10_000) return 'now';
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Unwrap the display decision for a board envelope: provenance label, staleness
 * (served from cache), age, and whether the note should shout. `now` is
 * injectable for tests.
 */
export function boardMetaView(meta: BoardMeta, now: number = Date.now()): BoardMetaView {
  const ageText = fmtAge(meta.asOf, now);
  const note = meta.partial && meta.note == null ? 'Some symbols/venues failed — rows were dropped.' : meta.note;

  if (meta.provenance === 'unavailable') {
    return {
      dotClass: 'bg-term-down',
      title: `Board unavailable from ${meta.source}`,
      source: meta.source,
      label: 'unavailable',
      ageText,
      note,
      warn: true,
    };
  }
  if (meta.provenance === 'synthetic') {
    return {
      dotClass: 'bg-term-amber',
      title: `Synthetic data (${meta.source}) — not a live feed`,
      source: meta.source,
      label: 'synthetic',
      ageText,
      note,
      warn: true,
    };
  }
  if (meta.cachedAt != null) {
    return {
      dotClass: 'bg-term-amber',
      title: `Cached board from ${meta.source} — computed ${ageText}, served from cache`,
      source: meta.source,
      label: 'cached',
      ageText,
      note,
      warn: meta.partial,
    };
  }
  return {
    dotClass: meta.partial ? 'bg-term-amber' : 'bg-term-up',
    title: `Live board from ${meta.source} · computed ${ageText}`,
    source: meta.source,
    label: 'live',
    ageText,
    note,
    warn: meta.partial,
  };
}
