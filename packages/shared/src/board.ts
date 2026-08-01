/**
 * Board envelope — the provenance/freshness wrapper for the cross-symbol and
 * cross-venue fan-out boards (funding, funding dispersion, venue arb, OI
 * concentration, liquidations, screener).
 *
 * Rationale: these boards are assembled from N upstream calls and may be served
 * from a short-TTL cache, so a bare row array cannot express the three things a
 * trader needs to know — where the data came from, how old it is, and whether
 * any symbols/venues were dropped along the way. Every fan-out board returns
 * this envelope; missing evidence is surfaced, never smoothed over.
 */

/** Whether the rows are real exchange data, synthetic, or unavailable. */
export type BoardProvenance = 'live' | 'synthetic' | 'unavailable';

export interface BoardMeta {
  /** Data origin; 'synthetic' for the mock provider / static demo. */
  provenance: BoardProvenance;
  /** Source label, e.g. 'mock' or the ccxt exchange id. */
  source: string;
  /** Epoch millis the board was computed (cache compute time, not serve time). */
  asOf: number;
  /** Epoch millis the cached entry was stored; null when served fresh. */
  cachedAt: number | null;
  /** True when one or more symbols/venues failed and their rows were dropped. */
  partial: boolean;
  /** Honest caveat: why data is synthetic/unavailable/partial; null when fully live. */
  note: string | null;
}

/** A fan-out board: rows plus the metadata needed to judge them. */
export interface BoardEnvelope<T> {
  rows: T[];
  meta: BoardMeta;
}
