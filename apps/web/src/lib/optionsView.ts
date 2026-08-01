import type { DataProvenance, TermStructure } from '@midas/shared';

/**
 * Pure view helpers for the options / DVOL / term-structure panels: the
 * honesty badge (same shape as dexBadge for the on-chain module), term-
 * structure shape classification, and small formatters. DOM-free and tested.
 */

export type OptionsTone = 'live' | 'synthetic' | 'unavailable';

export interface OptionsBadge {
  label: string;
  tone: OptionsTone;
  detail: string;
}

/** Badge for any provenance-labeled options payload — synthetic never reads as live. */
export function optionsBadge(provenance: DataProvenance, note: string | null): OptionsBadge {
  switch (provenance) {
    case 'live':
      return { label: 'live · deribit', tone: 'live', detail: note ?? 'Live Deribit data.' };
    case 'synthetic':
      return { label: 'synthetic', tone: 'synthetic', detail: note ?? 'Synthetic — not real market data.' };
    default:
      return { label: 'unavailable', tone: 'unavailable', detail: note ?? 'Data unavailable.' };
  }
}

export type TermShape = 'contango' | 'backwardation' | 'mixed';

/**
 * Classify the calendar curve: every point above +0.5% annualized is contango,
 * every point below −0.5% backwardation, anything in between (or a curve that
 * flips sign) is mixed. Null when fewer than two points — a single future is
 * not a term structure, and the panel must say so rather than guess.
 */
export function classifyTermStructure(ts: Pick<TermStructure, 'points'>): TermShape | null {
  if (ts.points.length < 2) return null;
  const bases = ts.points.map((p) => p.annualizedBasisPct);
  if (bases.every((b) => b > 0.5)) return 'contango';
  if (bases.every((b) => b < -0.5)) return 'backwardation';
  return 'mixed';
}

/** Signed annualized-basis percent, e.g. +6.25% / −1.50%; em-dash for null. */
export function fmtBasis(basisPct: number | null): string {
  if (basisPct == null) return '—';
  return `${basisPct >= 0 ? '+' : ''}${basisPct.toFixed(2)}%`;
}

/** Implied vol in percent, one decimal; em-dash for null. */
export function fmtIv(iv: number | null): string {
  return iv == null ? '—' : iv.toFixed(1);
}

/** Expiry as '27 Sep'; em-dash for a missing/zero timestamp. */
export function fmtExpiry(expiryMs: number): string {
  if (!Number.isFinite(expiryMs) || expiryMs <= 0) return '—';
  const d = new Date(expiryMs);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

/** Days-to-expiry as '7d' / '1.5d'. */
export function fmtDays(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return '—';
  return days >= 10 ? `${Math.round(days)}d` : `${days.toFixed(1)}d`;
}

/** Positioning read of the put/call OI ratio. */
export function pcrLabel(ratio: number | null): string {
  if (ratio == null) return '—';
  if (ratio > 1.2) return 'put-heavy';
  if (ratio < 0.8) return 'call-heavy';
  return 'balanced';
}
