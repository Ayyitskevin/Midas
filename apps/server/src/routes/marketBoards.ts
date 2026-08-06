import type { FastifyInstance } from 'fastify';
import {
  computeLiquidationsAggregate,
  partialEvidenceLimitation,
  withDataReceipt,
} from '@midas/shared';
import type {
  FundingRow,
  LiquidationsFeed,
  VenueLiquidations,
  DataReceipt,
} from '@midas/shared';
import type { DataProvider } from '../providers';
import { createTtlCache } from '../ttlCache';
import { normalizeLiquidationsMeta } from '../liquidationsHonesty';
import { normalizeQuote } from './shared';
import type { DataStatusTracker } from '../dataStatus';
import { DATA_ROUTE_PATHS } from '../dataCoverage';
import {
  attachProviderReceipt,
  attachProviderReceiptRows,
  deriveRouteReceipt,
  trackProviderCall,
  transportDerivedReceipt,
} from './dataTrust';
import { serveBoard, type CachedBoard, type CachedReceiptPayload } from './boards';

// The funding board fans screen() + getDerivatives() out over N perps per
// request — the same cost shape as the venue boards, so it gets a short
// single-flight window too (funding itself moves slowly).
const FUNDING_TTL_MS = 15_000;
// The market-wide liquidations feed has the same N-perp fan-out; a 15s window
// collapses client polling into one upstream sweep.
const LIQUIDATIONS_TTL_MS = 15_000;

/** Dependencies shared by the composed cross-symbol boards. */
export interface MarketBoardDeps {
  provider: DataProvider;
  dataStatus: DataStatusTracker;
}

export function registerFundingBoard(app: FastifyInstance, deps: MarketBoardDeps): void {
  const { provider, dataStatus } = deps;

  // Funding-rates board: the top-N perps by volume with their funding + OI.
  // Composed from screen() + getDerivatives() so every provider supports it.
  // Same fan-out cost shape as the venue boards, so it sits behind the same
  // single-flight TTL cache (per (quote, limit)) and returns the shared
  // BoardEnvelope — dropped symbols flip meta.partial, never vanish silently.
  const fundingCache = createTtlCache<CachedBoard<FundingRow & { receipt: DataReceipt }>>(FUNDING_TTL_MS);
  app.get<{ Querystring: { quote?: string; limit?: string } }>(DATA_ROUTE_PATHS.funding, async (req) => {
    const quote = normalizeQuote(req.query.quote);
    const limitRaw = Number(req.query.limit);
    // Floor then clamp to ≥ 1: limit=0.5 would otherwise silently empty the board.
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.max(1, Math.floor(limitRaw)), 60) : 30;
    return serveBoard(
      provider,
      'funding',
      fundingCache,
      `${quote}|${limit}`,
      String(req.id),
      dataStatus,
      async () => {
        const rows = await trackProviderCall(provider, 'funding', dataStatus, () =>
          provider.screen({ quote, sort: 'volume', limit }),
        );
        let failed = 0;
        const board = await Promise.all(
          rows.map(async (r): Promise<(FundingRow & { receipt: DataReceipt }) | null> => {
            try {
              const raw = await trackProviderCall(provider, 'derivatives', dataStatus, () =>
                provider.getDerivatives(r.symbol),
              );
              const d = attachProviderReceipt(
                provider,
                'derivatives',
                raw,
                String(req.id),
                dataStatus,
                undefined,
                undefined,
                { instrument: r.symbol },
              );
              const row: FundingRow = {
                symbol: r.symbol,
                fundingRate: d.fundingRate,
                fundingIntervalHours: d.fundingIntervalHours ?? null,
                nextFundingTime: d.nextFundingTime,
                markPrice: d.markPrice,
                openInterestValue: d.openInterestValue,
              };
              const limitations = [
                ...(d.fundingRate == null ? [partialEvidenceLimitation('Funding rate unavailable.')] : []),
                ...(d.fundingIntervalHours == null ? [partialEvidenceLimitation('Funding interval unavailable.')] : []),
                ...(d.markPrice == null ? [partialEvidenceLimitation('Mark price unavailable.')] : []),
                ...(d.openInterestValue == null
                  ? [partialEvidenceLimitation('Open-interest value unavailable.')]
                  : []),
              ];
              const receipt = deriveRouteReceipt(
                provider,
                {
                  family: 'funding',
                  instrument: r.symbol,
                  coverage: 'Top-perpetual funding board row.',
                  inputReceipts: [d.receipt],
                  methodology: {
                    id: 'midas.funding-board-row',
                    version: '1.0',
                    formula: 'Projection of provider funding, cadence, mark and open-interest fields.',
                  },
                  units: {
                    fundingRate: 'fraction/settlement',
                    fundingIntervalHours: 'hours',
                    markPrice: 'quote currency',
                    openInterestValue: 'quote currency',
                  },
                  limitations,
                  traceId: String(req.id),
                  expectedCadenceMs: FUNDING_TTL_MS,
                  maxAgeMs: FUNDING_TTL_MS * 2,
                },
                dataStatus,
                limitations.length > 0 ? 'partial' : null,
              );
              return withDataReceipt(row, receipt);
            } catch {
              failed += 1;
              return null;
            }
          }),
        );
        return {
          rows: board.filter((x): x is FundingRow & { receipt: DataReceipt } => x !== null),
          failed,
          total: rows.length,
        };
      },
    );
  });
}

