import type { FastifyInstance } from 'fastify';
import {
  computeFundingDispersion,
  computeOiConcentration,
  computeVenueArbRow,
  isInterval,
  isRange,
} from '@midas/shared';
import type {
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
import { firstStr, normalizeSymbol } from './shared';

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

/**
 * Market-data + provider-status routes: health, quotes, history, order books,
 * venue compare, derivatives, on-chain pools, funding-rate history, screener,
 * funding board, market-wide liquidations, search and news. All read-only
 * against the active provider.
 */
export function registerMarketRoutes(app: FastifyInstance, provider: DataProvider): void {
  // Per-provider, per-server-lifetime caches for the fan-out venue boards.
  const fundingDispersionCache = createTtlCache<FundingDispersionRow[]>(FUNDING_DISPERSION_TTL_MS);
  const venueArbCache = createTtlCache<VenueArbRow[]>(VENUE_ARB_TTL_MS);
  const oiConcentrationCache = createTtlCache<OiConcentrationRow[]>(OI_CONCENTRATION_TTL_MS);

  app.get('/api/health', async (): Promise<HealthResponse> => {
    return {
      status: 'ok',
      provider: provider.name,
      live: provider.live,
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

  // Cross-venue funding-dispersion board: for the top-N perps by volume, the
  // funding-rate spread across the compare set (the arb signal), ranked widest
  // first. Composed from screen() + getVenueDerivatives() so every provider
  // supports it; a short single-flight TTL cache bounds the N×M fan-out cost.
  app.get<{ Querystring: { quote?: string; limit?: string } }>('/api/funding-dispersion', async (req) => {
    const quote = (firstStr(req.query.quote) || 'USDT').toUpperCase();
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 30) : 15;
    return fundingDispersionCache.get(`${quote}|${limit}`, async () => {
      const rows = await provider.screen({ quote, sort: 'volume', limit });
      const board = await Promise.all(
        rows.map(async (r): Promise<FundingDispersionRow | null> => {
          try {
            return computeFundingDispersion(r.symbol, await provider.getVenueDerivatives(r.symbol));
          } catch {
            return null;
          }
        }),
      );
      // Keep only perps with a real cross-venue spread (≥ 2 reporting venues),
      // widest spread first — the funding-arb signal.
      return board
        .filter((x): x is FundingDispersionRow => x !== null && x.spreadBps !== null)
        .sort((a, b) => (b.spreadBps ?? 0) - (a.spreadBps ?? 0));
    });
  });

  // Cross-venue arb screener: for the top-N symbols by volume, how far the
  // price disagrees across the compare set — the sell-here/buy-here legs, the
  // spread (positive ⇒ a crossed, gross-of-fees arb), ranked by dispersion.
  // Composed from screen() + getExchangeQuotes(); a short single-flight TTL
  // cache bounds the N×M fan-out cost.
  app.get<{ Querystring: { quote?: string; limit?: string } }>('/api/venue-arb', async (req) => {
    const quote = (firstStr(req.query.quote) || 'USDT').toUpperCase();
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 30) : 15;
    return venueArbCache.get(`${quote}|${limit}`, async () => {
      const rows = await provider.screen({ quote, sort: 'volume', limit });
      const board = await Promise.all(
        rows.map(async (r): Promise<VenueArbRow | null> => {
          try {
            return computeVenueArbRow(r.symbol, await provider.getExchangeQuotes(r.symbol));
          } catch {
            return null;
          }
        }),
      );
      // Keep only symbols quoted on ≥ 2 venues (a real dispersion), widest first.
      return board
        .filter((x): x is VenueArbRow => x !== null && x.dispersionBps !== null)
        .sort((a, b) => (b.dispersionBps ?? 0) - (a.dispersionBps ?? 0));
    });
  });

  // Cross-venue OI / crowding board: for the top-N perps by volume, aggregate
  // open interest across the compare set + how concentrated it is on one venue
  // (top-venue share, Herfindahl). Reuses the getVenueDerivatives() fan-out (as
  // the funding board does) with its own short single-flight TTL cache.
  app.get<{ Querystring: { quote?: string; limit?: string } }>('/api/oi-concentration', async (req) => {
    const quote = (firstStr(req.query.quote) || 'USDT').toUpperCase();
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 30) : 15;
    return oiConcentrationCache.get(`${quote}|${limit}`, async () => {
      const rows = await provider.screen({ quote, sort: 'volume', limit });
      const board = await Promise.all(
        rows.map(async (r): Promise<OiConcentrationRow | null> => {
          try {
            return computeOiConcentration(r.symbol, await provider.getVenueDerivatives(r.symbol));
          } catch {
            return null;
          }
        }),
      );
      // Keep perps with OI reported on ≥ 1 venue, biggest total OI first.
      return board
        .filter((x): x is OiConcentrationRow => x !== null && x.totalOiValue !== null)
        .sort((a, b) => (b.totalOiValue ?? 0) - (a.totalOiValue ?? 0));
    });
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
      meta: { ...provider.liquidationsProvenance(), asOf: Date.now() },
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
