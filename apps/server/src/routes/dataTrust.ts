import {
  createDataReceipt,
  isPartialEvidenceLimitation,
  validateDataReceipt,
  withDataReceipt,
  withReceiptTransport,
} from '@midas/shared';
import type {
  DataCacheStatus,
  DataHealthErrorCategory,
  DataMethodology,
  DataProvenance,
  DataReceipt,
  TrustDatasetFamily,
} from '@midas/shared';
import { ProviderError, type DataProvider } from '../providers';
import { capabilityUnavailableCategory } from '../dataStatus';
import type { DataStatusTracker } from '../dataStatus';
import {
  capabilityFor,
  providerDerivedReceipt,
  providerUnavailableReceipt,
} from '../providers/receipts';

export interface ReceiptCarrier {
  receipt?: DataReceipt;
}

export interface ReceiptCacheFacts {
  status: DataCacheStatus;
  ageMs: number | null;
}

export function providerErrorCategory(error: unknown): DataHealthErrorCategory {
  if (!(error instanceof ProviderError)) return 'unknown';
  if (error.statusCode === 501) return 'unsupported';
  if (error.statusCode === 503) return 'not-configured';
  return error.dataHealthCategory;
}

export async function trackProviderCall<T>(
  provider: DataProvider,
  family: TrustDatasetFamily,
  tracker: DataStatusTracker,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    tracker.recordError(provider, family, providerErrorCategory(error));
    throw error;
  }
}

function unavailableCategory(
  provider: DataProvider,
  family: TrustDatasetFamily,
  receipt: DataReceipt,
): DataHealthErrorCategory | null {
  if (receipt.provenance !== 'unavailable') return null;
  const capability = capabilityFor(provider, family);
  return capabilityUnavailableCategory(
    capability,
    [receipt.note, ...receipt.limitations].filter(Boolean).join(' '),
  );
}

export function receiptHasPartialEvidence(receipt: DataReceipt): boolean {
  return receipt.limitations.some(isPartialEvidenceLimitation);
}

export interface ReceiptExpectation {
  /** Instrument requested at the route boundary, independent of provider output. */
  instrument?: string | null;
  /** Allowed requested instruments for a batch response. */
  instruments?: readonly string[];
  /** Venue requested at the route boundary, when a route selects one explicitly. */
  venue?: string | null;
  /** Requested history range, which providers must not silently substitute. */
  range?: string;
  /** Requested OI-delta window. */
  window?: string;
  /** Explicit options expiry; omitted when the request intentionally resolves `nearest`. */
  expiry?: number;
}

function canonicalInstrument(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/-/g, '/');
  const [base = '', rawQuote = ''] = normalized.split('/');
  return rawQuote ? `${base}/${rawQuote.replace(/:.*$/, '')}` : base.replace(/:.*$/, '');
}

function canonicalVenue(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function venueMatches(left: string, right: string): boolean {
  const a = canonicalVenue(left);
  const b = canonicalVenue(right);
  if (!a || !b) return false;
  return a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));
}

function exactReceiptTime(payloadTime: unknown, receiptTimeMs: number | null): boolean {
  if (payloadTime === null) return receiptTimeMs === null;
  return (
    typeof payloadTime === 'number' &&
    Number.isFinite(payloadTime) &&
    receiptTimeMs === payloadTime
  );
}

/** Bind payload time semantics to receipt time semantics family by family. */
function receiptMatchesPayloadTime(
  payload: Record<string, unknown>,
  receipt: DataReceipt,
): boolean {
  const sourceAsOfMs = receipt.sourceAsOf === null ? null : Date.parse(receipt.sourceAsOf);
  const observedAtMs = Date.parse(receipt.observedAt);
  switch (receipt.datasetFamily) {
    case 'quote':
      return exactReceiptTime(payload.asOf, sourceAsOfMs);
    case 'history': {
      if (!Array.isArray(payload.candles)) return false;
      const candleTimes = payload.candles.map((candidate) => {
        if (candidate === null || typeof candidate !== 'object') return null;
        const time = (candidate as Record<string, unknown>).time;
        return typeof time === 'number' && Number.isFinite(time) ? time * 1_000 : null;
      });
      if (candleTimes.some((time) => time === null)) return false;
      const latest = candleTimes.length === 0 ? null : Math.max(...(candleTimes as number[]));
      return exactReceiptTime(latest, sourceAsOfMs);
    }
    case 'venue-quotes':
    case 'venue-derivatives':
    case 'derivatives':
      return exactReceiptTime(payload.timestamp, sourceAsOfMs);
    case 'funding-history':
      return exactReceiptTime(payload.time, sourceAsOfMs);
    case 'options':
    case 'open-interest-delta': {
      if (payload.asOf === null) return sourceAsOfMs === null;
      return (
        typeof payload.asOf === 'number' &&
        Number.isFinite(payload.asOf) &&
        sourceAsOfMs !== null &&
        sourceAsOfMs <= payload.asOf
      );
    }
    case 'balances':
    case 'account-orders':
    case 'account-positions':
    case 'account-fills':
      return exactReceiptTime(payload.asOf, observedAtMs);
    default:
      return true;
  }
}

