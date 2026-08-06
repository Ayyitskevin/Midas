import type { Exchange } from 'ccxt';
import type {
  Liquidation,
  LiquidationsProvenance,
  LiquidationSourceCapability,
  VenueLiquidations,
} from '@midas/shared';
import { partialEvidenceLimitation } from '@midas/shared';
import { ProviderError } from '../types';
import { providerReceipt, providerUnavailableReceipt, withProviderReceipt } from '../receipts';
import { toPerpSymbol } from './helpers';
import { positiveFiniteOrNull, sourceTimestampOrNull } from './coerce';
import { crossVenuePartialLimitation, withRowReceiptLimitation } from './crossVenue';
import type { CcxtCompareContext } from './context';

// Re-exported so this module's own import sites keep working; `ccxt/context.ts`
// holds the one definition.
export type { CcxtCompareContext as CcxtReadContext };

/**
 * The one caveat every publishing venue carries: public liquidation streams are
 * throttled and documented to under-report many-fold. Shared by the feed-level
 * provenance note and each per-source capability so they cannot drift apart.
 */
const LIQUIDATION_THROTTLE_NOTE =
  'Exchange liquidation streams are throttled (~1/sec) and are widely documented to under-report; treat sizes as indicative, not exact.';

/**
 * Parse a ccxt `fetchLiquidations` response into the unified shape.
 *
 * Shared by the single-venue derivatives snapshot and the cross-venue fan-out so
 * the two cannot drift into disagreeing about what counts as a usable event.
 *
 * ccxt's unified liquidation shape has no top-level `side` — it lives,
 * venue-specifically, inside `info`. A row whose side, price, amount or
 * timestamp cannot be read is dropped and counted, never defaulted: guessing
 * 'buy' would render every liquidation as a short.
 */
export function parseLiquidationRows(response: unknown): { recent: Liquidation[]; omitted: number } {
  if (!Array.isArray(response)) throw new Error('malformed liquidation response');
  const rows = response as Array<{
    side?: string;
    price?: number;
    amount?: number;
    contracts?: number;
    timestamp?: number;
    info?: { side?: string };
  }>;
  const recent: Liquidation[] = [];
  let omitted = 0;
  for (const l of rows.slice(0, 20)) {
    const rawSide = (l.side ?? l.info?.side ?? '').toString().toLowerCase();
    const side = rawSide === 'sell' ? ('sell' as const) : rawSide === 'buy' ? ('buy' as const) : null;
    const price = positiveFiniteOrNull(l.price);
    const amount = positiveFiniteOrNull(l.amount ?? l.contracts);
    const timestamp = sourceTimestampOrNull(l.timestamp);
    if (!side || price === null || amount === null || timestamp === null) {
      omitted += 1;
      continue;
    }
    recent.push({ side, price, amount, timestamp });
  }
  return { recent, omitted };
}

/**
 * Every venue this provider is configured to read liquidations from — the
 * primary exchange plus the compare set. This is the honest denominator of
 * source coverage: the feed currently samples only the primary, and saying so
 * requires knowing what the other configured venues are.
 *
 * Capability only, no network: `compareExchanges()` constructs ccxt
 * instances from the local registry and `has['fetchLiquidations']` is a static
 * declaration, so this stays safe to call from a synchronous provenance read.
 */
export function liquidationSourceCapabilities(ctx: CcxtCompareContext): LiquidationSourceCapability[] {
  const seen = new Set<string>();
  const out: LiquidationSourceCapability[] = [];
  const push = (id: string, exchange: Exchange) => {
    const key = id.trim().toLowerCase();
    if (key === '' || seen.has(key)) return;
    seen.add(key);
    const available = Boolean(exchange.has['fetchLiquidations']);
    out.push({
      source: id,
      available,
      // Capability-derived: a venue that publishes a public liquidation feed
      // publishes a throttled one. Never inferred from observed event counts.
      throttled: available,
      synthetic: false,
      note: available ? LIQUIDATION_THROTTLE_NOTE : `${id} exposes no public liquidation feed.`,
    });
  };
  push(ctx.exchangeId, ctx.exchange);
  try {
    for (const exchange of ctx.compareExchanges()) push(exchange.id, exchange);
  } catch {
    // A malformed MIDAS_CCXT_COMPARE must not take down the liquidations
    // feed; the primary venue alone is still an honest (narrower) denominator.
  }
  return out;
}

/**
 * Recent public liquidations for one perp across the configured venue set.
 *
 * Cost is bounded by capability, not by policy: a venue that does not declare
 * `fetchLiquidations` returns `available: false` with **zero network cost**,
 * and on the default compare set most venues are in exactly that state. The
 * fan-out is therefore far narrower than N venues in practice, and the route's
 * single-flight TTL collapses concurrent callers onto one sweep.
 *
 * `Promise.allSettled` per venue: one dead venue degrades to `available:false`
 * and is visible as reduced coverage. It never fails the feed — losing five
 * good venues because a sixth timed out is the opposite of honest.
 */
