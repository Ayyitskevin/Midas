import type { FastifyInstance } from 'fastify';
import {
  computeFundingDispersion,
  computeOiConcentration,
  computeVenueArbRow,
  isInterval,
  isRange,
  withHonestNote,
} from '@midas/shared';
import type {
  CoinUniverse,
  FundingDispersionRow,
  FundingRow,
  HealthResponse,
  Interval,
  LiquidationEvent,
  LiquidationsFeed,
  OiConcentrationRow,
  Range,
  VenueArbRow,
} from '@midas/shared';
import type { DataProvider } from '../providers';
import { ProviderError } from '../providers';
import { config } from '../config';
import { createTtlCache } from '../ttlCache';
import { providerStreamsLive } from '../streaming';
import { normalizeLiquidationsMeta } from '../liquidationsHonesty';
import { firstStr, normalizeSymbol, normalizeQuote } from './shared';

const DEFAULT_INTERVAL: Interval = '1d';
const DEFAULT_RANGE: Range = '6mo';
const MAX_BATCH_SYMBOLS = 50;
// The cross-venue funding board reads N perps × M venues per sweep — expensive
// against a live exchange pool. Cache the assembled board briefly so concurrent
// users and client polling share one sweep per (quote, limit) window.
const FUNDING_DISPERSION_TTL_MS = 45_000;
// Same fan-out shape (N symbols × M venues) for the cross-venue arb screener,
// but top-of-book moves faster than funding — a shorter window keeps it live.
const VENUE_ARB_TTL_MS = 20_000;
// OI moves slowly (like funding), so the OI/crowding board reuses a 45s window.
const OI_CONCENTRATION_TTL_MS = 45_000;
// The coin-universe (market-cap reference) changes slowly — supplies barely move
// and only the price wiggles — so a 60s window is plenty and shares one build
// across concurrent users and client polling.
const COINS_TTL_MS = 60_000;

/**
 * Register one cross-venue board route (funding dispersion, venue arb, OI
 * concentration). All three share the same shape: for the top-N perps/symbols
 * by volume, fan a per-symbol upstream read out (N×M), compute one row each
 * (dropping any that throw), keep the rows that carry a real signal, and rank
 * them descending. They differ only in the upstream call + row compute
 * (`compute`) and the field that must be non-null and is the sort key (`rank`).
 * A short single-flight TTL cache (per (quote, limit)) bounds the fan-out cost.
 */
function registerVenueBoard<Row>(
  app: FastifyInstance,
  provider: DataProvider,
  opts: {
    path: string;
    ttlMs: number;
    /** Per-symbol upstream read + row compute; a throw drops the symbol. */
    compute: (symbol: string) => Promise<Row>;
    /** The signal field: a row is kept only when this is non-null, ranked desc. */
    rank: (row: Row) => number | null;
  },
): void {
  const cache = createTtlCache<Row[]>(opts.ttlMs);
  app.get<{ Querystring: { quote?: string; limit?: string } }>(opts.path, async (req) => {
    const quote = normalizeQuote(req.query.quote);
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 30) : 15;
    return cache.get(`${quote}|${limit}`, async () => {
      const rows = await provider.screen({ quote, sort: 'volume', limit });
      // Cast the resolved array: for a generic Row, TS widens Promise.all's
      // result to Awaited<Row>, which it can't prove equals Row. Every call
      // site's Row is a plain row object (never a promise), so this is sound.
      const board = (await Promise.all(
        rows.map(async (r): Promise<Row | null> => {
          try {
            return await opts.compute(r.symbol);
          } catch {
            return null;
          }
        }),
      )) as (Row | null)[];
      return board
        .filter((x): x is Row => x !== null && opts.rank(x) !== null)
        .sort((a, b) => (opts.rank(b) ?? 0) - (opts.rank(a) ?? 0));
    });
  });
}

/**
 * Market-data + provider-status routes: health, quotes, history, order books,
 * venue compare, derivatives, on-chain pools, funding-rate history, screener,
 * funding board, market-wide liquidations, search and news. All read-only
 * against the active provider.
 */
