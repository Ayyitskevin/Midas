/**
 * Versioned, dependency-free data-trust contracts shared by the server, web
 * client, and static demo. Receipts describe evidence; they never contain
 * credentials, raw upstream errors, or machine-local paths.
 */

import type { DataProvenance } from './provenance';
import { provenanceNoteConsistent } from './provenance';

export const DATA_RECEIPT_SCHEMA_VERSION = '1.0' as const;
export const DATA_STATUS_SCHEMA_VERSION = '1.0' as const;
export const PROVIDER_CAPABILITY_SCHEMA_VERSION = '1.0' as const;

/** Dataset families covered by the v1 trust-plane structural guard. */
export const TRUST_DATASET_FAMILIES = [
  'quote',
  'history',
  'funding',
  'funding-history',
  'open-interest',
  'open-interest-history',
  'open-interest-delta',
  'derivatives',
  'venue-derivatives',
  'liquidations',
  'venue-quotes',
  'venue-arbitrage',
  'options',
  'balances',
  'account-orders',
  'account-positions',
  'account-fills',
] as const;

export type TrustDatasetFamily = (typeof TRUST_DATASET_FAMILIES)[number];
export type DataDerivation = 'observed' | 'derived';
export type DataFreshnessState = 'fresh' | 'stale' | 'unknown' | 'clock-skew';
export type DataCacheStatus = 'miss' | 'hit' | 'bypass' | 'unknown';

/** Machine-readable prefix for result-specific incomplete evidence (not static provider caveats). */
export const PARTIAL_EVIDENCE_LIMITATION_PREFIX = 'Partial evidence:' as const;

export function partialEvidenceLimitation(detail: string): string {
  return `${PARTIAL_EVIDENCE_LIMITATION_PREFIX} ${detail.trim()}`;
}

export function isPartialEvidenceLimitation(value: string): boolean {
  return value.startsWith(PARTIAL_EVIDENCE_LIMITATION_PREFIX);
}

/** Conservative source-mode reduction for derived evidence. */
export function conservativeDataProvenance(values: readonly DataProvenance[]): DataProvenance {
  if (values.includes('unavailable')) return 'unavailable';
  if (values.includes('synthetic')) return 'synthetic';
  return 'live';
}

export interface DataReceiptFreshness {
  state: DataFreshnessState;
  /** Age of the source observation at evaluation time, in milliseconds. */
  ageMs: number | null;
}

export interface DataReceiptCache {
  status: DataCacheStatus;
  /** Age of the cached value when served, in milliseconds. */
  ageMs: number | null;
}

export interface DataMethodology {
  id: string;
  version: string;
  /** Human-readable formula; null for observed/provider-native values. */
  formula: string | null;
}

/**
 * Evidence carried with one observed or derived payload. All timestamps are
 * RFC3339 UTC strings. Unknown facts stay null and are explained in
 * `limitations`; they are never inferred from receipt creation time.
 */
export interface DataReceipt {
  schemaVersion: typeof DATA_RECEIPT_SCHEMA_VERSION;
  receiptId: string;
  providerId: string;
  providerVersion: string;
  source: string;
  venue: string | null;
  datasetFamily: TrustDatasetFamily;
  instrument: string | null;
  coverage: string | null;
  provenance: DataProvenance;
  derivation: DataDerivation;
  /** Upstream/source timestamp, not the time Midas happened to receive it. */
  sourceAsOf: string | null;
  /** Time Midas observed/assembled the evidence. */
  observedAt: string;
  expectedCadenceMs: number | null;
  maxAgeMs: number | null;
  freshness: DataReceiptFreshness;
  cache: DataReceiptCache;
  units: Record<string, string>;
  methodology: DataMethodology | null;
  inputReceiptIds: string[];
  limitations: string[];
  traceId: string | null;
  note: string | null;
}

export type DataTimestampInput = string | number | Date;

export interface DataReceiptInput {
  providerId: string;
  providerVersion: string;
  source: string;
  venue?: string | null;
  datasetFamily: TrustDatasetFamily;
  instrument?: string | null;
  coverage?: string | null;
  provenance: DataProvenance;
  derivation?: DataDerivation;
  sourceAsOf?: DataTimestampInput | null;
  observedAt?: DataTimestampInput;
  expectedCadenceMs?: number | null;
  maxAgeMs?: number | null;
  cache?: Partial<DataReceiptCache>;
  units?: Readonly<Record<string, string>>;
  methodology?: DataMethodology | null;
  inputReceiptIds?: readonly string[];
  limitations?: readonly string[];
  traceId?: string | null;
  note?: string | null;
}

