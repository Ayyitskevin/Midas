import type { FastifyInstance } from 'fastify';
import {
  DATA_STATUS_SCHEMA_VERSION,
  TRUST_DATASET_FAMILIES,
  toUtcTimestamp,
  withReceiptTransport,
} from '@midas/shared';
import type {
  DataFamilyHealth,
  DataHealthErrorCategory,
  DataReceipt,
  DataStatusResponse,
  ProviderCapability,
  ProviderCapabilityManifest,
  TrustDatasetFamily,
} from '@midas/shared';
import type { DataProvider } from './providers';
import type { ProviderResolver } from './routes/shared';
import { DATA_ROUTE_PATHS } from './dataCoverage';

export interface DataStatusTracker {
  recordReceipt(
    provider: DataStatusSource,
    receipt: DataReceipt,
    /** null/undefined derive from this receipt; an explicit category annotates it. */
    category?: DataHealthErrorCategory | null,
  ): void;
  recordError(provider: DataStatusSource, dataset: TrustDatasetFamily, category: DataHealthErrorCategory): void;
  snapshot(provider: DataStatusSource): Partial<Record<TrustDatasetFamily, DataFamilyHealth>>;
  response(marketProvider: DataStatusSource, accountProvider: DataStatusSource | null): DataStatusResponse;
}

/** The status plane needs provider identity/capabilities, never data methods. */
export type DataStatusSource = Pick<DataProvider, 'name' | 'capabilities'>;

export type DataStatusObservation =
  | {
      kind: 'receipt';
      receiptId: string;
      datasetFamily: TrustDatasetFamily;
      providerId: string;
      traceId: string | null;
      freshness: DataReceipt['freshness']['state'];
      cache: DataReceipt['cache']['status'];
    }
  | {
      kind: 'error';
      datasetFamily: TrustDatasetFamily;
      providerId: string;
      errorCategory: DataHealthErrorCategory;
    };

export type DataStatusObserver = (observation: DataStatusObservation) => void;

const ERROR_NOTES: Record<DataHealthErrorCategory, string> = {
  unsupported: 'The selected provider does not support this dataset.',
  'not-configured': 'This dataset needs provider configuration that is not currently available.',
  'upstream-unavailable': 'The upstream dataset is currently unavailable.',
  'malformed-upstream': 'The upstream response did not satisfy the data-receipt contract.',
  partial: 'Some required inputs were unavailable.',
  stale: 'The latest observation is older than the configured freshness policy.',
  unknown: 'Dataset health is unknown.',
};

const ACCOUNT_FAMILIES = new Set<TrustDatasetFamily>([
  'balances',
  'account-orders',
  'account-positions',
  'account-fills',
]);

const RUNTIME_UNSUPPORTED_RE =
  /\b(?:does not (?:expose|support|implement)|unsupported|requires? (?:a )?symbol|symbol (?:is )?required)\b/i;
const NOT_CONFIGURED_RE =
  /(?:\b(?:credentials?|api keys?|exchange keys?)\b.*\b(?:not configured|unconfigured|missing)\b)|(?:\bno usable\b.*\bkey\b)/i;

/** Map a declared capability plus an optional safe runtime reason to one fixed category. */
export function capabilityUnavailableCategory(
  capability: ProviderCapability,
  runtimeReason: string | null = null,
): DataHealthErrorCategory {
  if (capability.support === 'unsupported') return 'unsupported';
  if (runtimeReason && RUNTIME_UNSUPPORTED_RE.test(runtimeReason)) return 'unsupported';
  const declaredReason = capability.caveats.join(' ');
  if (capability.mode === 'unavailable') {
    if (capability.auth === 'credentials-required' && NOT_CONFIGURED_RE.test(declaredReason)) {
      return 'not-configured';
    }
    // Conditional + unavailable with no missing-credentials caveat means the
    // provider instance lacks the method, rather than lacking user setup.
    return 'unsupported';
  }
  if (capability.auth === 'credentials-required') return 'not-configured';
  return 'upstream-unavailable';
}

function providerManifest(provider: DataStatusSource): ProviderCapabilityManifest {
  // DataProvider.capabilities is the v1 seam. Keep the status route defensive
  // while older third-party/test providers migrate: an absent manifest is
  // visible as empty/unknown, never invented as supported.
  const candidate = (provider as { capabilities?: ProviderCapabilityManifest }).capabilities;
  return (
    candidate ?? {
      schemaVersion: '1.0',
      providerId: provider.name,
      providerVersion: 'unknown',
      source: provider.name,
      capabilities: {} as ProviderCapabilityManifest['capabilities'],
    }
  );
}

