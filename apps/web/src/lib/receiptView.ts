import { computeReceiptFreshness, isPartialEvidenceLimitation } from '@midas/shared';
import type { DataReceipt, DataReceiptFreshness } from '@midas/shared';

/** The badge tone is a UI decision; it does not redefine DataProvenance. */
export type ReceiptTone = 'fresh' | 'partial' | 'stale' | 'synthetic' | 'unavailable' | 'unknown';

export interface ReceiptBadgeView {
  label: string;
  source: string;
  ageText: string;
  tone: ReceiptTone;
  title: string;
}

export interface ReceiptDetailRow {
  label: string;
  value: string;
  mono?: boolean;
}

const UNKNOWN = 'unknown';

function present(value: string | null | undefined): string {
  const text = value?.trim();
  return text ? text : UNKNOWN;
}

function normalized(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : UNKNOWN;
}

/** Compact duration with explicit handling for missing values and clock skew. */
export function formatReceiptDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return UNKNOWN;
  if (ms < 0) return `${formatReceiptDuration(Math.abs(ms))} ahead (clock skew)`;
  if (ms < 1_000) return `${Math.floor(ms)}ms`;
  const seconds = Math.floor(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Receipt timestamps are rendered in a stable UTC form, never local time. */
export function formatReceiptTime(iso: string | null | undefined): string {
  if (!iso?.trim()) return UNKNOWN;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return UNKNOWN;
  return `${date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')} UTC`;
}

function sourceLabel(receipt: DataReceipt): string {
  const source = present(receipt.source);
  const venue = present(receipt.venue);
  if (source === UNKNOWN) return venue;
  if (venue === UNKNOWN) return source;
  const normalizedSource = source.toLowerCase();
  const normalizedVenue = venue.toLowerCase();
  if (normalizedSource === normalizedVenue || normalizedSource.endsWith(`:${normalizedVenue}`)) return source;
  return `${source}:${venue}`;
}

/** Re-evaluate age against the client clock without ever upgrading uncertainty. */
export function effectiveReceiptFreshness(
  receipt: DataReceipt,
  evaluatedAtMs: number = Date.now(),
): DataReceiptFreshness {
  if (
    receipt.provenance === 'unavailable' ||
    receipt.freshness.state === 'unknown' ||
    receipt.freshness.state === 'clock-skew'
  ) {
    return receipt.freshness;
  }
  const evaluated = computeReceiptFreshness(
    receipt.sourceAsOf,
    receipt.maxAgeMs,
    evaluatedAtMs,
  );
  if (receipt.freshness.state === 'stale' && evaluated.state === 'fresh') {
    return receipt.freshness;
  }
  return evaluated;
}

export function isReceiptFresh(
  receipt: DataReceipt | null | undefined,
  evaluatedAtMs: number = Date.now(),
): receipt is DataReceipt {
  return Boolean(receipt && effectiveReceiptFreshness(receipt, evaluatedAtMs).state === 'fresh');
}

/** Trader-facing action colors require both current freshness and real evidence. */
export function isReceiptActionable(
  receipt: DataReceipt | null | undefined,
  evaluatedAtMs: number = Date.now(),
): receipt is DataReceipt {
  return Boolean(
    receipt?.provenance === 'live' &&
    !receipt.limitations.some(isPartialEvidenceLimitation) &&
    isReceiptFresh(receipt, evaluatedAtMs),
  );
}

/**
 * Compose source mode, freshness and derivation without overloading the shared
 * three-way provenance enum. A live source with unknown freshness is never
 * painted reassuring green.
 */
export function receiptBadgeView(
  receipt: DataReceipt,
  evaluatedAtMs: number = Date.now(),
): ReceiptBadgeView {
  const provenance = normalized(receipt.provenance);
  const effectiveFreshness = effectiveReceiptFreshness(receipt, evaluatedAtMs);
  const freshness = normalized(effectiveFreshness.state);
  const derivation = normalized(receipt.derivation);
  const partial = receipt.limitations.some(isPartialEvidenceLimitation);
  const parts: string[] = [];
  let tone: ReceiptTone = 'unknown';

  if (provenance === 'unavailable') {
    parts.push('UNAVAILABLE');
    tone = 'unavailable';
  } else if (provenance === 'synthetic') {
    parts.push('SYNTHETIC');
    tone = 'synthetic';
  } else if (provenance === 'live') {
    parts.push('LIVE');
    if (freshness === 'fresh') {
      parts.push('FRESH');
      tone = 'fresh';
    } else if (freshness === 'stale') {
      parts.push('STALE');
      tone = 'stale';
    } else if (freshness === 'clock-skew') {
      parts.push('CLOCK SKEW');
      tone = 'stale';
    } else {
      parts.push('UNKNOWN');
      tone = 'unknown';
    }
  } else {
    parts.push('UNKNOWN');
  }

  if (partial) {
    parts.push('PARTIAL');
    if (tone === 'fresh') tone = 'partial';
  }
  if (derivation === 'derived') parts.push('DERIVED');

  const source = sourceLabel(receipt);
  const ageText = formatReceiptDuration(effectiveFreshness.ageMs);
  const label = parts.join(' / ');
  return {
    label,
    source,
    ageText,
    tone,
    title: `${source} · ${label} · source age ${ageText}`,
  };
}

function methodologyLabel(receipt: DataReceipt): string {
  if (!receipt.methodology) return UNKNOWN;
  const id = present(receipt.methodology.id);
  const version = present(receipt.methodology.version);
  return `${id} @ ${version}`;
}

function unitsLabel(units: Record<string, string>): string {
  const entries = Object.entries(units).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return UNKNOWN;
  return entries.map(([field, unit]) => `${field}: ${unit}`).join(' · ');
}

/** Fixed allowlist of inspectable fields. Extra/raw receipt properties are not rendered. */
export function receiptDetailRows(
  receipt: DataReceipt,
  evaluatedAtMs: number = Date.now(),
): ReceiptDetailRow[] {
  const effectiveFreshness = effectiveReceiptFreshness(receipt, evaluatedAtMs);
  const freshnessState = normalized(effectiveFreshness.state);
  const cacheStatus = normalized(receipt.cache?.status);
  return [
    { label: 'Schema', value: present(receipt.schemaVersion), mono: true },
    { label: 'Provider', value: present(receipt.providerId) },
    { label: 'Provider version', value: present(receipt.providerVersion), mono: true },
    { label: 'Source', value: present(receipt.source) },
    { label: 'Venue', value: present(receipt.venue) },
    { label: 'Dataset family', value: present(receipt.datasetFamily), mono: true },
    { label: 'Instrument', value: present(receipt.instrument), mono: true },
    { label: 'Coverage', value: present(receipt.coverage) },
    { label: 'Source as-of', value: formatReceiptTime(receipt.sourceAsOf) },
    { label: 'Observed at', value: formatReceiptTime(receipt.observedAt) },
    { label: 'Freshness', value: freshnessState.toUpperCase() },
    { label: 'Source age', value: formatReceiptDuration(effectiveFreshness.ageMs) },
    { label: 'Expected cadence', value: formatReceiptDuration(receipt.expectedCadenceMs) },
    { label: 'Maximum age', value: formatReceiptDuration(receipt.maxAgeMs) },
    { label: 'Derivation', value: normalized(receipt.derivation).toUpperCase() },
    { label: 'Methodology', value: methodologyLabel(receipt) },
    { label: 'Formula', value: present(receipt.methodology?.formula) },
    { label: 'Cache status', value: cacheStatus.toUpperCase() },
    { label: 'Cache age', value: formatReceiptDuration(receipt.cache?.ageMs) },
    { label: 'Units', value: unitsLabel(receipt.units ?? {}) },
    { label: 'Receipt ID', value: present(receipt.receiptId), mono: true },
    { label: 'Trace ID', value: present(receipt.traceId), mono: true },
    { label: 'Note', value: present(receipt.note) },
  ];
}

export function receiptInputIds(receipt: DataReceipt): string[] {
  return receipt.inputReceiptIds.filter((id) => id.trim().length > 0);
}

export function receiptLimitations(receipt: DataReceipt): string[] {
  return receipt.limitations.filter((limitation) => limitation.trim().length > 0);
}
