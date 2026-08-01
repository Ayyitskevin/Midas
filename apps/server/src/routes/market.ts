import type { FastifyInstance } from 'fastify';
import {
  computeFundingDispersion,
  computeOiConcentration,
  computeVenueArbRow,
  isInterval,
  isOiDeltaWindow,
  isRange,
  withHonestNote,
} from '@midas/shared';
import type {
  BoardEnvelope,
  BoardProvenance,
  CoinUniverse,
  DvolSnapshot,
  DvolSymbol,
  FundingDispersionRow,
  FundingRow,
  HealthResponse,
  Interval,
  LiquidationEvent,
  LiquidationsFeed,
  OiConcentrationRow,
  OiDelta,
  OiDeltaWindow,
  OptionsChain,
  Range,
  ScreenerRow,
  TermStructure,
  VenueArbRow,
} from '@midas/shared';
import type { DataProvider } from '../providers';
import { ProviderError } from '../providers';
import { config } from '../config';
import { createTtlCache, type TtlCache } from '../ttlCache';
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
// The funding board fans screen() + getDerivatives() out over N perps per
// request — the same cost shape as the venue boards, so it gets a short
// single-flight window too (funding itself moves slowly).
const FUNDING_TTL_MS = 15_000;
// The market-wide liquidations feed has the same N-perp fan-out; a 15s window
// collapses client polling into one upstream sweep.
const LIQUIDATIONS_TTL_MS = 15_000;
// The screener re-reads the full ticker set per request; quote/price data is
// fresh enough on a 15s window shared across concurrent users.
const SCREENER_TTL_MS = 15_000;
// The screener sort keys the providers' sortScreener understands; anything
// else would silently fall back to volume order, so it's rejected at the edge.
const SCREENER_SORTS = new Set(['volume', 'change', 'price']);
// The coin-universe (market-cap reference) changes slowly — supplies barely move
// and only the price wiggles — so a 60s window is plenty and shares one build
// across concurrent users and client polling.
const COINS_TTL_MS = 60_000;
// Deribit option-chain / DVOL reads fan out over a whole chain or a 40-day
// index history; 60s collapses client polling into one upstream read. Dated
// futures tick faster, so the term structure gets a 30s window.
const OPTIONS_TTL_MS = 60_000;
const TERM_STRUCTURE_TTL_MS = 30_000;
// OI-delta reads an OI history + an OHLCV series per (symbol, window); 60s
// collapses client polling into one upstream pair of reads.
const OI_DELTA_TTL_MS = 60_000;
// DVOL is published for BTC and ETH only — anything else is a 400 at the edge.
const DVOL_SYMBOLS = new Set(['BTC', 'ETH']);
// An explicit expiry must be a plausible epoch-millis (bounded below year 2100).
const MAX_EXPIRY_MS = 4_102_444_800_000;

/**
 * What a board TTL cache stores: the rows plus the build-time facts the
 * envelope meta needs — when the board was computed (→ `asOf`, and `cachedAt`
 * on a stale serve) and how many symbols failed and were dropped (→ `partial`
 * and the note). Stamping the cache entry means a cached serve reports the
 * board's true age and completeness instead of looking freshly computed.
 */
interface CachedBoard<Row> {
  rows: Row[];
  computedAt: number;
  failed: number;
  total: number;
}

/**
 * Wrap cached board rows in the shared envelope. Provenance comes straight
 * from the provider (ccxt → 'live', mock → 'synthetic' — never claimed live
 * for synthetic data). The note is null only for a fully live, complete
 * board; synthetic provenance and dropped symbols are always stated.
 */
function boardEnvelope<Row>(
  provider: DataProvider,
  entry: CachedBoard<Row>,
  fromCache: boolean,
): BoardEnvelope<Row> {
  const provenance: BoardProvenance = provider.live ? 'live' : 'synthetic';
  const caveats: string[] = [];
  if (provenance === 'synthetic') caveats.push(`Synthetic data from ${provider.name} — not real market data.`);
  if (entry.failed > 0) caveats.push(`${entry.failed} of ${entry.total} symbols unavailable`);
  return {
    rows: entry.rows,
    meta: {
      provenance,
      source: provider.name,
      asOf: entry.computedAt,
      cachedAt: fromCache ? entry.computedAt : null,
      partial: entry.failed > 0,
      note: caveats.length > 0 ? caveats.join(' ') : null,
    },
  };
}