export interface DerivedDataReceiptInput
  extends Omit<DataReceiptInput, 'derivation' | 'inputReceiptIds'> {
  inputReceipts: readonly DataReceipt[];
}

export interface ReceiptTransportPatch {
  traceId?: string | null;
  cache?: Partial<DataReceiptCache>;
}

/** Convert a supported timestamp input to canonical RFC3339 UTC. */
export function toUtcTimestamp(value: DataTimestampInput): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid data-receipt timestamp');
  return date.toISOString();
}

/** Freshness is independent from provenance: live data can be stale or unknown. */
export function computeReceiptFreshness(
  sourceAsOf: string | null,
  maxAgeMs: number | null,
  nowMs: number = Date.now(),
): DataReceiptFreshness {
  if (sourceAsOf == null) return { state: 'unknown', ageMs: null };
  const sourceMs = Date.parse(sourceAsOf);
  if (!Number.isFinite(sourceMs)) return { state: 'unknown', ageMs: null };
  const ageMs = nowMs - sourceMs;
  // A future source timestamp is not reassuringly age-zero data. Preserve the
  // negative offset so the inspector can show how far ahead the source clock is.
  if (ageMs < 0) return { state: 'clock-skew', ageMs };
  if (maxAgeMs == null || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    return { state: 'unknown', ageMs };
  }
  return { state: ageMs <= maxAgeMs ? 'fresh' : 'stale', ageMs };
}

function worstFreshness(values: readonly DataReceiptFreshness[]): DataReceiptFreshness | null {
  const states = values.map((value) => value.state);
  const state: DataFreshnessState | null = states.includes('clock-skew')
    ? 'clock-skew'
    : states.includes('stale')
      ? 'stale'
      : states.includes('unknown')
        ? 'unknown'
        : states.includes('fresh')
          ? 'fresh'
          : null;
  if (state === null) return null;
  const ages = values
    .filter((value) => value.state === state)
    .map((value) => value.ageMs)
    .filter((value): value is number => value !== null);
  return {
    state,
    ageMs: ages.length === 0 ? null : state === 'clock-skew' ? Math.min(...ages) : Math.max(...ages),
  };
}

/** Deterministic JSON serialization with recursively sorted object keys. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot serialize a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort()) {
      const child = object[key];
      if (child === undefined) continue;
      out[key] = canonicalize(child);
    }
    return out;
  }
  throw new Error(`Cannot serialize data-receipt value of type ${typeof value}`);
}

/**
 * Small deterministic 128-bit identifier. This is an identity checksum, not a
 * security primitive; authenticity is not claimed by a DataReceipt.
 */
function deterministicReceiptId(value: unknown): string {
  const text = stableStringify(value);
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const parts = seeds.map((seed) => {
    let hash = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  });
  return `dr_${parts.join('')}`;
}

function receiptIdentity(value: DataReceipt | Omit<DataReceipt, 'receiptId'>): unknown {
  const {
    receiptId: _receiptId,
    observedAt,
    cache: _cache,
    freshness: _freshness,
    traceId: _traceId,
    ...identity
  } = value as DataReceipt;
  // A source timestamp alone cannot distinguish changing in-progress bars or
  // tick payloads that retain the same upstream time. observedAt is therefore
  // always part of observation identity. Cache transport retains observedAt,
  // so serving the same accepted evidence still retains its receipt ID.
  return { ...identity, observedAt };
}