function receiptMatchesPayload(
  payload: Record<string, unknown>,
  receipt: DataReceipt,
  expected: ReceiptExpectation,
): boolean {
  const receiptInstrument = receipt.instrument == null ? null : canonicalInstrument(receipt.instrument);
  const expectedInstrument = expected.instrument == null ? null : canonicalInstrument(expected.instrument);
  if (
    expectedInstrument !== null &&
    (receiptInstrument == null ||
      (receipt.datasetFamily === 'options'
        ? receiptInstrument.split('/')[0] !== expectedInstrument.split('/')[0]
        : receiptInstrument !== expectedInstrument))
  ) {
    return false;
  }
  if (
    expected.instruments &&
    (receiptInstrument == null || !expected.instruments.map(canonicalInstrument).includes(receiptInstrument))
  ) {
    return false;
  }
  if (expected.venue != null && (receipt.venue == null || !venueMatches(receipt.venue, expected.venue))) return false;
  if (expected.range !== undefined && payload.range !== expected.range) return false;
  if (expected.window !== undefined && payload.window !== expected.window) return false;
  if (expected.expiry !== undefined && payload.expiry !== expected.expiry) return false;

  if (typeof payload.symbol === 'string') {
    if (receiptInstrument == null || canonicalInstrument(payload.symbol) !== receiptInstrument) return false;
  }
  if (typeof payload.underlying === 'string') {
    const payloadBase = canonicalInstrument(payload.underlying).split('/')[0];
    const receiptBase = receiptInstrument?.split('/')[0] ?? null;
    if (receiptBase == null || payloadBase !== receiptBase) return false;
  }
  if (typeof payload.exchange === 'string' && payload.exchange.trim().length > 0) {
    if (receipt.venue == null || !venueMatches(payload.exchange, receipt.venue)) return false;
  }
  if (typeof payload.provenance === 'string' && payload.provenance !== receipt.provenance) return false;
  if (
    typeof payload.source === 'string' &&
    payload.source.trim().length > 0 &&
    payload.source.trim() !== receipt.source.trim()
  ) {
    return false;
  }
  if (receipt.datasetFamily === 'account-fills' && expectedInstrument !== null) {
    if (!Array.isArray(payload.fills)) return false;
    for (const fill of payload.fills) {
      if (fill === null || typeof fill !== 'object') return false;
      const fillSymbol = (fill as Record<string, unknown>).symbol;
      if (
        typeof fillSymbol !== 'string' ||
        canonicalInstrument(fillSymbol) !== expectedInstrument
      ) {
        return false;
      }
    }
  }
  if (!receiptMatchesPayloadTime(payload, receipt)) return false;
  return true;
}

function receiptHealthCategory(
  provider: DataProvider,
  family: TrustDatasetFamily,
  receipt: DataReceipt,
): DataHealthErrorCategory | null {
  const unavailable = unavailableCategory(provider, family, receipt);
  if (unavailable) return unavailable;
  // The v1 receipt schema carries human-readable limitations rather than a
  // structured completeness flag. Recognize only explicit partial/failed/
  // omitted evidence, not every caveat, so a fresh but incomplete upstream
  // snapshot cannot be reported healthy.
  if (receiptHasPartialEvidence(receipt)) return 'partial';
  return null;
}

/**
 * Validate, transport-stamp and immutably attach a provider receipt. A route
 * that is in the adopted coverage registry fails closed on a missing/malformed
 * or mislabelled receipt instead of returning an unreceipted live value.
 */
export function attachProviderReceipt<T extends object>(
  provider: DataProvider,
  family: TrustDatasetFamily,
  payload: T & ReceiptCarrier,
  traceId: string,
  tracker: DataStatusTracker,
  cache: ReceiptCacheFacts = { status: 'bypass', ageMs: null },
  nowMs: number = Date.now(),
  expected: ReceiptExpectation = {},
): T & { receipt: DataReceipt } {
  let attached: T & { receipt: DataReceipt };
  try {
    attached = validateAndTransportProviderReceipt(provider, family, payload, traceId, cache, nowMs, expected);
  } catch (error) {
    tracker.recordError(provider, family, 'malformed-upstream');
    throw error;
  }
  tracker.recordReceipt(
    provider,
    attached.receipt,
    receiptHealthCategory(provider, family, attached.receipt),
  );
  return attached;
}