/**
 * Serve a fan-out board through its TTL cache and wrap it in a BoardEnvelope.
 * The cache stores the rows stamped with their compute time and drop count;
 * `cachedAt` is set only when this request was served a previously stored
 * entry (a fresh compute, or sharing one in flight, reports null).
 */
async function serveBoard<Row>(
  provider: DataProvider,
  cache: TtlCache<CachedBoard<Row>>,
  key: string,
  build: () => Promise<{ rows: Row[]; failed: number; total: number }>,
): Promise<BoardEnvelope<Row>> {
  let computed = false;
  const entry = await cache.get(key, async () => {
    computed = true;
    const { rows, failed, total } = await build();
    return { rows, failed, total, computedAt: Date.now() };
  });
  return boardEnvelope(provider, entry, !computed);
}

/**
 * Register one cross-venue board route (funding dispersion, venue arb, OI
 * concentration). All three share the same shape: for the top-N perps/symbols
 * by volume, fan a per-symbol upstream read out (N×M), compute one row each
 * (dropping any that throw — counted so the envelope can flag a partial
 * board), keep the rows that carry a real signal, and rank them descending.
 * They differ only in the upstream call + row compute (`compute`) and the
 * field that must be non-null and is the sort key (`rank`). A short
 * single-flight TTL cache (per (quote, limit)) bounds the fan-out cost.
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
  const cache = createTtlCache<CachedBoard<Row>>(opts.ttlMs);
  app.get<{ Querystring: { quote?: string; limit?: string } }>(opts.path, async (req) => {
    const quote = normalizeQuote(req.query.quote);
    const limitRaw = Number(req.query.limit);
    // Floor then clamp to ≥ 1: limit=0.5 would otherwise silently empty the board.
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.max(1, Math.floor(limitRaw)), 30) : 15;
    return serveBoard(provider, cache, `${quote}|${limit}`, async () => {
      const rows = await provider.screen({ quote, sort: 'volume', limit });
      let failed = 0;
      // Cast the resolved array: for a generic Row, TS widens Promise.all's
      // result to Awaited<Row>, which it can't prove equals Row. Every call
      // site's Row is a plain row object (never a promise), so this is sound.
      const board = (await Promise.all(
        rows.map(async (r): Promise<Row | null> => {
          try {
            return await opts.compute(r.symbol);
          } catch {
            failed += 1;
            return null;
          }
        }),
      )) as (Row | null)[];
      return {
        rows: board
          .filter((x): x is Row => x !== null && opts.rank(x) !== null)
          .sort((a, b) => (opts.rank(b) ?? 0) - (opts.rank(a) ?? 0)),
        failed,
        total: rows.length,
      };
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

  // The screener re-reads the whole ticker set per request; a short
  // single-flight window per (quote, sort, limit) shares one read across
  // concurrent users and client polling.
  const screenerCache = createTtlCache<ScreenerRow[]>(SCREENER_TTL_MS);
  app.get<{ Querystring: { quote?: string; sort?: string; limit?: string } }>(
    '/api/screener',
    async (req) => {
      const quote = normalizeQuote(req.query.quote);
      const sortRaw = firstStr(req.query.sort);
      // Reject unknown sorts: sortScreener would otherwise silently treat them
      // as volume order. Never echo the raw value back (it's unbounded input).
      if (sortRaw && !SCREENER_SORTS.has(sortRaw)) {
        throw new ProviderError(`Invalid screener sort — expected one of: ${[...SCREENER_SORTS].join(', ')}`, 400);
      }
      const limitRaw = Number(req.query.limit);
      // Floor then clamp to ≥ 1: limit=0.5 would otherwise silently empty the board.
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.max(1, Math.floor(limitRaw)), 200) : 50;
      return screenerCache.get(`${quote}|${sortRaw || 'volume'}|${limit}`, () =>
        provider.screen({ quote, sort: sortRaw || undefined, limit }),
      );
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

  // Options / DVOL / futures term structure (Deribit-native reads). These are
  // single-underlying payloads, not fan-out boards, so they carry their
  // provenance inside the payload (no BoardEnvelope) — withHonestNote
  // guarantees a synthetic/unavailable snapshot never ships without a caveat.
  // Providers without the reads degrade to an honest 'unavailable' snapshot.
  const dvolCache = createTtlCache<DvolSnapshot>(OPTIONS_TTL_MS);
  const chainCache = createTtlCache<OptionsChain>(OPTIONS_TTL_MS);
  const termStructureCache = createTtlCache<TermStructure>(TERM_STRUCTURE_TTL_MS);
  const oiDeltaCache = createTtlCache<OiDelta>(OI_DELTA_TTL_MS);
  const getDvol = provider.getDvol?.bind(provider);
  const getOptionsChain = provider.getOptionsChain?.bind(provider);
  const getTermStructure = provider.getFuturesTermStructure?.bind(provider);
  const getOiDelta = provider.getOiDelta?.bind(provider);

  app.get<{ Querystring: { symbol?: string } }>('/api/options/dvol', async (req) => {
    const raw = normalizeSymbol(req.query.symbol);
    if (!raw) throw new ProviderError('Missing or invalid symbol', 400);
    const base = raw.split('/')[0].replace(/:.*$/, '');
    if (!DVOL_SYMBOLS.has(base)) {
      throw new ProviderError('DVOL is published for BTC and ETH only', 400, base);
    }
    const symbol = base as DvolSymbol;
    if (!getDvol) {
      return withHonestNote(
        {
          symbol,
          value: null,
          history: [],
          asOf: null,
          provenance: 'unavailable' as const,
          source: provider.name,
          note: `${provider.name} has no DVOL read — the volatility index comes from Deribit (ccxt provider).`,
        },
        'DVOL is not available from this provider.',
      ) satisfies DvolSnapshot;
    }
    return dvolCache.get(symbol, async () =>
      withHonestNote(await getDvol(symbol), 'DVOL is not live.'),
    );
  });

  app.get<{ Querystring: { symbol?: string; expiry?: string } }>('/api/options/chain', async (req) => {
    const symbol = normalizeSymbol(req.query.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    const expiryRaw = firstStr(req.query.expiry).trim().toLowerCase();
    let expiry: number | 'nearest' = 'nearest';
    if (expiryRaw && expiryRaw !== 'nearest') {
      const n = Number(expiryRaw);
      if (!Number.isFinite(n) || n <= 0 || n > MAX_EXPIRY_MS) {
        throw new ProviderError('Invalid expiry — expected "nearest" or an epoch-millis expiry', 400, symbol);
      }
      expiry = Math.floor(n);
    }
    if (!getOptionsChain) {
      return withHonestNote(
        {
          underlying: symbol.split('/')[0].replace(/:.*$/, ''),
          expiry: expiry === 'nearest' ? 0 : expiry,
          underlyingPrice: null,
          entries: [],
          maxPainStrike: null,
          putCallOiRatio: null,
          asOf: null,
          provenance: 'unavailable' as const,
          source: provider.name,
          note: `${provider.name} has no options-chain read — options come from Deribit (ccxt provider).`,
        },
        'Options chain is not available from this provider.',
      ) satisfies OptionsChain;
    }
    return chainCache.get(`${symbol}|${expiry}`, async () =>
      withHonestNote(await getOptionsChain(symbol, expiry), 'Options chain is not live.'),
    );
  });

  app.get<{ Querystring: { symbol?: string } }>('/api/futures/term-structure', async (req) => {
    const symbol = normalizeSymbol(req.query.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    if (!getTermStructure) {
      return withHonestNote(
        {
          underlying: symbol.split('/')[0].replace(/:.*$/, ''),
          referencePrice: null,
          perpPrice: null,
          points: [],
          asOf: null,
          provenance: 'unavailable' as const,
          source: provider.name,
          note: `${provider.name} has no dated-futures read — the term structure comes from Deribit (ccxt provider).`,
        },
        'Futures term structure is not available from this provider.',
      ) satisfies TermStructure;
    }
    return termStructureCache.get(symbol, async () =>
      withHonestNote(await getTermStructure(symbol), 'Futures term structure is not live.'),
    );
  });

  // OI-delta positioning: OI CHANGE vs price CHANGE over a window — the
  // trader's four-quadrant read (long buildup / short buildup / long unwind /
  // short covering) that a static OI snapshot cannot give. Single-symbol
  // payload with its own provenance, like the options surface; providers
  // without an OI-history read degrade to an honest 'unavailable', never a
  // delta synthesized from two snapshots.
  app.get<{ Querystring: { symbol?: string; window?: string } }>('/api/oi-delta', async (req) => {
    const symbol = normalizeSymbol(req.query.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    const windowRaw = firstStr(req.query.window) || '24h';
    if (!isOiDeltaWindow(windowRaw)) {
      throw new ProviderError('Invalid window — expected one of: 1h, 4h, 24h, 7d', 400, symbol);
    }
    const window: OiDeltaWindow = windowRaw;
    if (!getOiDelta) {
      return withHonestNote(
        {
          symbol,
          window,
          oiNow: null,
          oiThen: null,
          oiChangePct: null,
          priceChangePct: null,
          classification: null,
          points: [],
          asOf: null,
          provenance: 'unavailable' as const,
          source: provider.name,
          note: `${provider.name} has no OI-history read — an OI delta comes from venues that publish open-interest history (ccxt provider).`,
        },
        'OI-delta is not available from this provider.',
      ) satisfies OiDelta;
    }
    return oiDeltaCache.get(`${symbol}|${window}`, async () =>
      withHonestNote(await getOiDelta(symbol, window), 'OI-delta is not live.'),
    );
  });

  // Funding-rates board: the top-N perps by volume with their funding + OI.
  // Composed from screen() + getDerivatives() so every provider supports it.
  // Same fan-out cost shape as the venue boards, so it sits behind the same
  // single-flight TTL cache (per (quote, limit)) and returns the shared
  // BoardEnvelope — dropped symbols flip meta.partial, never vanish silently.
  const fundingCache = createTtlCache<CachedBoard<FundingRow>>(FUNDING_TTL_MS);
  app.get<{ Querystring: { quote?: string; limit?: string } }>('/api/funding', async (req) => {
    const quote = normalizeQuote(req.query.quote);
    const limitRaw = Number(req.query.limit);
    // Floor then clamp to ≥ 1: limit=0.5 would otherwise silently empty the board.
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.max(1, Math.floor(limitRaw)), 60) : 30;
    return serveBoard(provider, fundingCache, `${quote}|${limit}`, async () => {
      const rows = await provider.screen({ quote, sort: 'volume', limit });
      let failed = 0;
      const board = await Promise.all(
        rows.map(async (r): Promise<FundingRow | null> => {
          try {
            const d = await provider.getDerivatives(r.symbol);
            return {
              symbol: r.symbol,
              fundingRate: d.fundingRate,
              fundingIntervalHours: d.fundingIntervalHours ?? null,
              nextFundingTime: d.nextFundingTime,
              markPrice: d.markPrice,
              openInterestValue: d.openInterestValue,
            };
          } catch {
            failed += 1;
            return null;
          }
        }),
      );
      return { rows: board.filter((x): x is FundingRow => x !== null), failed, total: rows.length };
    });
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
  // getDerivatives() so every provider supports it. Cached per quote on a
  // short single-flight window — the merged feed is capped at 120 events and
  // `limit` only widens the fan-out, so one cached sweep can serve every
  // limit within the window; meta.asOf always reports the sweep's real age.
  const liquidationsCache = createTtlCache<LiquidationsFeed>(LIQUIDATIONS_TTL_MS);
  app.get<{ Querystring: { quote?: string; limit?: string } }>('/api/liquidations', async (req) => {
    const quote = normalizeQuote(req.query.quote);
    const limitRaw = Number(req.query.limit);
    // Floor then clamp to ≥ 1: limit=0.5 would otherwise silently empty the feed.
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.max(1, Math.floor(limitRaw)), 60) : 30;
    return liquidationsCache.get(quote, async () => {
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