export function registerMarketRoutes(app: FastifyInstance, provider: DataProvider): void {

  app.get('/api/health', async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
      provider: provider.name,
      live: provider.live,
      // Distinct from `live`: the stream is synthetic for every non-ccxt provider
      // (yahoo has live REST quotes but no live stream), so the UI can avoid a
      // "LIVE" badge over synthetic prints.
      streamLive: providerStreamsLive(provider),
      time: Date.now(),
      version: config.version,
      demo: config.demoMode,
    };
  });

  app.get<{ Params: { symbol: string } }>('/api/quote/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    return provider.getQuote(symbol);
  });

  app.get<{ Querystring: { symbols?: string } }>('/api/quotes', async (req) => {
    const raw = firstStr(req.query.symbols);
    const symbols = Array.from(
      new Set(
        raw
          .split(',')
          .map(normalizeSymbol)
          .filter(Boolean),
      ),
    ).slice(0, MAX_BATCH_SYMBOLS);
    if (symbols.length === 0) return [];
    return provider.getQuotes(symbols);
  });

  app.get<{
    Params: { symbol: string };
    Querystring: { interval?: string; range?: string };
  }>('/api/history/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);

    const interval = req.query.interval && isInterval(req.query.interval)
      ? req.query.interval
      : DEFAULT_INTERVAL;
    const range = req.query.range && isRange(req.query.range)
      ? req.query.range
      : DEFAULT_RANGE;

    return provider.getHistory(symbol, { interval, range });
  });

  app.get<{
    Params: { symbol: string };
    Querystring: { depth?: string };
  }>('/api/orderbook/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    const depthRaw = Number(req.query.depth);
    const depth =
      Number.isFinite(depthRaw) && depthRaw > 0 ? Math.min(Math.floor(depthRaw), 100) : 25;
    return provider.getOrderBook(symbol, depth);
  });

  app.get<{ Params: { symbol: string } }>('/api/exchange-quotes/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    return provider.getExchangeQuotes(symbol);
  });

  // Per-venue funding & open interest for a perp across the compare set.
  app.get<{ Params: { symbol: string } }>('/api/venue-derivatives/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    return provider.getVenueDerivatives(symbol);
  });

  app.get<{ Params: { symbol: string } }>('/api/derivatives/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    return provider.getDerivatives(symbol);
  });

  app.get<{ Params: { symbol: string } }>('/api/onchain/:symbol', async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    return provider.getDexPools(symbol);
  });

  app.get<{ Params: { symbol: string }; Querystring: { limit?: string } }>(
    '/api/funding-history/:symbol',
    async (req) => {
      const symbol = normalizeSymbol(req.params.symbol);
      if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
      if (!provider.getFundingHistory) {
        throw new ProviderError('Funding history not supported by this provider', 501, symbol);
      }
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 90;
      return provider.getFundingHistory(symbol, limit);
    },
  );

  app.get<{ Querystring: { quote?: string; sort?: string; limit?: string } }>(
    '/api/screener',
    async (req) => {
      const limitRaw = Number(req.query.limit);
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50;
      return provider.screen({
        quote: firstStr(req.query.quote) || undefined,
        sort: firstStr(req.query.sort) || undefined,
        limit,
      });
    },
  );

  // Top-N coins by circulating market cap (rank / cap / supply / FDV). Reference
  // data an exchange feed can't produce (a CEX ticker has no circulating supply,
  // so `Quote.marketCap` is null on ccxt). Providers without getCoinUniverse
  // degrade to an honest 'unavailable' universe — never a fabricated cap; a live
  // reference source is env-gated. TTL-cached: supplies barely move.
  const coinsCache = createTtlCache<CoinUniverse>(COINS_TTL_MS);
  const getCoinUniverse = provider.getCoinUniverse?.bind(provider);
  app.get<{ Querystring: { limit?: string } }>('/api/coins', async (req) => {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 250) : 100;
    if (!getCoinUniverse) {
      // withHonestNote enforces the shared invariant: unavailable requires a note.
      return withHonestNote(
        {
          coins: [],
          provenance: 'unavailable' as const,
          source: provider.name,
          note: 'No market-cap reference source is configured for this provider.',
          asOf: null,
        },
        'No market-cap reference source is configured for this provider.',
      ) satisfies CoinUniverse;
    }
    return coinsCache.get(String(limit), async () =>
      withHonestNote(await getCoinUniverse(limit), 'Market-cap reference is not live.'),
    );
  });

  // Funding-rates board: the top-N perps by volume with their funding + OI.
  // Composed from screen() + getDerivatives() so every provider supports it.
  app.get<{ Querystring: { quote?: string; limit?: string } }>('/api/funding', async (req) => {
    const quote = (firstStr(req.query.quote) || 'USDT').toUpperCase();
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 60) : 30;
    const rows = await provider.screen({ quote, sort: 'volume', limit });
    const board = await Promise.all(
      rows.map(async (r): Promise<FundingRow | null> => {
        try {
          const d = await provider.getDerivatives(r.symbol);
          return {
            symbol: r.symbol,
            fundingRate: d.fundingRate,
            nextFundingTime: d.nextFundingTime,
            markPrice: d.markPrice,
            openInterestValue: d.openInterestValue,
          };
        } catch {
          return null;
        }
      }),
    );
    return board.filter((x): x is FundingRow => x !== null);
  });

  // The three cross-venue boards share one fan-out-behind-a-TTL-cache shape
  // (registerVenueBoard). Each keeps only rows whose signal field is non-null
  // (funding spread ≥ 2 venues / price dispersion ≥ 2 venues / OI ≥ 1 venue) and
  // ranks by it descending — supplied here as `compute` + `rank`.
  registerVenueBoard<FundingDispersionRow>(app, provider, {
    path: '/api/funding-dispersion',
    ttlMs: FUNDING_DISPERSION_TTL_MS,
    compute: async (symbol) => computeFundingDispersion(symbol, await provider.getVenueDerivatives(symbol)),
    rank: (row) => row.spreadBps,
  });

  registerVenueBoard<VenueArbRow>(app, provider, {
    path: '/api/venue-arb',
    ttlMs: VENUE_ARB_TTL_MS,
    compute: async (symbol) => computeVenueArbRow(symbol, await provider.getExchangeQuotes(symbol)),
    rank: (row) => row.dispersionBps,
  });

  registerVenueBoard<OiConcentrationRow>(app, provider, {
    path: '/api/oi-concentration',
    ttlMs: OI_CONCENTRATION_TTL_MS,
    compute: async (symbol) => computeOiConcentration(symbol, await provider.getVenueDerivatives(symbol)),
    rank: (row) => row.totalOiValue,
  });

  // Market-wide liquidations feed: the recent liquidations across the top-N
  // perps merged into one newest-first stream. Composed from screen() +
  // getDerivatives() so every provider supports it.
  app.get<{ Querystring: { quote?: string; limit?: string } }>('/api/liquidations', async (req) => {
    const quote = (firstStr(req.query.quote) || 'USDT').toUpperCase();
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 60) : 30;
    const rows = await provider.screen({ quote, sort: 'volume', limit });
    const perSymbol = await Promise.all(
      rows.map(async (r): Promise<LiquidationEvent[]> => {
        try {
          const d = await provider.getDerivatives(r.symbol);
          return d.recentLiquidations.map((l) => ({
            symbol: r.symbol,
            side: l.side,
            price: l.price,
            amount: l.amount,
            value: l.price * l.amount,
            timestamp: l.timestamp,
          }));
        } catch {
          return [];
        }
      }),
    );
    const events = perSymbol.flat().sort((a, b) => b.timestamp - a.timestamp).slice(0, 120);
    const feed: LiquidationsFeed = {
      events,
      meta: normalizeLiquidationsMeta(provider.liquidationsProvenance(), Date.now()),
    };
    return feed;
  });

  app.get<{ Querystring: { q?: string } }>('/api/search', async (req) => {
    const q = firstStr(req.query.q).trim().slice(0, 64);
    if (q.length === 0) return [];
    return provider.search(q);
  });

  app.get<{ Querystring: { symbol?: string } }>('/api/news', async (req) => {
    const symbol = normalizeSymbol(req.query.symbol) || undefined;
    return provider.getNews(symbol);
  });
}
