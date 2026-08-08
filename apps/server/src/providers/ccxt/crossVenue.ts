import type { DataReceipt } from '@midas/shared';
import { partialEvidenceLimitation, withReceiptLimitations } from '@midas/shared';
import { ProviderError } from '../types';

/**
 * Receipt plumbing shared by every cross-venue fan-out (liquidations, quotes,
 * venue derivatives, venue screen). One home so the two extraction steps that
 * need it — liquidations and venueCompare — cannot drift into describing the
 * same partial-evidence situation two different ways.
 */

/**
 * The limitation a fan-out carries when it did not hear back from every venue.
 * Attempted/returned/failed are reported separately because "unsupported or
 * empty" is a different fact from "failed": a venue with no such feed is not an
 * error, but it still narrows the evidence behind the row.
 */
export function crossVenuePartialLimitation(
  family: 'quote' | 'derivatives' | 'liquidations',
  attempted: number,
  returned: number,
  failed: number,
): string {
  const unsupportedOrEmpty = attempted - returned - failed;
  return partialEvidenceLimitation(
    `Cross-venue ${family} fan-out attempted ${attempted} venue(s); ${returned} returned usable evidence, ` +
    `${failed} failed, and ${unsupportedOrEmpty} returned unsupported or empty evidence.`,
  );
}

/**
 * Append a limitation to a per-venue row's receipt. An unreceipted row is a
 * hard upstream fault, not something to paper over: without a receipt the row
 * has no provenance or freshness, so it must never reach a board.
 */
export function withRowReceiptLimitation<T extends { receipt?: DataReceipt }>(
  value: T,
  limitation: string,
  instrument: string,
): T & { receipt: DataReceipt } {
  if (!value.receipt) {
    throw new ProviderError(
      `Cross-venue provider returned unreceipted evidence for ${instrument}`,
      502,
      instrument,
      'malformed-upstream',
    );
  }
  return { ...value, receipt: withReceiptLimitations(value.receipt, [limitation]) };
}
