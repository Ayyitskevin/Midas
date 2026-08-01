import {
  PROVIDER_CAPABILITY_SCHEMA_VERSION,
  TRUST_DATASET_FAMILIES,
  conservativeDataProvenance,
  createDataReceipt,
  deriveDataReceipt,
  sanitizeReceiptText,
  withDataReceipt,
} from '@midas/shared';
import type {
  DataProvenance,
  DataReceipt,
  DataReceiptInput,
  DerivedDataReceiptInput,
  ProviderCapability,
  ProviderCapabilityManifest,
  TrustDatasetFamily,
} from '@midas/shared';
import type { DataProvider } from './types';

export type CapabilityDefinition = Omit<ProviderCapability, 'datasetFamily' | 'source'> & {
  source?: string;
};

/**
 * Build an exhaustive manifest: every trust-plane family is present, and any
 * family a provider omits is explicitly unsupported rather than absent.
 */
export function buildProviderCapabilities(input: {
  providerId: string;
  providerVersion: string;
  source: string;
  capabilities: Partial<Record<TrustDatasetFamily, CapabilityDefinition>>;
}): ProviderCapabilityManifest {
  const capabilities = Object.fromEntries(
    TRUST_DATASET_FAMILIES.map((datasetFamily) => {
      const declared = input.capabilities[datasetFamily];
      const capability: ProviderCapability = declared
        ? {
            ...declared,
            datasetFamily,
            source: declared.source ?? input.source,
            caveats: declared.caveats.map((caveat) => sanitizeReceiptText(caveat)),
          }
        : {
            datasetFamily,
            method: '',
            support: 'unsupported',
            auth: 'none',
            mode: 'unavailable',
            source: input.source,
            venue: null,
            coverage: null,
            expectedCadenceMs: null,
            maxAgeMs: null,
            cacheTtlMs: null,
            methodology: null,
            caveats: [`${datasetFamily} is not implemented by ${input.providerId}.`],
          };
      return [datasetFamily, capability] as const;
    }),
  ) as Record<TrustDatasetFamily, ProviderCapability>;
  return {
    schemaVersion: PROVIDER_CAPABILITY_SCHEMA_VERSION,
    providerId: input.providerId,
    providerVersion: input.providerVersion,
    source: input.source,
    capabilities,
  };
}

export type ProviderReceiptInput = Omit<
  DataReceiptInput,
  'providerId' | 'providerVersion' | 'source' | 'provenance'
> & {
  source?: string;
  provenance?: DataProvenance;
};

/** Resolve one declared capability; callers never infer from provider.live. */
export function capabilityFor(provider: DataProvider, family: TrustDatasetFamily): ProviderCapability {
  return provider.capabilities.capabilities[family];
}

/** Build one provider-owned observed/derived receipt from its manifest defaults. */
export function providerReceipt(
  provider: DataProvider,
  input: ProviderReceiptInput,
  nowMs: number = Date.now(),
): DataReceipt {
  const manifest = provider.capabilities;
  const capability = capabilityFor(provider, input.datasetFamily);
  const provenance = input.provenance ?? capability.mode;
  const requestedNote = input.note?.trim() || null;
  const note = requestedNote ?? (
    provenance === 'synthetic'
      ? `Synthetic ${input.datasetFamily} data from ${input.source ?? capability.source}.`
      : provenance === 'unavailable'
        ? `${input.datasetFamily} is unavailable from ${input.source ?? capability.source}.`
        : null
  );
  const liveNoteLimitation = provenance === 'live' && requestedNote ? [requestedNote] : [];
  return createDataReceipt(
    {
      ...input,
      providerId: manifest.providerId,
      providerVersion: manifest.providerVersion,
      source: input.source ?? capability.source,
      venue: input.venue === undefined ? capability.venue : input.venue,
      coverage: input.coverage === undefined ? capability.coverage : input.coverage,
      provenance,
      expectedCadenceMs:
        input.expectedCadenceMs === undefined ? capability.expectedCadenceMs : input.expectedCadenceMs,
      maxAgeMs: input.maxAgeMs === undefined ? capability.maxAgeMs : input.maxAgeMs,
      methodology: input.methodology === undefined ? capability.methodology : input.methodology,
      limitations: [
        ...capability.caveats,
        ...liveNoteLimitation,
        ...(input.limitations ?? []),
      ].map((limitation) => sanitizeReceiptText(limitation)),
      note: provenance === 'live' || note == null ? null : sanitizeReceiptText(note),
    },
    nowMs,
  );
}

