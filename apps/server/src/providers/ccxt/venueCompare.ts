import type { Exchange, Ticker } from 'ccxt';
import type { VenueDerivatives, VenueQuote, VenueScreen, VenueScreenRow } from '@midas/shared';
import { partialEvidenceLimitation } from '@midas/shared';
import { ProviderError } from '../types';
import type { ScreenerOptions } from '../types';
import { withProviderReceipt } from '../receipts';
import { ccxtRegistry, compareExchangeIds, isKnownExchange, tickerPrice } from './helpers';
import { readFunding, readOpenInterest, toPerpSymbol } from './helpers';
import { fundingOmission, openInterestOmission } from './derivatives';
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

export async function getVenueDerivatives(ctx: CcxtCompareContext, symbol: string): Promise<VenueDerivatives[]> {
  const perp = toPerpSymbol(ctx.normalize(symbol));
  const settled = await Promise.allSettled(
    ctx.compareExchanges().map(async (ex): Promise<VenueDerivatives> => {
      // Sequential (funding then OI), matching the original single-venue read.
      const funding = await readFunding(ex, perp);
      const oi = await readOpenInterest(ex, perp);
      if ((funding.state === 'error' && oi.state !== 'ok') || (oi.state === 'error' && funding.state !== 'ok')) {
        throw new ProviderError(`${ex.id} ${perp}: derivatives upstream read failed`, 502, perp);
      }
      const sourceTimes = [
        ...(funding.state === 'ok' ? [funding.sourceAsOf] : []),
        ...(oi.state === 'ok' ? [oi.sourceAsOf] : []),
      ];
      const sourceTimestamp = sourceTimes.length > 0 && sourceTimes.every((timestamp) => timestamp !== null)
        ? Math.min(...sourceTimes as number[])
        : null;
      const value: VenueDerivatives = {
        exchange: ex.name ?? ex.id,
        fundingRate: funding.fundingRate,
        fundingIntervalHours: funding.fundingIntervalHours,
        nextFundingTime: funding.nextFundingTime,
        markPrice: funding.markPrice,
        openInterestValue: oi.openInterestValue,
        timestamp: sourceTimestamp,
      };
      const hasEvidence =
        value.fundingRate !== null || value.openInterestValue !== null ||
        value.markPrice !== null || value.nextFundingTime !== null;
      if (!hasEvidence && (funding.state === 'ok' || oi.state === 'ok')) {
        throw new ProviderError(
          `${ex.id} ${perp}: malformed empty derivatives response`,
          502,
          perp,
          'malformed-upstream',
        );
      }
      return withProviderReceipt(ctx, value, {
        datasetFamily: 'venue-derivatives',
        source: `ccxt:${ex.id}`,
        instrument: perp,
        venue: ex.id,
        provenance: 'live',
        sourceAsOf: sourceTimestamp,
        units: {
          fundingRate: 'fraction-per-interval', markPrice: 'quote-asset',
          openInterestValue: 'quote-asset',
        },
        limitations: [
          ...(funding.state === 'unsupported'
            ? [partialEvidenceLimitation('The venue does not support unified funding-rate reads.')]
            : []),
          ...(funding.state === 'error'
            ? [partialEvidenceLimitation('The venue funding-rate upstream read failed.')]
            : []),
          ...(fundingOmission(funding) ? [fundingOmission(funding)!] : []),
          ...(oi.state === 'unsupported'
            ? [partialEvidenceLimitation('The venue does not support unified open-interest reads.')]
            : []),
          ...(oi.state === 'error'
            ? [partialEvidenceLimitation('The venue open-interest upstream read failed.')]
            : []),
          ...(openInterestOmission(oi) ? [openInterestOmission(oi)!] : []),
          ...(sourceTimestamp === null ? ['The venue omitted source timestamps for derivatives evidence.'] : []),
        ],
      }, ctx.now());
    }),
  );
  // Keep venues that reported any perp field (funding, OI, mark or next-funding);
  // drop only the all-null spot-only venues. A venue can answer fetchFundingRate
  // with a markPrice/next time but a null fundingRate (the ccxt fields are
  // independently optional), so don't gate solely on fundingRate/OI.
  const values = settled
    .filter((r): r is PromiseFulfilledResult<VenueDerivatives> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter(
      (v) =>
        v.fundingRate !== null ||
        v.openInterestValue !== null ||
        v.markPrice !== null ||
        v.nextFundingTime !== null,
    );
  if (values.length === 0 && settled.some((result) => result.status === 'rejected')) {
    const category = settled.every(
      (result) => result.status === 'rejected' &&
        result.reason instanceof ProviderError &&
        result.reason.dataHealthCategory === 'malformed-upstream',
    ) ? 'malformed-upstream' : 'upstream-unavailable';
    throw new ProviderError(`${ctx.name} ${perp}: every configured venue derivatives read failed`, 502, perp, category);
  }
  const failures = settled.filter((result) => result.status === 'rejected').length;
  if (values.length === settled.length) return values;
  const limitation = crossVenuePartialLimitation('derivatives', settled.length, values.length, failures);
  return values.map((value) => withRowReceiptLimitation(value, limitation, perp));
}

/**
 * Screen every configured venue in one sweep.
 *
 * Cheap by construction: `fetchTickers()` returns a venue's whole ticker set
 * in ONE call, so this costs one request per venue — not one per symbol. That
 * is why a cross-venue screener is affordable where a cross-venue per-symbol
 * board would not be.
 *
 * `Promise.allSettled`: a venue that fails drops to `available: false` and
 * shows up as reduced coverage rather than failing the board.
 */
export async function getVenueScreen(ctx: CcxtCompareContext, opts: ScreenerOptions): Promise<VenueScreen[]> {
  const quote = (opts.quote ?? 'USDT').toUpperCase();
  const settled = await Promise.allSettled(
    ctx.compareExchanges().map(async (ex): Promise<VenueScreen> => {
      // No explicit loadMarkets: ccxt loads them inside fetchTickers, and the
      // sibling getExchangeQuotes fan-out doesn't either. One fewer upstream
      // call per venue, per refresh.
      const tickers = await ex.fetchTickers();
      const rows: VenueScreenRow[] = [];
      let newest: number | null = null;
      for (const [sym, t] of Object.entries(tickers)) {
        if (!sym.endsWith(`/${quote}`)) continue;
        const price = tickerPrice(t);
        // Skip pairs with no usable price rather than admitting a 0 that
        // would read as a 100% cross-venue dispersion.
        if (price == null) continue;
        const timestamp = sourceTimestampOrNull(t.timestamp);
        if (timestamp !== null && (newest === null || timestamp > newest)) newest = timestamp;
        rows.push({
          symbol: sym,
          name: sym,
          price,
          // Unlike the single-venue screener this keeps a row whose 24h change
          // the venue omitted: the symbol still contributes price, volume and
          // breadth. Null stays null — a 0 here would read as "flat", a claim
          // the venue never made.
          changePercent: finiteOrNull(t.percentage),
          volume: nonNegativeFiniteOrNull(t.baseVolume),
          quoteVolume: nonNegativeFiniteOrNull(t.quoteVolume),
        });
      }
      return withProviderReceipt(ctx, {
        exchange: ex.id,
        available: true,
        rows,
        timestamp: newest,
      }, {
        datasetFamily: 'venue-screener',
        source: `ccxt:${ex.id}`,
        venue: ex.id,
        provenance: 'live',
        sourceAsOf: newest,
        coverage: `${rows.length} ${quote} pair(s) from the venue ticker set`,
        units: { price: 'quote-asset', volume: 'base-asset', quoteVolume: 'quote-asset' },
        limitations: [
          'Exchange-reported 24h volume is widely documented as inflated; treat it as a scale signal, not a verified total.',
        ],
      }, ctx.now());
    }),
  );
  const values = settled
    .filter((result): result is PromiseFulfilledResult<VenueScreen> => result.status === 'fulfilled')
    .map((result) => result.value);
  if (values.length === 0 && settled.length > 0) {
    throw new ProviderError(`${ctx.name}: every configured venue screener read failed`, 502);
  }
  return values;
}
