import {
  computeVenueArbRow,
  deriveDataReceipt,
  partialEvidenceLimitation,
  type DataProvenance,
  type DataReceipt,
  type VenueArbRow,
  type VenueQuote,
} from '@midas/shared';
import { isReceiptActionable, isReceiptFresh } from './receiptView';

export interface InspectedVenueArb {
  row: VenueArbRow;
  receipt: DataReceipt | null;
  /** True only for a fresh, live, net-positive signal. */
  actionable: boolean;
}

/** A net spread is actionable only when its complete derived evidence is fresh and live. */
export function isActionableVenueArb(
  row: Pick<VenueArbRow, 'netCrossed' | 'receipt'>,
  evaluatedAtMs: number = Date.now(),
): boolean {
  return Boolean(row.netCrossed && isReceiptActionable(row.receipt, evaluatedAtMs));
}

function suppressUnverifiedNet(row: VenueArbRow, limitation: string): VenueArbRow {
  return {
    ...row,
    netSpreadBps: null,
    netCrossed: false,
    netLimitations: [...new Set([...row.netLimitations, limitation])],
  };
}

/**
 * Client-side single-symbol arb reduction with explicit lineage. Missing or
 * invalid quote receipts suppress the net signal instead of producing an
 * uninspectable green recommendation.
 */
export function computeInspectedVenueArb(
  symbol: string,
  quotes: VenueQuote[],
  evaluatedAtMs: number = Date.now(),
): InspectedVenueArb {
  const computed = computeVenueArbRow(symbol, quotes, evaluatedAtMs);
  const inputReceipts = quotes.flatMap((quote) => (quote.receipt ? [quote.receipt] : []));
  if (inputReceipts.length !== quotes.length || inputReceipts.length < 2) {
    return {
      row: suppressUnverifiedNet(computed, 'Complete source receipts are required for every venue quote.'),
      receipt: null,
      actionable: false,
    };
  }

  const provenance: DataProvenance = inputReceipts.some((receipt) => receipt.provenance === 'unavailable')
    ? 'unavailable'
    : inputReceipts.some((receipt) => receipt.provenance === 'synthetic')
      ? 'synthetic'
      : 'live';
  try {
    const receipt = deriveDataReceipt(
      {
        providerId: 'midas-web',
        providerVersion: '1.0',
        source: 'Midas client venue-arbitrage reducer',
        venue: null,
        datasetFamily: 'venue-arbitrage',
        instrument: symbol,
        coverage: `${quotes.length} returned venue quotes`,
        provenance,
        expectedCadenceMs: 5_000,
        maxAgeMs: 30_000,
        units: {
          dispersionBps: 'basis points',
          executableSize: 'base asset',
          netSpreadBps: 'basis points',
          spreadBps: 'basis points',
        },
        methodology: {
          id: 'cross-venue-net-spread',
          version: '1.0',
          formula: 'bestBid - bestAsk, normalized to bps, minus both reference taker fees',
        },
        inputReceipts,
        limitations: [
          ...computed.netLimitations.map(partialEvidenceLimitation),
          'Reference taker fees exclude withdrawal, transfer, slippage, and account-specific fee tiers.',
        ],
        note: provenance === 'live' ? null : `Derived from ${provenance} venue-quote evidence.`,
      },
      evaluatedAtMs,
    );
    const row = isReceiptFresh(receipt, evaluatedAtMs)
      ? { ...computed, receipt }
      : {
          ...suppressUnverifiedNet(computed, 'Derived source evidence is not fresh.'),
          receipt,
        };
    return {
      row,
      receipt,
      actionable: isActionableVenueArb(row, evaluatedAtMs),
    };
  } catch {
    return {
      row: suppressUnverifiedNet(computed, 'Source receipts failed validation.'),
      receipt: null,
      actionable: false,
    };
  }
}