export type ProviderDerivedReceiptInput = Omit<
  DerivedDataReceiptInput,
  'providerId' | 'providerVersion' | 'source' | 'provenance'
> & {
  source?: string;
  provenance?: DataProvenance;
};

/** Build a provider-owned derived receipt with explicit source lineage. */
export function providerDerivedReceipt(
  provider: DataProvider,
  input: ProviderDerivedReceiptInput,
  nowMs: number = Date.now(),
): DataReceipt {
  const manifest = provider.capabilities;
  const capability = capabilityFor(provider, input.datasetFamily);
  const provenance = conservativeDataProvenance([
    input.provenance ?? capability.mode,
    ...input.inputReceipts.map((receipt) => receipt.provenance),
  ]);
  const requestedNote = input.note?.trim() || null;
  const note = requestedNote ?? (
    provenance === 'synthetic'
      ? `Synthetic ${input.datasetFamily} data from ${input.source ?? capability.source}.`
      : provenance === 'unavailable'
        ? `${input.datasetFamily} is unavailable from ${input.source ?? capability.source}.`
        : null
  );
  return deriveDataReceipt(
    {
      ...input,
      providerId: manifest.providerId,
      providerVersion: manifest.providerVersion,
      source: input.source ?? capability.source,
      venue: input.venue === undefined ? capability.venue : input.venue,
      coverage: input.coverage === undefined ? capability.coverage : input.coverage,
      provenance,
      expectedCadenceMs:
        input.expectedCadenceMs === undefined ? capability.expectedCadenceMs : input.expectedCadenceMs,
      maxAgeMs: input.maxAgeMs === undefined ? capability.maxAgeMs : input.maxAgeMs,
      methodology: input.methodology === undefined ? capability.methodology : input.methodology,
      limitations: [
        ...capability.caveats,
        ...(provenance === 'live' && requestedNote ? [requestedNote] : []),
        ...(input.limitations ?? []),
      ].map((limitation) => sanitizeReceiptText(limitation)),
      note: provenance === 'live' || note == null ? null : sanitizeReceiptText(note),
    },
    nowMs,
  );
}

/** Attach an explicitly-derived provider receipt without mutating the payload. */
export function withProviderDerivedReceipt<T extends object>(
  provider: DataProvider,
  payload: T,
  input: ProviderDerivedReceiptInput,
  nowMs: number = Date.now(),
): T & { receipt: DataReceipt } {
  return withDataReceipt(payload, providerDerivedReceipt(provider, input, nowMs));
}

export type ProviderUnavailableReceiptInput = Omit<ProviderReceiptInput, 'provenance' | 'note'> & {
  note: string;
};

/** Intentional unsupported/not-configured response; transport failures should throw. */
export function providerUnavailableReceipt(
  provider: DataProvider,
  input: ProviderUnavailableReceiptInput,
  nowMs: number = Date.now(),
): DataReceipt {
  return providerReceipt(
    provider,
    {
      ...input,
      provenance: 'unavailable',
      sourceAsOf: null,
      note: input.note,
    },
    nowMs,
  );
}

/** Convenience for provider methods; returns a clone and never mutates fixtures. */
export function withProviderReceipt<T extends object>(
  provider: DataProvider,
  payload: T,
  input: ProviderReceiptInput,
  nowMs: number = Date.now(),
): T & { receipt: DataReceipt } {
  return withDataReceipt(payload, providerReceipt(provider, input, nowMs));
}