function validateAndTransportProviderReceipt<T extends object>(
  provider: DataProvider,
  family: TrustDatasetFamily,
  payload: T & ReceiptCarrier,
  traceId: string,
  cache: ReceiptCacheFacts,
  nowMs: number,
  expected: ReceiptExpectation,
): T & { receipt: DataReceipt } {
  const checked = validateDataReceipt(payload.receipt);
  const manifest = provider.capabilities;
  const capability = capabilityFor(provider, family);
  const receipt = checked.ok ? checked.value : null;
  const identityMatches =
    receipt?.providerId === manifest.providerId &&
    receipt.providerVersion === manifest.providerVersion;
  // An unavailable receipt is an honest runtime outcome for any declared
  // mode. A successful live/synthetic observation, however, must agree with
  // the manifest; otherwise a provider could silently relabel fixtures as live
  // (or vice versa) at the HTTP trust boundary.
  const modeMatches =
    receipt?.provenance === 'unavailable' || receipt?.provenance === capability.mode;
  if (
    !receipt ||
    receipt.datasetFamily !== family ||
    !identityMatches ||
    !modeMatches ||
    !receiptMatchesPayload(payload as Record<string, unknown>, receipt, expected)
  ) {
    throw new ProviderError(
      `Provider returned ${family} data without a valid receipt`,
      502,
      expected.instrument ?? undefined,
      'malformed-upstream',
    );
  }
  const transported = withReceiptTransport(receipt, { traceId, cache }, nowMs);
  return withDataReceipt(payload, transported);
}

export function attachProviderReceiptRows<T extends object>(
  provider: DataProvider,
  family: TrustDatasetFamily,
  rows: readonly (T & ReceiptCarrier)[],
  traceId: string,
  tracker: DataStatusTracker,
  cache: ReceiptCacheFacts = { status: 'bypass', ageMs: null },
  nowMs: number = Date.now(),
  expected: ReceiptExpectation = {},
): Array<T & { receipt: DataReceipt }> {
  if (rows.length === 0) {
    const capability = capabilityFor(provider, family);
    const category = capabilityUnavailableCategory(capability);
    tracker.recordError(provider, family, category);
    throw new ProviderError(
      `Provider returned no ${family} evidence`,
      capability.support === 'unsupported' ? 501 : 502,
    );
  }
  let attached: Array<T & { receipt: DataReceipt }>;
  try {
    // Validate the whole response before publishing any success observation.
    // Otherwise a malformed late row can leave status claiming that a failed
    // array request succeeded because an earlier row was already recorded.
    attached = rows.map((row) =>
      validateAndTransportProviderReceipt(provider, family, row, traceId, cache, nowMs, expected),
    );
    if (family === 'venue-quotes' || family === 'venue-derivatives') {
      const venues = attached.map((row) =>
        row.receipt.venue == null ? '' : canonicalVenue(row.receipt.venue),
      );
      if (venues.some((venue) => venue.length === 0) || new Set(venues).size !== venues.length) {
        throw new ProviderError(
          `Provider returned duplicate or missing ${family} venue evidence`,
          502,
          expected.instrument ?? undefined,
          'malformed-upstream',
        );
      }
    }
  } catch (error) {
    tracker.recordError(provider, family, 'malformed-upstream');
    throw error;
  }

  const categories = attached.map((row) => receiptHealthCategory(provider, family, row.receipt));
  const aggregatePartial = attached.some(
    (row, index) => row.receipt.provenance === 'unavailable' || categories[index] === 'partial',
  );
  // Finish on usable evidence when a mixed response contains an unavailable
  // row. This makes final family health degraded/partial in either row order,
  // instead of unavailable when the unavailable row happened to be last.
  let representativeIndex = aggregatePartial
    ? attached.findIndex((row) => row.receipt.provenance !== 'unavailable')
    : attached.length - 1;
  if (representativeIndex < 0) representativeIndex = attached.length - 1;
  for (const [index, row] of attached.entries()) {
    if (index === representativeIndex) continue;
    tracker.recordReceipt(provider, row.receipt, categories[index] ?? null);
  }
  tracker.recordReceipt(
    provider,
    attached[representativeIndex]!.receipt,
    aggregatePartial ? 'partial' : categories[representativeIndex] ?? null,
  );
  return attached;
}

