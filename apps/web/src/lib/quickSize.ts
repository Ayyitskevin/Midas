import type { TradingStatus } from '@midas/shared';

/**
 * Sizing + cap helpers for the order ticket. Pure so the sizing math and the
 * client-side cap warnings are unit-tested; the server re-enforces both caps
 * authoritatively on every placement regardless of what the client shows.
 */

/**
 * Amount for a %-of-balance quick-size: a sell sizes from the free base asset;
 * a buy converts a fraction of the free quote balance at the given price.
 * Null when it can't be sized (no balance / no usable price).
 */
export function quickSizeAmount(
  side: 'buy' | 'sell',
  fraction: number,
  freeBase: number,
  freeQuote: number,
  price: number,
): number | null {
  if (!(fraction > 0)) return null;
  if (side === 'sell') return freeBase > 0 ? freeBase * fraction : null;
  if (!(price > 0) || !(freeQuote > 0)) return null;
  return (freeQuote * fraction) / price;
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
