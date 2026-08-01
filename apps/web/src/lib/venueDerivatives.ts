import {
  computeFundingDispersion,
  conservativeDataProvenance,
  deriveDataReceipt,
  type DataReceipt,
  type VenueDerivatives,
} from '@midas/shared';
import { isReceiptActionable, isReceiptFresh } from './receiptView';

/** Cross-venue funding/OI summary — the divergence (arb) signal plus aggregate OI. */
export interface VenueFundingStats {
  /** Highest normalized per-8h funding rate across comparable venues. */
  maxFunding: number | null;
  /** Lowest normalized per-8h funding rate across comparable venues. */
  minFunding: number | null;
  /** max − min normalized funding; null with < 2 cadence-known venues. */
  spread: number | null;
  /** Venue with the highest funding (most expensive to be long). */
  maxVenue: string | null;
  /** Venue with the lowest / most-negative funding. */
  minVenue: string | null;
  /** Total open-interest notional across venues that report it. */
  totalOi: number | null;
  /** Number of venues returned. */
  venues: number;
}

export interface InspectedVenueFundingStats {
  stats: VenueFundingStats;
  receipt: DataReceipt | null;
  actionable: boolean;
}

/**
 * Summarize per-venue derivatives using the shared, cadence-normalized funding
 * policy. Unknown cadence is excluded from the arb comparison, and all-unknown
 * open interest stays null rather than becoming a reassuring zero.
 */
export function summarizeVenueDerivatives(rows: VenueDerivatives[]): VenueFundingStats {
  const normalized = computeFundingDispersion('summary', rows);
  return {
    maxFunding: normalized.maxRate,
    minFunding: normalized.minRate,
    spread: normalized.spreadBps == null ? null : normalized.spreadBps / 10_000,
    maxVenue: normalized.highVenue,
    minVenue: normalized.lowVenue,
    totalOi: normalized.totalOiValue,
    venues: rows.length,
  };
}

function canonicalInstrument(value: string): string {
  const [base = '', rawQuote = ''] = value.trim().toUpperCase().split('/');
  return rawQuote ? `${base}/${rawQuote.replace(/:.*$/, '')}` : base;
}

function suppressSignal(stats: VenueFundingStats): VenueFundingStats {
  return {
    ...stats,
    maxFunding: null,
    minFunding: null,
    spread: null,
    maxVenue: null,
    minVenue: null,
    totalOi: null,
  };
}

/** Build the cross-venue summary with every venue observation in its lineage. */
export function inspectVenueDerivativesSummary(
  rows: VenueDerivatives[],
  instrument: string,
  evaluatedAtMs: number = Date.now(),
): InspectedVenueFundingStats {
  const stats = summarizeVenueDerivatives(rows);
  const expected = canonicalInstrument(instrument);
  const receipts = rows.flatMap((row) => (row.receipt ? [row.receipt] : []));
  const congruent = rows.every(
    (row) =>
      row.receipt != null &&
      row.receipt.instrument != null &&
      canonicalInstrument(row.receipt.instrument) === expected &&
      row.receipt.venue?.toLowerCase() === row.exchange.toLowerCase(),
  );
  if (rows.length === 0 || receipts.length !== rows.length || !congruent) {
    return { stats: suppressSignal(stats), receipt: null, actionable: false };
  }
  try {
    const provenance = conservativeDataProvenance(receipts.map((receipt) => receipt.provenance));
    const receipt = deriveDataReceipt(
      {
        providerId: 'midas-web',
        providerVersion: '1.0',
        source: 'Midas client venue-derivatives reducer',
        venue: null,
        datasetFamily: 'venue-derivatives',
        instrument,
        coverage: `${rows.length} returned venue derivative snapshot(s)`,
        provenance,
        expectedCadenceMs: 8_000,
        units: {
          fundingRate: 'fraction/8h-equivalent',
          openInterestValue: 'quote currency',
          spread: 'fraction/8h-equivalent',
        },
        methodology: {
          id: 'cross-venue-derivatives-summary',
          version: '1.0',
          formula:
            'funding8h=fundingRate*(8/fundingIntervalHours); spread=max(funding8h)-min(funding8h); totalOi=sum(reported openInterestValue)',
        },
        inputReceipts: receipts,
        limitations: [
          'Funding observations with unknown settlement cadence are excluded from the spread.',
          'Total open interest excludes venues that do not report notional open interest.',
        ],
        note: provenance === 'live' ? null : `Derived from ${provenance} venue-derivative evidence.`,
      },
      evaluatedAtMs,
    );
    const fresh = isReceiptFresh(receipt, evaluatedAtMs) && receipt.provenance !== 'unavailable';
    return {
      stats: fresh ? stats : suppressSignal(stats),
      receipt,
      actionable: isReceiptActionable(receipt, evaluatedAtMs),
    };
  } catch {
    return { stats: suppressSignal(stats), receipt: null, actionable: false };
  }
}