export async function getVenueLiquidations(ctx: CcxtCompareContext, symbol: string): Promise<VenueLiquidations[]> {
  const perp = toPerpSymbol(ctx.normalize(symbol));
  const settled = await Promise.allSettled(
    ctx.compareExchanges().map(async (ex): Promise<VenueLiquidations> => {
      const available = Boolean(ex.has['fetchLiquidations']);
      if (!available) {
        return withProviderReceipt(ctx, {
          exchange: ex.id,
          available: false,
          liquidations: [],
          timestamp: null,
        }, {
          datasetFamily: 'liquidations',
          source: `ccxt:${ex.id}`,
          instrument: perp,
          venue: ex.id,
          provenance: 'unavailable',
          sourceAsOf: null,
          coverage: 'venue publishes no public liquidation feed',
          units: { price: 'quote-asset', amount: 'base-asset' },
          note: `${ex.id} exposes no public liquidation feed.`,
        }, ctx.now());
      }
      const { recent, omitted } = parseLiquidationRows(
        await ex.fetchLiquidations(perp, undefined, 20),
      );
      const sourceAsOf = recent.length > 0
        ? Math.max(...recent.map((liquidation) => liquidation.timestamp))
        : null;
      return withProviderReceipt(ctx, {
        exchange: ex.id,
        available: true,
        liquidations: recent,
        timestamp: sourceAsOf,
      }, {
        datasetFamily: 'liquidations',
        source: `ccxt:${ex.id}`,
        instrument: perp,
        venue: ex.id,
        provenance: 'live',
        sourceAsOf,
        coverage: `${recent.length} recent public liquidation event(s)`,
        units: { price: 'quote-asset', amount: 'base-asset' },
        limitations: [
          ...(omitted > 0
            ? [partialEvidenceLimitation(`${omitted} malformed liquidation row(s) were omitted.`)]
            : []),
          LIQUIDATION_THROTTLE_NOTE,
        ],
      }, ctx.now());
    }),
  );
  const values = settled
    .filter((result): result is PromiseFulfilledResult<VenueLiquidations> => result.status === 'fulfilled')
    .map((result) => result.value);
  const failures = settled.length - values.length;
  if (values.length === 0 && settled.length > 0) {
    throw new ProviderError(
      `${ctx.name} ${perp}: every configured venue liquidation read failed`,
      502,
      perp,
    );
  }
  if (failures === 0) return values;
  const limitation = crossVenuePartialLimitation('liquidations', settled.length, values.length, failures);
  return values.map((value) => withRowReceiptLimitation(value, limitation, perp));
}

export function liquidationsProvenance(ctx: CcxtCompareContext): LiquidationsProvenance {
  const sources = liquidationSourceCapabilities(ctx);
  const publishing = sources.filter((capability) => capability.available);
  // Availability is now a property of the configured SET, not the primary
  // venue. The default primary (Binance) publishes nothing, but the compare
  // set may — gating the fan-out on the primary alone is what made a stock
  // install show an empty feed while venues with real data sat unread.
  const available = publishing.length > 0;
  const primaryPublishes = Boolean(ctx.exchange.has['fetchLiquidations']);
  const note = !available
    ? `No configured venue exposes a public liquidation feed (e.g. Binance removed its public stream in 2021) — showing none. Point MIDAS_CCXT_EXCHANGE or MIDAS_CCXT_COMPARE at venues that publish liquidations.`
    : primaryPublishes
      ? LIQUIDATION_THROTTLE_NOTE
      : `${ctx.exchangeId} publishes no public liquidation feed; events come from ${publishing.length} other configured venue(s). ${LIQUIDATION_THROTTLE_NOTE}`;
  const receipt = available
    ? providerReceipt(ctx, {
        datasetFamily: 'liquidations',
        venue: ctx.exchangeId,
        provenance: 'live',
        sourceAsOf: null,
        coverage: 'public liquidation-feed capability declaration',
        units: { price: 'quote-asset', amount: 'base-asset' },
        note,
      }, ctx.now())
    : providerUnavailableReceipt(ctx, {
        datasetFamily: 'liquidations',
        venue: ctx.exchangeId,
        coverage: 'public liquidation-feed capability declaration',
        units: { price: 'quote-asset', amount: 'base-asset' },
        note,
      }, ctx.now());
  return {
    source: ctx.name,
    available,
    note,
    // Every venue the fan-out will attempt — the denominator of coverage.
    sources,
    // The primary venue: the M2 denominator, i.e. what a single-source feed
    // would have shown. Not a claim that only this venue is read.
    sampledSource: ctx.exchangeId,
    receipt,
  };
}
