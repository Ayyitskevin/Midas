import {
  DATA_STATUS_SCHEMA_VERSION,
  MIDAS_VERSION,
  PROVIDER_CAPABILITY_SCHEMA_VERSION,
  TRUST_DATASET_FAMILIES,
  createDataReceipt,
  deriveDataReceipt,
  withDataReceipt,
  withReceiptTransport,
} from '@midas/shared';
import type {
  DataFamilyHealth,
  DataMethodology,
  DataProvenance,
  DataReceipt,
  DataStatusResponse,
  ProviderCapability,
  ProviderCapabilityManifest,
  TrustDatasetFamily,
} from '@midas/shared';

export const DEMO_TRUST_SOURCE = 'demo';
const DEMO_NOTE = 'Static demo — deterministic synthetic data generated in your browser; not live market data.';

const METHOD_BY_FAMILY: Record<TrustDatasetFamily, string> = {
  quote: 'quoteFor',
  history: 'historyFor',
  funding: 'fundingRows',
  'funding-history': 'fundingHistoryFor',
  'open-interest': 'derivativesFor',
  'open-interest-history': 'oiDeltaFor',
  'open-interest-delta': 'oiDeltaFor',
  derivatives: 'derivativesFor',
  'venue-derivatives': 'venueDerivatives',
  liquidations: 'liquidationsFeed',
  'venue-quotes': 'venueQuotes',
  'venue-arbitrage': 'venueArbRows',
  'venue-screener': 'venueScreenerRows',
  options: 'optionsChainFor',
  balances: 'balancesFor',
  'account-orders': 'openOrdersFor',
  'account-positions': 'positionsFor',
  'account-fills': 'fillsFor',
};

function cadenceFor(family: TrustDatasetFamily): number {
  if (family === 'history' || family === 'funding-history' || family === 'open-interest-history') return 60_000;
  if (family.startsWith('account-')) return 30_000;
  if (family === 'balances') return 30_000;
  return 15_000;
}

const demoCapabilities = Object.fromEntries(
  TRUST_DATASET_FAMILIES.map((datasetFamily) => {
    const cadence = cadenceFor(datasetFamily);
    const capability: ProviderCapability = {
      datasetFamily,
      method: METHOD_BY_FAMILY[datasetFamily],
      support: 'supported',
      auth: 'none',
      mode: 'synthetic',
      source: DEMO_TRUST_SOURCE,
      venue: null,
      coverage: 'Static demo fixture universe',
      expectedCadenceMs: cadence,
      maxAgeMs: cadence * 3,
      cacheTtlMs: 0,
      methodology: null,
      caveats: [DEMO_NOTE],
    };
    return [datasetFamily, capability] as const;
  }),
) as Record<TrustDatasetFamily, ProviderCapability>;

/** Browser-demo equivalent of a provider manifest; generated from one explicit declaration. */
export const DEMO_CAPABILITIES: ProviderCapabilityManifest = {
  schemaVersion: PROVIDER_CAPABILITY_SCHEMA_VERSION,
  providerId: DEMO_TRUST_SOURCE,
  providerVersion: MIDAS_VERSION,
  source: DEMO_TRUST_SOURCE,
  capabilities: demoCapabilities,
};

interface DemoReceiptOptions {
  venue?: string | null;
  coverage?: string | null;
  sourceAsOf?: number | null;
  units?: Readonly<Record<string, string>>;
  limitations?: readonly string[];
  methodology?: DataMethodology | null;
  traceId?: string | null;
  provenance?: DataProvenance;
  note?: string | null;
}

/** Deterministic for the same fixture identity and clock instant. */
export function demoReceipt(
  datasetFamily: TrustDatasetFamily,
  instrument: string | null,
  now: number,
  options: DemoReceiptOptions = {},
): DataReceipt {
  const capability = DEMO_CAPABILITIES.capabilities[datasetFamily];
  const provenance = options.provenance ?? 'synthetic';
  const defaultNote =
    provenance === 'synthetic'
      ? DEMO_NOTE
      : provenance === 'unavailable'
        ? 'This dataset is unavailable for the requested static-demo fixture.'
        : null;
  const note = options.note === undefined ? defaultNote : options.note;
  const provenanceLimitations =
    provenance === 'synthetic'
      ? [DEMO_NOTE]
      : provenance === 'unavailable' && note
        ? [note]
        : [];
  return createDataReceipt(
    {
      providerId: DEMO_CAPABILITIES.providerId,
      providerVersion: DEMO_CAPABILITIES.providerVersion,
      source: DEMO_TRUST_SOURCE,
      venue: options.venue ?? null,
      datasetFamily,
      instrument,
      coverage: options.coverage ?? capability.coverage,
      provenance,
      sourceAsOf: options.sourceAsOf === undefined ? (provenance === 'unavailable' ? null : now) : options.sourceAsOf,
      observedAt: now,
      expectedCadenceMs: capability.expectedCadenceMs,
      maxAgeMs: capability.maxAgeMs,
      cache: { status: 'bypass', ageMs: null },
      units: options.units ?? {},
      methodology: options.methodology ?? null,
      limitations: [...provenanceLimitations, ...(options.limitations ?? [])],
      traceId: options.traceId ?? null,
      note,
    },
    now,
  );
}

