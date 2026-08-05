import { takerFeeBps, type Balances, type TradingStatus } from '@midas/shared';
import { isReceiptActionable } from './receiptView';

/**
 * Sizing + cap helpers for the order ticket. Pure so the sizing math and the
 * client-side cap warnings are unit-tested; the server re-enforces both caps
 * authoritatively on every placement regardless of what the client shows.
 */

/**
 * Amount for a %-of-balance quick-size: a sell sizes from the free base asset;
 * a buy converts a fraction of the free quote balance at the given price,
 * reserving the venue's reference taker fee when it is known so a 100% buy
 * stays within the balance once fees are deducted. An unknown venue/fee keeps
 * the gross-of-fee size (the fee schedule never fabricates a free lunch).
 * Null when it can't be sized (no balance / no usable price).
 */
export function quickSizeAmount(
  side: 'buy' | 'sell',
  fraction: number,
  freeBase: number | null,
  freeQuote: number | null,
  price: number,
  venue?: string | null,
): number | null {
  if (!(fraction > 0)) return null;
  if (side === 'sell') return freeBase != null && freeBase > 0 ? freeBase * fraction : null;
  if (!(price > 0) || freeQuote == null || !(freeQuote > 0)) return null;
  const feeBps = takerFeeBps(venue);
  const feeReserve = feeBps != null ? 1 + feeBps / 10_000 : 1;
  return (freeQuote * fraction) / (price * feeReserve);
}

/**
 * Return a balance only when the account snapshot carries fresh, inspectable
 * evidence. Missing rows, stale evidence and legacy receipt-less payloads stay
 * unknown instead of becoming a reassuring zero in the ticket.
 */
export function trustedFreeBalance(
  snapshot: Balances | null | undefined,
  asset: string,
  evaluatedAtMs: number = Date.now(),
): number | null {
  if (
    snapshot == null ||
    snapshot.provenance === 'unavailable' ||
    snapshot.receipt == null ||
    !isReceiptActionable(snapshot.receipt, evaluatedAtMs)
  ) {
    return null;
  }
  const free = snapshot.balances.find((balance) => balance.asset === asset.toUpperCase())?.free;
  return free != null && Number.isFinite(free) && free >= 0 ? free : null;
}

/**
 * Pre-flight cap warning for the ticket: the reason this order would be
 * rejected by the server's per-order or daily notional cap, or null when it
 * fits (or can't be estimated client-side — the server still checks).
 */
export function capBlockReason(
  notionalUsd: number | null,
  status: Pick<TradingStatus, 'maxOrderUsd' | 'dailyCapUsd' | 'dailyUsedUsd'> | null,
): string | null {
  if (notionalUsd == null || status == null) return null;
  if (status.maxOrderUsd != null && notionalUsd > status.maxOrderUsd) {
    return `~$${Math.round(notionalUsd)} exceeds the $${status.maxOrderUsd} per-order cap.`;
  }
  if (status.dailyCapUsd != null && status.dailyUsedUsd + notionalUsd > status.dailyCapUsd) {
    const left = Math.max(0, status.dailyCapUsd - status.dailyUsedUsd);
    return `~$${Math.round(notionalUsd)} exceeds today's remaining $${Math.round(left)} (daily cap $${status.dailyCapUsd}).`;
  }
  return null;
}