export function registerLiquidationsBoard(app: FastifyInstance, deps: MarketBoardDeps): void {
  const { provider, dataStatus } = deps;

  // Market-wide liquidations feed: the recent liquidations across the top-N
  // perps merged into one newest-first stream. Composed from screen() +
  // getDerivatives() so every provider supports it. Cached per quote on a
  // short single-flight window keyed by quote + requested fan-out. The merged
  // feed is capped at 120 events; meta.asOf always reports the sweep's real age.
  const liquidationsCache = createTtlCache<
    CachedReceiptPayload<LiquidationsFeed & { receipt: DataReceipt }>
  >(LIQUIDATIONS_TTL_MS);
  app.get<{ Querystring: { quote?: string; limit?: string } }>(DATA_ROUTE_PATHS.liquidations, async (req) => {
    const quote = normalizeQuote(req.query.quote);
    const limitRaw = Number(req.query.limit);
    // Floor then clamp to ≥ 1: limit=0.5 would otherwise silently empty the feed.
    // The ceiling matches the cross-venue boards (30) rather than the old
    // single-source 60: this route now fans each symbol across the configured
    // venue set, so it carries their cost shape and gets their bound.
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.max(1, Math.floor(limitRaw)), 30) : 30;
    let computed = false;
    const entry = await liquidationsCache.get(`${quote}|${limit}`, async () => {
      computed = true;
      const provenance = attachProviderReceipt(
        provider,
        'liquidations',
        provider.liquidationsProvenance(),
        String(req.id),
        dataStatus,
      );
      // The provider's liquidation capability declaration is authoritative.
      // Do not turn unrelated funding/OI snapshots into a liquidation feed
      // when that provider explicitly says no public event source exists.
      const rows = provenance.available
        ? await trackProviderCall(provider, 'liquidations', dataStatus, () =>
            provider.screen({ quote, sort: 'volume', limit }),
          )
        : [];
      let failed = 0;
      // Each symbol is read across the whole configured venue set. A symbol
      // whose entire fan-out fails drops out and is counted; a single venue
      // failing inside a fan-out is the provider's business and shows up as
      // reduced coverage, not as a lost symbol.
      const perSymbol = await Promise.all(
        rows.map(async (r): Promise<{ venues: VenueLiquidations[]; symbol: string } | null> => {
          try {
            const raw = await trackProviderCall(provider, 'liquidations', dataStatus, () =>
              provider.getVenueLiquidations(r.symbol),
            );
            const venues = attachProviderReceiptRows(
              provider,
              'liquidations',
              raw,
              String(req.id),
              dataStatus,
              undefined,
              undefined,
              { instrument: r.symbol },
            );
            return { symbol: r.symbol, venues };
          } catch {
            failed += 1;
            return null;
          }
        }),
      );
      const successful = perSymbol.filter(
        (result): result is { venues: VenueLiquidations[]; symbol: string } => result !== null,
      );
      // Union, never average and never deduplicated: each venue's liquidations
      // are its own disjoint real events. See computeLiquidationsAggregate.
      const aggregate = computeLiquidationsAggregate(successful, provenance.sampledSource ?? null);
      const events = aggregate.events.slice(0, 120);
      const venueReceipts = successful.flatMap((result) =>
        result.venues.map((venue) => venue.receipt).filter((r): r is DataReceipt => r !== undefined),
      );
      const limitations = [
        ...(failed > 0
          ? [partialEvidenceLimitation(`${failed} of ${rows.length} symbol liquidation fan-out(s) failed.`)]
          : []),
        ...(aggregate.events.length > events.length
          ? [
              partialEvidenceLimitation(
                `${aggregate.events.length - events.length} older event(s) beyond the 120-event display cap were dropped.`,
              ),
            ]
          : []),
        'Public exchange liquidation feeds may be throttled or incomplete; event totals are not exhaustive.',
        'Cross-venue totals are a union of independently throttled feeds — a lower bound, never the market total.',
      ];
      const receipt = deriveRouteReceipt(
        provider,
        {
          family: 'liquidations',
          coverage:
            `${rows.length} screened perpetual symbol(s) fanned across ` +
            `${aggregate.observations.length} venue(s); latest 120 events retained.`,
          inputReceipts: [provenance.receipt, ...venueReceipts],
          methodology: {
            id: 'midas.liquidations-feed',
            version: '2.0',
            formula:
              'eventNotional = observedPrice * observedBaseAmount; ' +
              'cross-venue union (never averaged or deduplicated); merge newest-first; retain 120; ' +
              'multiple = totalValue / referenceVenueValue (lower bound)',
          },
          units: { price: 'quote currency', amount: 'base asset', value: 'quote currency' },
          limitations,
          traceId: String(req.id),
          expectedCadenceMs: LIQUIDATIONS_TTL_MS,
          maxAgeMs: LIQUIDATIONS_TTL_MS * 2,
          cache: { status: 'miss', ageMs: 0 },
        },
        dataStatus,
        failed > 0 ? 'partial' : null,
      );
      // One observation per venue actually read, counted pre-retention: the
      // 120-event display cap says nothing about what a venue published. A
      // venue never reached stays absent here and reports "not sampled" — a
      // different claim from "sampled, produced zero".
      const meta = withDataReceipt(
        normalizeLiquidationsMeta(
          provenance,
          Date.now(),
          aggregate.observations,
          undefined,
          {
            totalValue: aggregate.totalValue,
            referenceSource: aggregate.referenceSource,
            referenceValue: aggregate.referenceValue,
            multiple: aggregate.multiple,
          },
        ),
        receipt,
      );
      const feed = withDataReceipt({ events, meta }, receipt);
      return { payload: feed, storedAt: Date.now() };
    });
    const now = Date.now();
    const transported = transportDerivedReceipt(
      provider,
      entry.payload,
      String(req.id),
      dataStatus,
      { status: computed ? 'miss' : 'hit', ageMs: computed ? 0 : Math.max(0, now - entry.storedAt) },
      now,
    );
    return { ...transported, meta: { ...transported.meta, receipt: transported.receipt } };
  });
}