function initialHealth(provider: DataStatusSource, datasetFamily: TrustDatasetFamily): DataFamilyHealth {
  const manifest = providerManifest(provider);
  const capability = manifest.capabilities[datasetFamily];
  const unavailable = capability?.support === 'unsupported' || capability?.mode === 'unavailable';
  const errorCategory: DataHealthErrorCategory | null =
    unavailable && capability ? capabilityUnavailableCategory(capability) : null;
  return {
    datasetFamily,
    state: unavailable ? 'unavailable' : 'unknown',
    errorCategory,
    providerId: manifest.providerId,
    source: capability?.source ?? manifest.source,
    provenance: null,
    sourceMode: capability?.mode ?? 'unavailable',
    lastReceiptId: null,
    lastSuccessAt: null,
    sourceAsOf: null,
    freshness: { state: 'unknown', ageMs: null },
    cache: { status: 'unknown', ageMs: null },
    limitations: unavailable
      ? [...(capability?.caveats ?? []), ...(errorCategory ? [errorCategory] : [])]
      : [],
    note: errorCategory ? ERROR_NOTES[errorCategory] : null,
  };
}

function stateFor(
  receipt: DataReceipt,
  category: DataHealthErrorCategory | null,
): DataFamilyHealth['state'] {
  if (receipt.provenance === 'unavailable') return 'unavailable';
  if (category === 'partial' || category === 'stale') return 'degraded';
  if (receipt.freshness.state === 'fresh') return 'healthy';
  if (receipt.freshness.state === 'unknown') return 'unknown';
  // Includes stale and any future explicit clock-skew state: only `fresh` is
  // allowed to claim healthy.
  return 'degraded';
}

/**
 * In-memory, per-provider dataset health. Provider objects are WeakMap keys so
 * keyed-user clients do not leave user ids or an unbounded status history in
 * memory. No raw payload or raw error message is retained.
 */