export function unavailableReceipt(
  provider: DataProvider,
  input: {
    family: TrustDatasetFamily;
    instrument?: string | null;
    coverage?: string | null;
    venue?: string | null;
    limitations: readonly string[];
    note: string;
    traceId: string;
    expectedCadenceMs?: number | null;
    maxAgeMs?: number | null;
  },
  tracker: DataStatusTracker,
  category?: DataHealthErrorCategory,
  nowMs: number = Date.now(),
): DataReceipt {
  const receipt = providerUnavailableReceipt(
    provider,
    {
      venue: input.venue,
      datasetFamily: input.family,
      instrument: input.instrument,
      coverage: input.coverage,
      sourceAsOf: null,
      observedAt: nowMs,
      expectedCadenceMs: input.expectedCadenceMs,
      maxAgeMs: input.maxAgeMs,
      cache: { status: 'bypass', ageMs: null },
      units: {},
      limitations: input.limitations,
      traceId: input.traceId,
      note: input.note,
    },
    nowMs,
  );
  tracker.recordReceipt(provider, receipt, category ?? unavailableCategory(provider, input.family, receipt));
  return receipt;
}

export function unavailableReceiptForSource(
  input: {
    providerId: string;
    providerVersion: string;
    source: string;
    family: TrustDatasetFamily;
    instrument?: string | null;
    coverage?: string | null;
    limitations: readonly string[];
    note: string;
    traceId: string;
  },
  nowMs: number = Date.now(),
): DataReceipt {
  return createDataReceipt(
    {
      providerId: input.providerId,
      providerVersion: input.providerVersion,
      source: input.source,
      datasetFamily: input.family,
      instrument: input.instrument,
      coverage: input.coverage,
      provenance: 'unavailable',
      sourceAsOf: null,
      observedAt: nowMs,
      expectedCadenceMs: null,
      maxAgeMs: null,
      cache: { status: 'bypass', ageMs: null },
      units: {},
      methodology: null,
      limitations: input.limitations,
      traceId: input.traceId,
      note: input.note,
    },
    nowMs,
  );
}

function derivedProvenance(inputs: readonly DataReceipt[]): DataProvenance {
  if (inputs.some((receipt) => receipt.provenance === 'unavailable')) return 'unavailable';
  if (inputs.some((receipt) => receipt.provenance === 'synthetic')) return 'synthetic';
  return 'live';
}

export function deriveRouteReceipt(
  provider: DataProvider,
  input: {
    family: TrustDatasetFamily;
    instrument?: string | null;
    coverage?: string | null;
    venue?: string | null;
    inputReceipts: readonly DataReceipt[];
    methodology: DataMethodology;
    units?: Readonly<Record<string, string>>;
    limitations?: readonly string[];
    traceId: string;
    expectedCadenceMs?: number | null;
    maxAgeMs?: number | null;
    cache?: ReceiptCacheFacts;
  },
  tracker: DataStatusTracker,
  category: DataHealthErrorCategory | null = null,
  nowMs: number = Date.now(),
): DataReceipt {
  if (input.inputReceipts.length === 0) {
    tracker.recordError(provider, input.family, 'malformed-upstream');
    throw new ProviderError(`Cannot derive ${input.family} without input receipts`, 502);
  }
  const provenance = derivedProvenance(input.inputReceipts);
  const note =
    provenance === 'live'
      ? null
      : provenance === 'synthetic'
        ? 'Derived from synthetic provider observations.'
        : 'Required upstream observations are unavailable.';
  const receipt = providerDerivedReceipt(
    provider,
    {
      venue: input.venue,
      datasetFamily: input.family,
      instrument: input.instrument,
      coverage: input.coverage,
      provenance,
      observedAt: nowMs,
      expectedCadenceMs: input.expectedCadenceMs,
      maxAgeMs: input.maxAgeMs,
      cache: input.cache ?? { status: 'miss', ageMs: 0 },
      units: input.units,
      methodology: input.methodology,
      inputReceipts: input.inputReceipts,
      limitations: input.limitations,
      traceId: input.traceId,
      note,
    },
    nowMs,
  );
  tracker.recordReceipt(
    provider,
    receipt,
    category ?? (receiptHasPartialEvidence(receipt) ? 'partial' : null),
  );
  return receipt;
}

export function transportDerivedReceipt<T extends object>(
  provider: DataProvider,
  payload: T & { receipt: DataReceipt },
  traceId: string,
  tracker: DataStatusTracker,
  cache: ReceiptCacheFacts,
  nowMs: number = Date.now(),
): T & { receipt: DataReceipt } {
  const receipt = withReceiptTransport(payload.receipt, { traceId, cache }, nowMs);
  tracker.recordReceipt(
    provider,
    receipt,
    receiptHasPartialEvidence(receipt)
      ? 'partial'
      : cache.status === 'hit' && receipt.freshness.state === 'stale'
        ? 'stale'
        : null,
  );
  return withDataReceipt(payload, receipt);
}