function boundedMs(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function cleanStrings(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

/** Build and validate one deterministic receipt. */
export function createDataReceipt(input: DataReceiptInput, nowMs: number = Date.now()): DataReceipt {
  for (const [name, value] of [
    ['expectedCadenceMs', input.expectedCadenceMs],
    ['maxAgeMs', input.maxAgeMs],
    ['cache.ageMs', input.cache?.ageMs],
  ] as const) {
    if (value !== undefined && value !== null && !isNonNegativeFinite(value)) {
      throw new Error(`${name} must be non-negative or null`);
    }
  }
  const observedAt = toUtcTimestamp(input.observedAt ?? nowMs);
  const sourceAsOf = input.sourceAsOf == null ? null : toUtcTimestamp(input.sourceAsOf);
  const maxAgeMs = boundedMs(input.maxAgeMs);
  const limitations = cleanStrings([
    ...(input.limitations ?? []),
    ...(sourceAsOf === null ? ['Upstream source timestamp is unavailable.'] : []),
  ]);
  const receiptWithoutId: Omit<DataReceipt, 'receiptId'> = {
    schemaVersion: DATA_RECEIPT_SCHEMA_VERSION,
    providerId: input.providerId.trim(),
    providerVersion: input.providerVersion.trim(),
    source: input.source.trim(),
    venue: input.venue?.trim() || null,
    datasetFamily: input.datasetFamily,
    instrument: input.instrument?.trim() || null,
    coverage: input.coverage?.trim() || null,
    provenance: input.provenance,
    derivation: input.derivation ?? 'observed',
    sourceAsOf,
    observedAt,
    expectedCadenceMs: boundedMs(input.expectedCadenceMs),
    maxAgeMs,
    freshness: computeReceiptFreshness(sourceAsOf, maxAgeMs, nowMs),
    cache: {
      status: input.cache?.status ?? 'bypass',
      ageMs: boundedMs(input.cache?.ageMs),
    },
    units: Object.fromEntries(
      Object.entries(input.units ?? {})
        .map(([key, value]) => [key.trim(), value.trim()] as const)
        .filter(([key, value]) => key.length > 0 && value.length > 0)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
    methodology: input.methodology
      ? {
          id: input.methodology.id.trim(),
          version: input.methodology.version.trim(),
          formula: input.methodology.formula?.trim() || null,
        }
      : null,
    inputReceiptIds: cleanStrings(input.inputReceiptIds),
    limitations,
    traceId: input.traceId?.trim() || null,
    note: input.note?.trim() || null,
  };
  // Cache, computed freshness and trace facts describe transport and never
  // change evidence identity. observedAt does: it distinguishes independently
  // accepted observations even when an upstream reuses its source timestamp.
  const receipt: DataReceipt = {
    ...receiptWithoutId,
    receiptId: deterministicReceiptId(receiptIdentity(receiptWithoutId)),
  };
  const checked = validateDataReceipt(receipt);
  if (!checked.ok) throw new Error(`Invalid data receipt: ${checked.errors.join('; ')}`);
  return receipt;
}

/** Build a derived receipt, inheriting conservative lineage/freshness facts. */
export function deriveDataReceipt(
  input: DerivedDataReceiptInput,
  nowMs: number = Date.now(),
): DataReceipt {
  for (const [index, receipt] of input.inputReceipts.entries()) {
    const checked = validateDataReceipt(receipt);
    if (!checked.ok) {
      throw new Error(`Invalid input data receipt at index ${index}: ${checked.errors.join('; ')}`);
    }
  }
  if (input.maxAgeMs !== undefined && input.maxAgeMs !== null && !isNonNegativeFinite(input.maxAgeMs)) {
    throw new Error('Derived maxAgeMs must be non-negative or null');
  }
  const sourceTimes = input.inputReceipts
    .map((receipt) => receipt.sourceAsOf)
    .filter((value): value is string => value != null)
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  const inheritedMaxAges = input.inputReceipts
    .map((receipt) => receipt.maxAgeMs)
    .filter((value): value is number => value != null);
  const inheritedLimitations = input.inputReceipts.flatMap((receipt) => receipt.limitations);
  const provenance = conservativeDataProvenance([
    input.provenance,
    ...input.inputReceipts.map((receipt) => receipt.provenance),
  ]);
  const note = provenance === 'live'
    ? null
    : input.note?.trim() || (
        provenance === 'synthetic'
          ? 'Derived from synthetic input evidence.'
          : 'One or more required input observations are unavailable.'
      );
  const oldestInputSourceMs = sourceTimes.length > 0 ? Math.min(...sourceTimes) : null;
  const resolvedSourceAsOf = input.sourceAsOf === null
    ? null
    : input.sourceAsOf === undefined
      ? oldestInputSourceMs
      : oldestInputSourceMs === null
        ? input.sourceAsOf
        : Math.min(Date.parse(toUtcTimestamp(input.sourceAsOf)), oldestInputSourceMs);
  // Unavailable means there is no usable observation to timestamp. A known
  // time from another input must not make the unavailable derivation look fresh.
  const sourceAsOf = provenance === 'unavailable' ? null : resolvedSourceAsOf;
  const inheritedMaxAgeMs = inheritedMaxAges.length > 0 ? Math.min(...inheritedMaxAges) : null;
  const maxAgeMs = input.maxAgeMs === null
    ? null
    : input.maxAgeMs === undefined
      ? inheritedMaxAgeMs
      : inheritedMaxAgeMs === null
        ? input.maxAgeMs
        : Math.min(input.maxAgeMs, inheritedMaxAgeMs);
  const receipt = createDataReceipt(
    {
      ...input,
      provenance,
      derivation: 'derived',
      sourceAsOf,
      maxAgeMs,
      inputReceiptIds: input.inputReceipts.map((receipt) => receipt.receiptId),
      limitations: [...inheritedLimitations, ...(input.limitations ?? [])],
      note,
    },
    nowMs,
  );
  // A derivation can be no fresher than any required input. In particular, a
  // missing timestamp must not disappear merely because another input is fresh.
  const inherited = worstFreshness(input.inputReceipts.map((candidate) => candidate.freshness));
  if (provenance === 'unavailable' || inherited == null || inherited.state === 'fresh') return receipt;
  const conservativeReceipt = {
    ...receipt,
    freshness: inherited,
  };
  const checked = validateDataReceipt(conservativeReceipt);
  if (!checked.ok) throw new Error(`Invalid derived data receipt: ${checked.errors.join('; ')}`);
  return conservativeReceipt;
}

/** Clone request/cache facts onto a receipt without changing source identity. */
export function withReceiptTransport(
  receipt: DataReceipt,
  patch: ReceiptTransportPatch,
  nowMs: number = Date.now(),
): DataReceipt {
  if (patch.cache?.ageMs !== undefined && patch.cache.ageMs !== null && !isNonNegativeFinite(patch.cache.ageMs)) {
    throw new Error('cache.ageMs must be non-negative or null');
  }
  const computedFreshness = computeReceiptFreshness(receipt.sourceAsOf, receipt.maxAgeMs, nowMs);
  const updated: DataReceipt = {
    ...receipt,
    freshness:
      receipt.derivation === 'derived'
        ? worstFreshness([receipt.freshness, computedFreshness]) ?? computedFreshness
        : computedFreshness,
    cache: {
      status: patch.cache?.status ?? receipt.cache.status,
      ageMs: patch.cache?.ageMs === undefined ? receipt.cache.ageMs : boundedMs(patch.cache.ageMs),
    },
    traceId: patch.traceId === undefined ? receipt.traceId : patch.traceId?.trim() || null,
  };
  const checked = validateDataReceipt(updated);
  if (!checked.ok) throw new Error(`Invalid data receipt: ${checked.errors.join('; ')}`);
  return updated;
}

/** Attach a receipt without mutating a provider/cache-owned payload. */
export function withDataReceipt<T extends object>(payload: T, receipt: DataReceipt): T & { receipt: DataReceipt } {
  return { ...payload, receipt };
}

/**
 * Add bounded evidence caveats while preserving transport facts. Limitations
 * are part of evidence identity, so the receipt ID is recomputed; source time,
 * observation time, freshness, cache and trace facts are not rewritten.
 */
export function withReceiptLimitations(
  receipt: DataReceipt,
  additions: readonly string[],
): DataReceipt {
  const updated: DataReceipt = {
    ...receipt,
    receiptId: '',
    limitations: cleanStrings([...receipt.limitations, ...additions]),
  };
  updated.receiptId = deterministicReceiptId(receiptIdentity(updated));
  const checked = validateDataReceipt(updated);
  if (!checked.ok) throw new Error(`Invalid data receipt: ${checked.errors.join('; ')}`);
  return updated;
}

export type DataReceiptValidation =
  | { ok: true; value: DataReceipt }
  | { ok: false; errors: string[] };

const RECEIPT_KEYS = new Set<keyof DataReceipt>([
  'schemaVersion',
  'receiptId',
  'providerId',
  'providerVersion',
  'source',
  'venue',
  'datasetFamily',
  'instrument',
  'coverage',
  'provenance',
  'derivation',
  'sourceAsOf',
  'observedAt',
  'expectedCadenceMs',
  'maxAgeMs',
  'freshness',
  'cache',
  'units',
  'methodology',
  'inputReceiptIds',
  'limitations',
  'traceId',
  'note',
]);

// A bounded absolute POSIX path (at least two segments). Requiring a boundary
// before the leading slash avoids matching URL paths and arithmetic formulae.
const LOCAL_POSIX_PATH =
  /(?:^|[\s"'(\[{=,:])\/(?:[a-z0-9._-]+(?: [a-z0-9._-]+)*\/)+[a-z0-9._-]+/i;

const SECRET_OR_PATH = [
  /\b[a-z][a-z0-9+.-]*:\/\/[^\/\s@]+@/i,
  /bearer\s+[a-z0-9._~+\/-]{8,}/i,
  /\bbasic\s+[a-z0-9+/=]{8,}/i,
  /\b(?:proxy-)?authorization\b\\?"?\s*[:=]/i,
  /\b(?:set-cookie|cookie)\b\\?"?\s*[:=]/i,
  /(?:api[_-]?key|secret|token|password|signature)\s*[=:]\s*[^\s,;]+/i,
  /"(?:api[_-]?key|secret|token|password|signature)"\s*:\s*"[^"]+"/i,
  /\\"(?:api[_-]?key|secret|token|password|signature)\\"\s*:\s*\\"[^"\\]+\\"/i,
  /\bgh[pousr]_[a-z0-9]{20,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-(?:proj-)?[a-z0-9_-]{16,}\b/i,
  /\b[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  LOCAL_POSIX_PATH,
  /(?:file:\/\/|[a-z]:\\)/i,
];

/** Shared detector used by receipt validation and provider conformance checks. */
export function containsSensitiveReceiptText(text: string): boolean {
  return SECRET_OR_PATH.some((pattern) => pattern.test(text));
}

/**
 * Redact secret-like fragments and machine-local paths before a bounded string
 * is admitted to receipt limitations/notes. This is deliberately conservative:
 * callers should still prefer fixed, allowlisted copy over raw upstream text.
 */
export function sanitizeReceiptText(value: unknown, maxLength = 500): string {
  const raw = typeof value === 'string' ? value : value instanceof Error ? value.name : String(value ?? '');
  return raw
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\/\s@]+@/gi, '$1[REDACTED]@')
    .replace(/("(?:proxy-)?authorization"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"')
    .replace(/(\\"(?:proxy-)?authorization\\"\s*:\s*)\\"[^"\\]*\\"/gi, '$1\\"[REDACTED]\\"')
    .replace(/("(?:set-cookie|cookie)"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"')
    .replace(/(\\"(?:set-cookie|cookie)\\"\s*:\s*)\\"[^"\\]*\\"/gi, '$1\\"[REDACTED]\\"')
    .replace(/(\b(?:proxy-)?authorization\b\s*[:=]\s*)[^\r\n,;]+/gi, '$1[REDACTED]')
    .replace(/(\b(?:set-cookie|cookie)\b\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/bearer\s+[a-z0-9._~+\/-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/\bbasic\s+[a-z0-9+/=]{8,}/gi, 'Basic [REDACTED]')
    .replace(/((?:api[_-]?key|secret|token|password|signature)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/("(?:api[_-]?key|secret|token|password|signature)"\s*:\s*)"[^"]+"/gi, '$1"[REDACTED]"')
    .replace(/(\\"(?:api[_-]?key|secret|token|password|signature)\\"\s*:\s*)\\"[^"\\]+\\"/gi, '$1\\"[REDACTED]\\"')
    .replace(/\bgh[pousr]_[a-z0-9]{20,}\b/gi, '[REDACTED]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]')
    .replace(/\bsk-(?:proj-)?[a-z0-9_-]{16,}\b/gi, '[REDACTED]')
    .replace(/\b[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/gi, '[REDACTED]')
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi, '[REDACTED]')
    .replace(
      /(^|[\s"'(\[{=,:])\/(?:[a-z0-9._-]+(?: [a-z0-9._-]+)*\/)+[a-z0-9._-]+/gi,
      '$1[LOCAL_PATH]',
    )
    .replace(/file:\/\/[^\s,;]*/gi, '[LOCAL_PATH]')
    .replace(/[a-z]:\\[^\s,;]*/gi, '[LOCAL_PATH]')
    .trim()
    .slice(0, Math.max(0, Math.floor(maxLength)));
}

/** Runtime validation used at provider/API boundaries and by conformance tests. */
export function validateDataReceipt(value: unknown): DataReceiptValidation {
  const errors: string[] = [];
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['receipt must be an object'] };
  }
  const receipt = value as Record<string, unknown>;
  for (const key of RECEIPT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(receipt, key)) errors.push(`missing field: ${key}`);
  }
  for (const key of Object.keys(receipt)) {
    if (!RECEIPT_KEYS.has(key as keyof DataReceipt)) errors.push(`unknown field: ${key}`);
  }
  const requiredStrings = ['receiptId', 'providerId', 'providerVersion', 'source', 'datasetFamily', 'observedAt'] as const;
  for (const key of requiredStrings) {
    if (typeof receipt[key] !== 'string' || (receipt[key] as string).trim().length === 0) {
      errors.push(`${key} must be a non-empty string`);
    }
  }
  if (receipt.schemaVersion !== DATA_RECEIPT_SCHEMA_VERSION) errors.push('unsupported schemaVersion');
  if (!(TRUST_DATASET_FAMILIES as readonly unknown[]).includes(receipt.datasetFamily)) errors.push('unknown datasetFamily');
  if (!['live', 'synthetic', 'unavailable'].includes(String(receipt.provenance))) errors.push('invalid provenance');
  if (!['observed', 'derived'].includes(String(receipt.derivation))) errors.push('invalid derivation');
  if (
    receipt.sourceAsOf !== null &&
    (typeof receipt.sourceAsOf !== 'string' || !isCanonicalUtc(receipt.sourceAsOf))
  ) {
    errors.push('sourceAsOf must be a canonical UTC timestamp or null');
  }
  if (typeof receipt.observedAt !== 'string' || !isCanonicalUtc(receipt.observedAt)) {
    errors.push('observedAt must be a canonical UTC timestamp');
  }
  for (const key of ['venue', 'instrument', 'coverage', 'traceId', 'note'] as const) {
    if (receipt[key] !== null && typeof receipt[key] !== 'string') errors.push(`${key} must be a string or null`);
  }
  for (const key of ['expectedCadenceMs', 'maxAgeMs'] as const) {
    if (receipt[key] !== null && !isNonNegativeFinite(receipt[key])) errors.push(`${key} must be non-negative or null`);
  }
  const freshness = receipt.freshness as Record<string, unknown> | null;
  if (!freshness || !hasExactKeys(freshness, ['state', 'ageMs'])) errors.push('invalid freshness fields');
  if (!freshness || !['fresh', 'stale', 'unknown', 'clock-skew'].includes(String(freshness.state))) errors.push('invalid freshness.state');
  if (
    freshness?.ageMs != null &&
    !(typeof freshness.ageMs === 'number' && Number.isFinite(freshness.ageMs))
  ) {
    errors.push('freshness.ageMs must be finite or null');
  }
  if (freshness?.state === 'clock-skew' && !(typeof freshness.ageMs === 'number' && freshness.ageMs < 0)) {
    errors.push('clock-skew freshness requires a negative ageMs');
  }
  if (freshness?.state !== 'clock-skew' && typeof freshness?.ageMs === 'number' && freshness.ageMs < 0) {
    errors.push('negative freshness.ageMs requires clock-skew state');
  }
  if (freshness?.state === 'fresh' || freshness?.state === 'stale') {
    if (receipt.sourceAsOf === null) errors.push(`${freshness.state} freshness requires sourceAsOf`);
    if (!isNonNegativeFinite(receipt.maxAgeMs)) errors.push(`${freshness.state} freshness requires maxAgeMs`);
    if (!isNonNegativeFinite(freshness.ageMs)) {
      errors.push(`${freshness.state} freshness requires a non-negative ageMs`);
    } else if (isNonNegativeFinite(receipt.maxAgeMs)) {
      if (freshness.state === 'fresh' && freshness.ageMs > receipt.maxAgeMs) {
        errors.push('fresh freshness ageMs exceeds maxAgeMs');
      }
      if (freshness.state === 'stale' && freshness.ageMs <= receipt.maxAgeMs) {
        errors.push('stale freshness ageMs must exceed maxAgeMs');
      }
    }
  }
  if (freshness?.state === 'unknown') {
    if (typeof freshness.ageMs === 'number' && freshness.ageMs < 0) {
      errors.push('unknown freshness cannot have a negative ageMs');
    }
    if (receipt.derivation === 'observed') {
      if (receipt.sourceAsOf === null && freshness.ageMs !== null) {
        errors.push('observed unknown source time requires null freshness.ageMs');
      }
      if (receipt.sourceAsOf !== null && receipt.maxAgeMs !== null) {
        errors.push('observed data with sourceAsOf and maxAgeMs cannot have unknown freshness');
      }
      if (receipt.sourceAsOf !== null && !isNonNegativeFinite(freshness.ageMs)) {
        errors.push('observed unknown freshness with sourceAsOf requires a non-negative ageMs');
      }
    }
  }
  if (freshness?.state === 'clock-skew' && receipt.derivation === 'observed' && receipt.sourceAsOf === null) {
    errors.push('observed clock-skew freshness requires sourceAsOf');
  }
  if (receipt.provenance === 'unavailable') {
    if (receipt.sourceAsOf !== null) errors.push('unavailable provenance requires null sourceAsOf');
    if (freshness?.state !== 'unknown' || freshness.ageMs !== null) {
      errors.push('unavailable provenance requires unknown freshness with null ageMs');
    }
  }
  const cache = receipt.cache as Record<string, unknown> | null;
  if (!cache || !hasExactKeys(cache, ['status', 'ageMs'])) errors.push('invalid cache fields');
  if (!cache || !['miss', 'hit', 'bypass', 'unknown'].includes(String(cache.status))) errors.push('invalid cache.status');
  if (cache?.ageMs != null && !isNonNegativeFinite(cache.ageMs)) errors.push('cache.ageMs must be non-negative or null');
  if (cache?.status === 'hit' && !isNonNegativeFinite(cache.ageMs)) {
    errors.push('cache hit requires a non-negative ageMs');
  }
  if ((cache?.status === 'bypass' || cache?.status === 'unknown') && cache.ageMs !== null) {
    errors.push(`${cache.status} cache status requires null ageMs`);
  }
  if (cache?.status === 'miss' && cache.ageMs !== null && cache.ageMs !== 0) {
    errors.push('cache miss ageMs must be zero or null');
  }
  if (!isStringRecord(receipt.units)) errors.push('units must be a string record');
  if (!isMethodology(receipt.methodology)) errors.push('invalid methodology');
  for (const key of ['inputReceiptIds', 'limitations'] as const) {
    if (
      !Array.isArray(receipt[key]) ||
      !(receipt[key] as unknown[]).every((item) => typeof item === 'string' && item.trim().length > 0)
    ) {
      errors.push(`${key} must be an array of non-empty strings`);
    }
  }
  if (
    receipt.sourceAsOf === null &&
    (!Array.isArray(receipt.limitations) || !receipt.limitations.includes('Upstream source timestamp is unavailable.'))
  ) {
    errors.push('unknown sourceAsOf requires an explicit limitation');
  }
  if (
    receipt.derivation === 'derived' &&
    (!isMethodology(receipt.methodology) || receipt.methodology === null)
  ) {
    errors.push('derived receipts require methodology');
  }
  if (receipt.derivation === 'derived' && Array.isArray(receipt.inputReceiptIds) && receipt.inputReceiptIds.length === 0) {
    errors.push('derived receipts require at least one inputReceiptId');
  }
  if (receipt.derivation === 'observed' && Array.isArray(receipt.inputReceiptIds) && receipt.inputReceiptIds.length > 0) {
    errors.push('observed receipts cannot carry inputReceiptIds');
  }
  if (
    receipt.derivation === 'derived' &&
    Array.isArray(receipt.inputReceiptIds) &&
    new Set(receipt.inputReceiptIds).size !== receipt.inputReceiptIds.length
  ) {
    errors.push('derived inputReceiptIds must be unique');
  }
  if (
    Array.isArray(receipt.inputReceiptIds) &&
    receipt.inputReceiptIds.some((id) => typeof id === 'string' && !/^dr_[0-9a-f]{32}$/.test(id))
  ) {
    errors.push('inputReceiptIds must contain canonical receipt IDs');
  }
  if (
    typeof receipt.provenance === 'string' &&
    ['live', 'synthetic', 'unavailable'].includes(receipt.provenance) &&
    !provenanceNoteConsistent(receipt.provenance as DataProvenance, receipt.note as string | null | undefined)
  ) {
    errors.push('note is inconsistent with provenance');
  }
  let serialized = '';
  try {
    serialized = stableStringify(value);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'receipt is not serializable');
  }
  if (serialized.length > 32_000) errors.push('receipt exceeds 32 KiB');
  if (containsSensitiveReceiptText(serialized)) errors.push('receipt contains secret-like or machine-local data');
  try {
    if (typeof receipt.receiptId === 'string') {
      const expectedId = deterministicReceiptId(receiptIdentity(receipt as unknown as DataReceipt));
      if (receipt.receiptId !== expectedId) errors.push('receiptId does not match receipt source identity');
    }
  } catch {
    // Serialization errors are already reported above; do not add duplicate noise.
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: value as DataReceipt };
}

function isCanonicalUtc(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value).every(([key, entry]) => key.trim().length > 0 && typeof entry === 'string' && entry.trim().length > 0)
  );
}

function isMethodology(value: unknown): value is DataMethodology | null {
  if (value === null) return true;
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const m = value as Record<string, unknown>;
  return (
    hasExactKeys(m, ['id', 'version', 'formula']) &&
    typeof m.id === 'string' &&
    m.id.trim().length > 0 &&
    typeof m.version === 'string' &&
    m.version.trim().length > 0 &&
    (m.formula === null || typeof m.formula === 'string')
  );
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return hasOnlyKeys(value, keys) && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export type ProviderCapabilitySupport = 'supported' | 'unsupported' | 'conditional';
export type ProviderCapabilityAuth = 'public' | 'credentials-required' | 'none';

export interface ProviderCapability {
  datasetFamily: TrustDatasetFamily;
  /** DataProvider method responsible for this family. */
  method: string;
  support: ProviderCapabilitySupport;
  auth: ProviderCapabilityAuth;
  mode: DataProvenance;
  source: string;
  venue: string | null;
  coverage: string | null;
  expectedCadenceMs: number | null;
  maxAgeMs: number | null;
  cacheTtlMs: number | null;
  methodology: DataMethodology | null;
  caveats: string[];
}

/** Runtime-inspectable, exhaustive capability manifest for one provider. */
export interface ProviderCapabilityManifest {
  schemaVersion: typeof PROVIDER_CAPABILITY_SCHEMA_VERSION;
  providerId: string;
  providerVersion: string;
  source: string;
  capabilities: Record<TrustDatasetFamily, ProviderCapability>;
}

export type DataHealthState = 'healthy' | 'degraded' | 'unavailable' | 'unknown';
export type DataHealthErrorCategory =
  | 'unsupported'
  | 'not-configured'
  | 'upstream-unavailable'
  | 'malformed-upstream'
  | 'partial'
  | 'stale'
  | 'unknown';

/** Sanitized per-family state; never contains values, credentials, or raw errors. */
export interface DataFamilyHealth {
  datasetFamily: TrustDatasetFamily;
  state: DataHealthState;
  errorCategory: DataHealthErrorCategory | null;
  /** Provenance of the most recent accepted payload, or null before any read. */
  provenance: DataProvenance | null;
  /** Provider-declared runtime source mode for this family. */
  sourceMode: DataProvenance;
  providerId: string;
  source: string;
  lastReceiptId: string | null;
  lastSuccessAt: string | null;
  sourceAsOf: string | null;
  freshness: DataReceiptFreshness;
  cache: DataReceiptCache;
  limitations: string[];
  note: string | null;
}

export interface DataStatusResponse {
  schemaVersion: typeof DATA_STATUS_SCHEMA_VERSION;
  generatedAt: string;
  providers: ProviderCapabilityManifest[];
  datasets: Partial<Record<TrustDatasetFamily, DataFamilyHealth>>;
}