export function demoDerivedReceipt(
  datasetFamily: TrustDatasetFamily,
  instrument: string | null,
  now: number,
  inputReceipts: readonly DataReceipt[],
  methodology: DataMethodology,
  options: Omit<DemoReceiptOptions, 'methodology'> = {},
): DataReceipt {
  const capability = DEMO_CAPABILITIES.capabilities[datasetFamily];
  return deriveDataReceipt(
    {
      providerId: DEMO_CAPABILITIES.providerId,
      providerVersion: DEMO_CAPABILITIES.providerVersion,
      source: DEMO_TRUST_SOURCE,
      venue: options.venue ?? null,
      datasetFamily,
      instrument,
      coverage: options.coverage ?? capability.coverage,
      provenance: 'synthetic',
      observedAt: now,
      expectedCadenceMs: capability.expectedCadenceMs,
      maxAgeMs: capability.maxAgeMs,
      cache: { status: 'bypass', ageMs: null },
      units: options.units ?? {},
      methodology,
      inputReceipts,
      limitations: [DEMO_NOTE, ...(options.limitations ?? [])],
      traceId: options.traceId ?? null,
      note: DEMO_NOTE,
    },
    now,
  );
}

export function withDemoReceipt<T extends object>(
  payload: T,
  datasetFamily: TrustDatasetFamily,
  instrument: string | null,
  now: number,
  options: DemoReceiptOptions = {},
): T & { receipt: DataReceipt } {
  return withDataReceipt(payload, demoReceipt(datasetFamily, instrument, now, options));
}

/** Safe status parity for the static build; contains no account values or browser identity. */
export function demoDataStatus(
  now: number,
  latestReceipts: ReadonlyMap<TrustDatasetFamily, DataReceipt> = new Map(),
  lastSuccessReceipts: ReadonlyMap<TrustDatasetFamily, DataReceipt> = latestReceipts,
): DataStatusResponse {
  const datasets = Object.fromEntries(
    TRUST_DATASET_FAMILIES.map((datasetFamily) => {
      const stored = latestReceipts.get(datasetFamily);
      if (!stored) {
        const capability = DEMO_CAPABILITIES.capabilities[datasetFamily];
        const health: DataFamilyHealth = {
          datasetFamily,
          state: 'unknown',
          providerId: DEMO_CAPABILITIES.providerId,
          source: capability.source,
          provenance: null,
          sourceMode: capability.mode,
          lastReceiptId: null,
          lastSuccessAt: null,
          sourceAsOf: null,
          freshness: { state: 'unknown', ageMs: null },
          cache: { status: 'unknown', ageMs: null },
          limitations: capability.caveats,
          errorCategory: null,
          note: null,
        };
        return [datasetFamily, health] as const;
      }
      const receipt = withReceiptTransport(stored, {}, now);
      const lastSuccess = lastSuccessReceipts.get(datasetFamily);
      const state: DataFamilyHealth['state'] =
        receipt.provenance === 'unavailable'
          ? 'unavailable'
          : receipt.freshness.state === 'fresh'
            ? 'healthy'
            : receipt.freshness.state === 'unknown'
              ? 'unknown'
              : 'degraded';
      const health: DataFamilyHealth = {
        datasetFamily,
        state,
        providerId: receipt.providerId,
        source: receipt.source,
        provenance: receipt.provenance,
        sourceMode: DEMO_CAPABILITIES.capabilities[datasetFamily].mode,
        lastReceiptId: receipt.receiptId,
        lastSuccessAt: lastSuccess?.observedAt ?? null,
        sourceAsOf: lastSuccess?.sourceAsOf ?? receipt.sourceAsOf,
        freshness: receipt.freshness,
        cache: receipt.cache,
        limitations: receipt.limitations,
        errorCategory: receipt.provenance === 'unavailable' ? 'upstream-unavailable' : null,
        note: receipt.note,
      };
      return [datasetFamily, health] as const;
    }),
  );
  return {
    schemaVersion: DATA_STATUS_SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    providers: [DEMO_CAPABILITIES],
    datasets,
  };
}
