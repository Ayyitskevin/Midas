import type { LiquidationsMeta, LiquidationsProvenance } from '@midas/shared';

/**
 * Normalize liquidations meta so the API never emits an ambiguous "available
 * but unlabeled" synthetic feed. Mock-sourced provenance always sets
 * `synthetic: true` and a non-empty note.
 */
export function honestLiquidationsMeta(
  provenance: LiquidationsProvenance,
  asOf: number = Date.now(),
): LiquidationsMeta {
  const src = provenance.source.toLowerCase();
  const isMock = src === 'mock' || src.startsWith('mock');
  const synthetic = Boolean(provenance.synthetic) || isMock;
  const note =
    provenance.note?.trim() ||
    (synthetic
      ? 'Synthetic liquidations — not real market data.'
      : provenance.available
        ? 'Exchange liquidation stream (may under-report).'
        : 'No public liquidation feed for this source.');
  return {
    ...provenance,
    synthetic,
    note,
    asOf,
  };
}