export function createDataStatusTracker(
  now: () => number = Date.now,
  observe: DataStatusObserver = () => undefined,
): DataStatusTracker {
  const byProvider = new WeakMap<DataStatusSource, Map<TrustDatasetFamily, DataFamilyHealth>>();
  // Keep the last current receipt separately from the sanitized projection so
  // freshness can be evaluated at status-read time. A health snapshot must not
  // leave a once-fresh observation permanently healthy after its max age.
  const receiptsByProvider = new WeakMap<DataStatusSource, Map<TrustDatasetFamily, DataReceipt>>();

  const healthFor = (provider: DataStatusSource, family: TrustDatasetFamily): DataFamilyHealth => {
    let datasets = byProvider.get(provider);
    if (!datasets) {
      datasets = new Map();
      byProvider.set(provider, datasets);
    }
    let health = datasets.get(family);
    if (!health) {
      health = initialHealth(provider, family);
      datasets.set(family, health);
    }
    return health;
  };

  const recordReceipt: DataStatusTracker['recordReceipt'] = (provider, receipt, category) => {
    const previous = healthFor(provider, receipt.datasetFamily);
    let receipts = receiptsByProvider.get(provider);
    if (!receipts) {
      receipts = new Map();
      receiptsByProvider.set(provider, receipts);
    }
    receipts.set(receipt.datasetFamily, receipt);
    const freshnessCategory: DataHealthErrorCategory | null =
      receipt.provenance === 'unavailable'
        ? 'unknown'
        : receipt.freshness.state === 'fresh'
        ? null
        : receipt.freshness.state === 'unknown'
          ? 'unknown'
          : 'stale';
    const effectiveCategory = category ?? freshnessCategory;
    const succeeded = receipt.provenance !== 'unavailable';
    const limitations = [...receipt.limitations];
    if (effectiveCategory && !limitations.includes(effectiveCategory)) limitations.unshift(effectiveCategory);
    byProvider.get(provider)!.set(receipt.datasetFamily, {
      datasetFamily: receipt.datasetFamily,
      state: stateFor(receipt, effectiveCategory),
      errorCategory: effectiveCategory,
      providerId: receipt.providerId,
      source: receipt.source,
      provenance: receipt.provenance,
      sourceMode: providerManifest(provider).capabilities[receipt.datasetFamily]?.mode ?? 'unavailable',
      lastReceiptId: receipt.receiptId,
      lastSuccessAt: succeeded ? receipt.observedAt : previous.lastSuccessAt,
      sourceAsOf: receipt.sourceAsOf,
      freshness: receipt.freshness,
      cache: receipt.cache,
      limitations,
      note: receipt.note,
    });
    observe({
      kind: 'receipt',
      receiptId: receipt.receiptId,
      datasetFamily: receipt.datasetFamily,
      providerId: receipt.providerId,
      traceId: receipt.traceId,
      freshness: receipt.freshness.state,
      cache: receipt.cache.status,
    });
  };

  const recordError: DataStatusTracker['recordError'] = (provider, family, category) => {
    const previous = healthFor(provider, family);
    byProvider.get(provider)!.set(family, {
      ...previous,
      state: 'unavailable',
      errorCategory: category,
      provenance: null,
      lastReceiptId: null,
      // No new source observation accompanied the operational error. Retain
      // the last successful source-as-of alongside lastSuccessAt so status can
      // still answer when the most recent good evidence was current.
      sourceAsOf: previous.sourceAsOf,
      // Preserve last-success evidence while recording only a fixed category.
      freshness: { state: 'unknown', ageMs: null },
      cache: { status: 'unknown', ageMs: null },
      limitations: [category],
      note: ERROR_NOTES[category],
    });
    observe({
      kind: 'error',
      datasetFamily: family,
      providerId: providerManifest(provider).providerId,
      errorCategory: category,
    });
  };

  const snapshotAt = (
    provider: DataStatusSource,
    evaluatedAt: number,
  ): Partial<Record<TrustDatasetFamily, DataFamilyHealth>> => {
    const manifest = providerManifest(provider);
    const observed = byProvider.get(provider);
    const receipts = receiptsByProvider.get(provider);
    const out: Partial<Record<TrustDatasetFamily, DataFamilyHealth>> = {};
    for (const family of TRUST_DATASET_FAMILIES) {
      if (manifest.capabilities[family] || observed?.has(family)) {
        const health = observed?.get(family) ?? initialHealth(provider, family);
        const receipt = receipts?.get(family);
        if (!receipt || health.lastReceiptId !== receipt.receiptId) {
          out[family] = { ...health };
          continue;
        }

        // Use the contract's transport evaluator so derived receipts retain
        // inherited unknown/stale/clock-skew evidence while their wall-clock
        // age continues to advance.
        const evaluatedReceipt = withReceiptTransport(receipt, {}, evaluatedAt);
        const freshness = evaluatedReceipt.freshness;
        const effectiveCategory: DataHealthErrorCategory | null =
          health.errorCategory === 'partial'
            ? 'partial'
            : receipt.provenance === 'unavailable'
              ? health.errorCategory ?? 'unknown'
              : freshness.state === 'fresh'
                ? null
                : freshness.state === 'unknown'
                  ? 'unknown'
                  : 'stale';
        const limitations = [...receipt.limitations];
        if (effectiveCategory && !limitations.includes(effectiveCategory)) {
          limitations.unshift(effectiveCategory);
        }
        out[family] = {
          ...health,
          state: stateFor(evaluatedReceipt, effectiveCategory),
          errorCategory: effectiveCategory,
          provenance: receipt.provenance,
          sourceMode: manifest.capabilities[family]?.mode ?? 'unavailable',
          freshness,
          limitations,
        };
      }
    }
    return out;
  };

  const snapshot = (provider: DataStatusSource): Partial<Record<TrustDatasetFamily, DataFamilyHealth>> =>
    snapshotAt(provider, now());

  return {
    recordReceipt,
    recordError,
    snapshot,
    response(marketProvider, accountProvider) {
      const evaluatedAt = now();
      const providers = [marketProvider, ...(accountProvider ? [accountProvider] : [])];
      const uniqueProviders = [...new Set(providers)];
      const manifests = uniqueProviders.map(providerManifest);
      const datasets = snapshotAt(marketProvider, evaluatedAt);
      // Account-family entries from the caller's isolated provider override
      // only the base provider's account declarations; a keyed provider also
      // declares public market capabilities, which must not replace the market
      // provider's observed health. No user id or key metadata enters the map.
      if (accountProvider && accountProvider !== marketProvider) {
        for (const [family, health] of Object.entries(snapshotAt(accountProvider, evaluatedAt))) {
          if (health && ACCOUNT_FAMILIES.has(family as TrustDatasetFamily)) {
            datasets[family as TrustDatasetFamily] = health;
          }
        }
      }
      return {
        schemaVersion: DATA_STATUS_SCHEMA_VERSION,
        generatedAt: toUtcTimestamp(evaluatedAt),
        providers: manifests,
        datasets,
      };
    },
  };
}

export function registerDataStatusRoute(
  app: FastifyInstance,
  marketProvider: DataProvider,
  pool: ProviderResolver,
  tracker: DataStatusTracker,
  unavailableAccountSource: DataStatusSource | null = null,
): void {
  app.get(DATA_ROUTE_PATHS.dataStatus, async (req): Promise<DataStatusResponse> =>
    tracker.response(marketProvider, pool.accountFor(req.userId) ?? unavailableAccountSource),
  );
}
