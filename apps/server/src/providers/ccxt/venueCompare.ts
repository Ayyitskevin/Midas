import type { Exchange, Ticker } from 'ccxt';
import type { VenueQuote } from '@midas/shared';
import { partialEvidenceLimitation } from '@midas/shared';
import { ProviderError } from '../types';
import { withProviderReceipt } from '../receipts';
import { ccxtRegistry, compareExchangeIds, isKnownExchange, tickerPrice } from './helpers';
import { finiteOrNull, nonNegativeFiniteOrNull, positiveFiniteOrNull, sourceTimestampOrNull } from './coerce';
import { crossVenuePartialLimitation, withRowReceiptLimitation } from './crossVenue';
import type { CcxtCompareContext } from './context';

// Re-exported so this module's own import sites keep working; `ccxt/context.ts`
// holds the one definition.
export type { CcxtCompareContext as CcxtReadContext };

/**
 * Build the set of exchanges used for the multi-exchange compare from
 * MIDAS_CCXT_COMPARE. Pure construction — CcxtProvider.compareExchanges()
 * caches the result on the instance.
 */
export function buildCompareExchanges(): Exchange[] {
  const ids = compareExchangeIds(process.env.MIDAS_CCXT_COMPARE);
  const registry = ccxtRegistry();
  return ids
    .map((id) => {
      // Same allowlist the primary-exchange constructor uses: `registry[id]`
      // for an inherited Object member (constructor, toString, …) IS a
      // function, so the typeof guard alone is bypassable.
      if (!isKnownExchange(id)) return null;
      const Ctor = registry[id];
      return typeof Ctor === 'function' ? new Ctor({ enableRateLimit: true }) : null;
    })
    .filter((e): e is Exchange => e !== null);
}

export async function getExchangeQuotes(ctx: CcxtCompareContext, symbol: string): Promise<VenueQuote[]> {
  const s = ctx.normalize(symbol);
  const settled = await Promise.allSettled(
    ctx.compareExchanges().map(async (ex): Promise<VenueQuote> => {
      const t = await ex.fetchTicker(s);
      const price = tickerPrice(t);
      // Drop a venue whose ticker carries no usable price rather than
      // fabricating 0 — a fake 0 reads as a ~100% cross-venue discrepancy.
      if (price == null) {
        throw new ProviderError(`${ex.id} ${s}: ticker has no price`, 502, s, 'malformed-upstream');
      }
      const previousClose = positiveFiniteOrNull(t.previousClose) ?? positiveFiniteOrNull(t.open);
      const changePercent = finiteOrNull(t.percentage) ??
        (previousClose === null ? null : ((price - previousClose) / previousClose) * 100);
      if (changePercent === null) {
        throw new ProviderError(
          `${ex.id} ${s}: ticker has no change-percent evidence`,
          502,
          s,
          'malformed-upstream',
        );
      }
      const sourceTimestamp = sourceTimestampOrNull(t.timestamp);
      const sizes = t as Ticker & { bidVolume?: number | null; askVolume?: number | null };
      const value: VenueQuote = {
        exchange: ex.name ?? ex.id,
        price,
        bid: positiveFiniteOrNull(t.bid),
        ask: positiveFiniteOrNull(t.ask),
        bidSize: positiveFiniteOrNull(sizes.bidVolume),
        askSize: positiveFiniteOrNull(sizes.askVolume),
        changePercent,
        volume: nonNegativeFiniteOrNull(t.baseVolume),
        timestamp: sourceTimestamp,
      };
      return withProviderReceipt(ctx, value, {
        datasetFamily: 'venue-quotes',
        source: `ccxt:${ex.id}`,
        instrument: s,
        venue: ex.id,
        provenance: 'live',
        sourceAsOf: sourceTimestamp,
        units: {
          price: 'quote-asset', bid: 'quote-asset', ask: 'quote-asset',
          bidSize: 'base-asset', askSize: 'base-asset', volume: 'base-asset',
        },
        limitations: [
          ...(sourceTimestamp === null ? ['The venue ticker omitted its source timestamp.'] : []),
          ...(value.volume === null
            ? [partialEvidenceLimitation('The venue ticker omitted valid 24-hour base volume.')]
            : []),
          ...(value.bid === null || value.ask === null
            ? [partialEvidenceLimitation('The venue ticker omitted a valid bid or ask.')]
            : []),
          ...(value.bidSize === null || value.askSize === null
            ? [partialEvidenceLimitation('The venue ticker omitted executable top-of-book size.')]
            : []),
        ],
      }, ctx.now());
    }),
  );
  const values = settled
    .filter((r): r is PromiseFulfilledResult<VenueQuote> => r.status === 'fulfilled')
    .map((r) => r.value);
  const failures = settled.length - values.length;
  if (values.length === 0 && failures > 0) {
    const category = settled.every(
      (result) => result.status === 'rejected' &&
        result.reason instanceof ProviderError &&
        result.reason.dataHealthCategory === 'malformed-upstream',
    ) ? 'malformed-upstream' : 'upstream-unavailable';
    throw new ProviderError(`${ctx.name} ${s}: every configured venue quote read failed`, 502, s, category);
  }
  if (failures === 0) return values;
  const limitation = crossVenuePartialLimitation('quote', settled.length, values.length, failures);
  return values.map((value) => withRowReceiptLimitation(value, limitation, s));
}
