import {
  computeLiquidationSourceStatuses,
  computeLiquidationsCoverage,
  LIQUIDATION_SOURCE_MAX_AGE_MS,
  type LiquidationSourceCapability,
  type LiquidationSourceObservation,
  type LiquidationsAggregateMeta,
  type LiquidationsMeta,
  type LiquidationsProvenance,
} from '@midas/shared';

/**
 * Normalize liquidations meta so the API never emits an ambiguous "available
 * but unlabeled" synthetic feed, and never reports an aggregate without saying
 * how much of its configured source set it actually covers.
 *
 * Mock-sourced provenance always sets `synthetic: true` and a non-empty note.
 * `asOf` and `maxAgeMs` are injected so the staleness boundary is testable
 * against a frozen clock rather than the wall clock.
 */
export function normalizeLiquidationsMeta(
  provenance: LiquidationsProvenance,
  asOf: number = Date.now(),
  observations: LiquidationSourceObservation[] = [],
  maxAgeMs: number = LIQUIDATION_SOURCE_MAX_AGE_MS,
  // Nulls, not zeros: a feed that computed no aggregate must not report one.
  aggregate: LiquidationsAggregateMeta = {
    totalValue: null,
    referenceSource: null,
    referenceValue: null,
    multiple: null,
  },
): LiquidationsMeta {
  const isMock = provenance.source.trim().toLowerCase() === 'mock';
  const synthetic = Boolean(provenance.synthetic) || isMock;
  const note =
    provenance.note?.trim() ||
    (synthetic
      ? 'Synthetic liquidations — not real market data.'
      : provenance.available
        ? 'Exchange liquidation stream (may under-report).'
        : 'No public liquidation feed for this source.');

  const sources = computeLiquidationSourceStatuses(
    liquidationSourceCapabilities(provenance, synthetic, note),
    observations,
    asOf,
    maxAgeMs,
  );

  return {
    ...provenance,
    synthetic,
    note,
    asOf,
    sources,
    coverage: computeLiquidationsCoverage(sources),
    aggregate,
  };
}

/**
 * The declared source set for this feed. Providers that read a single venue may
 * omit `sources`; they get a one-entry set derived from the flat provenance
 * fields so coverage is always reported honestly as `n/1` rather than omitted.
 */
function liquidationSourceCapabilities(
  provenance: LiquidationsProvenance,
  synthetic: boolean,
  note: string,
): LiquidationSourceCapability[] {
  if (provenance.sources?.length) {
    // A mock/demo provider must not leak a non-synthetic per-source entry that
    // the panel could paint as a live venue.
    return synthetic
      ? provenance.sources.map((cap) => ({ ...cap, synthetic: true, throttled: false }))
      : provenance.sources;
  }
  return [
    {
      source: provenance.sampledSource?.trim() || provenance.source,
      available: provenance.available,
      // Capability-derived: a venue that publishes a public feed publishes a
      // throttled one. Fabricated events are not a throttled upstream stream.
      throttled: provenance.available && !synthetic,
      synthetic,
      note,
    },
  ];
}
