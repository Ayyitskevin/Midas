import type { FastifyInstance } from 'fastify';
import {
  computeFundingDispersion,
  computeCrossVenueScreen,
  CROSS_VENUE_SCREEN_SORTS,
  sortCrossVenueScreen,
  computeOiConcentration,
  computeVenueArbRow,
  isInterval,
  isOiDeltaWindow,
  isRange,
  partialEvidenceLimitation,
  withDataReceipt,
  withHonestNote,
} from '@midas/shared';
import type {
  BoardEnvelope,
  CoinUniverse,
  CrossVenueScreenerRow,
  CrossVenueScreenSort,
  DvolSnapshot,
  DvolSymbol,
  FundingDispersionRow,
  HealthResponse,
  Interval,
  OiConcentrationRow,
  OiDelta,
  OiDeltaWindow,
  OptionsChain,
  Range,
  ScreenerRow,
  TermStructure,
  VenueArbRow,
  DataReceipt,
} from '@midas/shared';
import type { DataProvider } from '../providers';
import { ProviderError } from '../providers';
import { config } from '../config';
import { createTtlCache } from '../ttlCache';
import { providerStreamsLive } from '../streaming';
import { firstStr, normalizeSymbol, normalizeQuote } from './shared';
import type { DataStatusTracker } from '../dataStatus';
import { DATA_ROUTE_PATHS } from '../dataCoverage';
import {
  attachProviderReceipt,
  attachProviderReceiptRows,
  deriveRouteReceipt,
  trackProviderCall,
  transportDerivedReceipt,
  unavailableReceipt,
} from './dataTrust';
import {
  registerVenueBoard,
  serveReceiptPayload,
  type CachedReceiptPayload,
} from './boards';
import { registerFundingBoard, registerLiquidationsBoard } from './marketBoards';

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
// The screener re-reads the full ticker set per request; quote/price data is
// fresh enough on a 15s window shared across concurrent users.
const SCREENER_TTL_MS = 15_000;
// One ticker sweep per venue (not per symbol), so the cross-venue screener costs
// N calls per refresh. A 20s window matches the venue-arb board's cadence and
// collapses concurrent users onto one sweep.
const VENUE_SCREENER_TTL_MS = 20_000;
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
 * Market-data + provider-status routes: health, quotes, history, order books,
 * venue compare, derivatives, on-chain pools, funding-rate history, screener,
 * funding board, market-wide liquidations, search and news. All read-only
 * against the active provider.
 */
export function registerMarketRoutes(
  app: FastifyInstance,
  provider: DataProvider,
  dataStatus: DataStatusTracker,
): void {

  app.get(DATA_ROUTE_PATHS.health, async (): Promise<HealthResponse> => {
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

  app.get<{ Params: { symbol: string } }>(DATA_ROUTE_PATHS.quote, async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    const payload = await trackProviderCall(provider, 'quote', dataStatus, () => provider.getQuote(symbol));
    return attachProviderReceipt(
      provider,
      'quote',
      payload,
      String(req.id),
      dataStatus,
      undefined,
      undefined,
      { instrument: symbol },
    );
  });

  app.get<{ Querystring: { symbols?: string } }>(DATA_ROUTE_PATHS.quotes, async (req) => {
    const raw = firstStr(req.query.symbols);
    const symbols = Array.from(
      new Set(
        raw
          .split(',')
          .map(normalizeSymbol)
          .filter(Boolean),
      ),
    ).slice(0, MAX_BATCH_SYMBOLS);
    if (symbols.length === 0) throw new ProviderError('At least one valid symbol is required', 400);
    const rows = await trackProviderCall(provider, 'quote', dataStatus, () => provider.getQuotes(symbols));
    const returnedSymbols = rows.map((row) => normalizeSymbol(row.symbol));
    if (new Set(returnedSymbols).size !== returnedSymbols.length) {
      dataStatus.recordError(provider, 'quote', 'malformed-upstream');
      throw new ProviderError(
        'Provider returned duplicate quote observations for a batch request',
        502,
        undefined,
        'malformed-upstream',
      );
    }
    const attached = attachProviderReceiptRows(
      provider,
      'quote',
      rows,
      String(req.id),
      dataStatus,
      undefined,
      undefined,
      { instruments: symbols },
    );
    if (attached.length === symbols.length) return attached;
    const limitation = partialEvidenceLimitation(
      `Provider returned ${attached.length} of ${symbols.length} requested quote observation(s).`,
    );
    return attached.map((row) =>
      withDataReceipt(
        row,
        deriveRouteReceipt(
          provider,
          {
            family: 'quote',
            instrument: row.symbol,
            coverage: `${attached.length} of ${symbols.length} requested symbol(s).`,
            inputReceipts: [row.receipt],
            methodology: {
              id: 'midas.quote-batch-coverage',
              version: '1.0',
              formula: 'Preserve each successful provider quote and disclose omitted requested symbols.',
            },
            units: row.receipt.units,
            limitations: [limitation],
            traceId: String(req.id),
          },
          dataStatus,
          'partial',
        ),
      ),
    );
  });

  app.get<{
    Params: { symbol: string };
    Querystring: { interval?: string; range?: string };
  }>(DATA_ROUTE_PATHS.history, async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);

    const interval = req.query.interval && isInterval(req.query.interval)
      ? req.query.interval
      : DEFAULT_INTERVAL;
    const range = req.query.range && isRange(req.query.range)
      ? req.query.range
      : DEFAULT_RANGE;

    const payload = await trackProviderCall(provider, 'history', dataStatus, () =>
      provider.getHistory(symbol, { interval, range }),
    );
    return attachProviderReceipt(
      provider,
      'history',
      payload,
      String(req.id),
      dataStatus,
      undefined,
      undefined,
      { instrument: symbol, range },
    );
  });

  app.get<{
    Params: { symbol: string };
    Querystring: { depth?: string };
  }>(DATA_ROUTE_PATHS.orderBook, async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    const depthRaw = Number(req.query.depth);
    const depth =
      Number.isFinite(depthRaw) && depthRaw > 0 ? Math.min(Math.floor(depthRaw), 100) : 25;
    return provider.getOrderBook(symbol, depth);
  });

  app.get<{ Params: { symbol: string } }>(DATA_ROUTE_PATHS.exchangeQuotes, async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    const rows = await trackProviderCall(provider, 'venue-quotes', dataStatus, () =>
      provider.getExchangeQuotes(symbol),
    );
    return attachProviderReceiptRows(
      provider,
      'venue-quotes',
      rows,
      String(req.id),
      dataStatus,
      undefined,
      undefined,
      { instrument: symbol },
    );
  });

  // Per-venue funding & open interest for a perp across the compare set.
  app.get<{ Params: { symbol: string } }>(DATA_ROUTE_PATHS.venueDerivatives, async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    const rows = await trackProviderCall(provider, 'venue-derivatives', dataStatus, () =>
      provider.getVenueDerivatives(symbol),
    );
    return attachProviderReceiptRows(
      provider,
      'venue-derivatives',
      rows,
      String(req.id),
      dataStatus,
      undefined,
      undefined,
      { instrument: symbol },
    );
  });

  app.get<{ Params: { symbol: string } }>(DATA_ROUTE_PATHS.derivatives, async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    const payload = await trackProviderCall(provider, 'derivatives', dataStatus, () =>
      provider.getDerivatives(symbol),
    );
    return attachProviderReceipt(
      provider,
      'derivatives',
      payload,
      String(req.id),
      dataStatus,
      undefined,
      undefined,
      { instrument: symbol },
    );
  });

  app.get<{ Params: { symbol: string } }>(DATA_ROUTE_PATHS.onChain, async (req) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    return provider.getDexPools(symbol);
  });

  app.get<{ Params: { symbol: string }; Querystring: { limit?: string } }>(
    DATA_ROUTE_PATHS.fundingHistory,
    async (req) => {
      const symbol = normalizeSymbol(req.params.symbol);
      if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
      if (!provider.getFundingHistory) {
        const declaredUnsupported =
          provider.capabilities.capabilities['funding-history'].support === 'unsupported';
        dataStatus.recordError(
          provider,
          'funding-history',
          declaredUnsupported ? 'unsupported' : 'malformed-upstream',
        );
        throw new ProviderError(
          declaredUnsupported
            ? 'Funding history not supported by this provider'
            : 'Provider declares funding history but does not implement it',
          declaredUnsupported ? 501 : 502,
          symbol,
        );
      }
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 90;
      const rows = await trackProviderCall(provider, 'funding-history', dataStatus, () =>
        provider.getFundingHistory!(symbol, limit),
      );
      return attachProviderReceiptRows(
        provider,
        'funding-history',
        rows,
        String(req.id),
        dataStatus,
        undefined,
        undefined,
        { instrument: symbol },
      );
    },
  );

  // The screener re-reads the whole ticker set per request; a short
  // single-flight window per (quote, sort, limit) shares one read across
  // concurrent users and client polling.
  const screenerCache = createTtlCache<ScreenerRow[]>(SCREENER_TTL_MS);
  app.get<{ Querystring: { quote?: string; sort?: string; limit?: string } }>(
    DATA_ROUTE_PATHS.screener,
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

  // Cross-venue screener: one ticker sweep per configured venue, unioned into a
  // per-symbol board. Volume SUMS across venues (each venue's traded volume is
  // its own); price does not — venues are N observations of one quantity, so the
  // board carries a weighted central estimate plus the dispersion between them.
  // Cost is one upstream call per venue, not per symbol, so a short TTL and the
  // single-flight cache keep it cheap.
  const venueScreenerCache = createTtlCache<
    CachedReceiptPayload<BoardEnvelope<CrossVenueScreenerRow & { receipt: DataReceipt }> & { receipt: DataReceipt }>
  >(VENUE_SCREENER_TTL_MS);
  app.get<{ Querystring: { quote?: string; sort?: string; limit?: string } }>(
    DATA_ROUTE_PATHS.venueScreener,
    async (req) => {
      const quote = normalizeQuote(req.query.quote);
      const sortRaw = firstStr(req.query.sort);
      // Reject unknown sorts rather than silently falling back to volume order.
      if (sortRaw && !(CROSS_VENUE_SCREEN_SORTS as readonly string[]).includes(sortRaw)) {
        throw new ProviderError(
          `Invalid screener sort — expected one of: ${CROSS_VENUE_SCREEN_SORTS.join(', ')}`,
          400,
        );
      }
      const sort = (sortRaw || 'volume') as CrossVenueScreenSort;
      const limitRaw = Number(req.query.limit);
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.max(1, Math.floor(limitRaw)), 100) : 50;

      let computed = false;
      const entry = await venueScreenerCache.get(`${quote}|${sort}|${limit}`, async () => {
        computed = true;
        const raw = await trackProviderCall(provider, 'venue-screener', dataStatus, () =>
          provider.getVenueScreen({ quote, limit }),
        );
        const venues = attachProviderReceiptRows(
          provider,
          'venue-screener',
          raw,
          String(req.id),
          dataStatus,
        );
        const reporting = venues.filter((venue) => venue.available && venue.rows.length > 0);
        const ranked = sortCrossVenueScreen(computeCrossVenueScreen(venues), sort).slice(0, limit);
        const computedAt = Date.now();
        const medianRows = ranked.filter((row) => row.basis === 'median').length;
        const singleVenueRows = ranked.filter((row) => row.venueCount === 1).length;
        const receipt = deriveRouteReceipt(
          provider,
          {
            family: 'venue-screener',
            coverage:
              `${reporting.length} of ${venues.length} configured venue(s) reported; ` +
              `${ranked.length} symbol(s) returned, ranked by ${sort}.`,
            inputReceipts: venues.map((venue) => venue.receipt),
            methodology: {
              id: 'midas.cross-venue-screener',
              version: '1.0',
              formula:
                'totalQuoteVolume = sum(venue quoteVolume); ' +
                'price/changePercent = quote-volume-weighted mean, else median, else the single venue; ' +
                'priceDispersionBps = (maxPrice - minPrice) / minPrice * 10000',
            },
            units: { price: 'quote currency', volume: 'base asset', quoteVolume: 'quote currency' },
            limitations: [
              ...(reporting.length < venues.length
                ? [
                    partialEvidenceLimitation(
                      `${venues.length - reporting.length} of ${venues.length} configured venue(s) returned no screener rows.`,
                    ),
                  ]
                : []),
              ...(singleVenueRows > 0
                ? [`${singleVenueRows} returned row(s) are quoted by a single venue; venueCount states which.`]
                : []),
              ...(medianRows > 0
                ? [`${medianRows} returned row(s) had no reported volume anywhere and use an unweighted median.`]
                : []),
              'Exchange-reported 24h volume is widely documented as inflated; totals are a scale signal, not a verified figure.',
            ],
            traceId: String(req.id),
            expectedCadenceMs: VENUE_SCREENER_TTL_MS,
            maxAgeMs: VENUE_SCREENER_TTL_MS * 2,
            cache: { status: 'miss', ageMs: 0 },
          },
          dataStatus,
          reporting.length < venues.length ? 'partial' : null,
        );
        const envelope: BoardEnvelope<CrossVenueScreenerRow & { receipt: DataReceipt }> = {
          rows: ranked.map((row) => withDataReceipt(row, receipt)),
          meta: {
            provenance: receipt.provenance,
            source: receipt.source,
            asOf: computedAt,
            cachedAt: null,
            partial: reporting.length < venues.length,
            note: reporting.length < venues.length
              ? `${reporting.length} of ${venues.length} configured venues reported.`
              : null,
            receipt,
          },
        };
        return { payload: withDataReceipt(envelope, receipt), storedAt: computedAt };
      });
      const now = Date.now();
      return transportDerivedReceipt(
        provider,
        entry.payload,
        String(req.id),
        dataStatus,
        { status: computed ? 'miss' : 'hit', ageMs: computed ? 0 : Math.max(0, now - entry.storedAt) },
        now,
      );
    },
  );

  // Top-N coins by circulating market cap (rank / cap / supply / FDV). Reference
  // data an exchange feed can't produce (a CEX ticker has no circulating supply,
  // so `Quote.marketCap` is null on ccxt). Providers without getCoinUniverse
  // degrade to an honest 'unavailable' universe — never a fabricated cap. No
  // current live provider implements this reference family. TTL-cached: supplies
  // barely move.
  const coinsCache = createTtlCache<CoinUniverse>(COINS_TTL_MS);
  const getCoinUniverse = provider.getCoinUniverse?.bind(provider);
  app.get<{ Querystring: { limit?: string } }>(DATA_ROUTE_PATHS.coins, async (req) => {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 250) : 100;
    if (!getCoinUniverse) {
      // withHonestNote enforces the shared invariant: unavailable requires a note.
      return withHonestNote(
        {
          coins: [],
          provenance: 'unavailable' as const,
          source: provider.name,
          note: 'No market-cap reference source is implemented for this provider.',
          asOf: null,
        },
        'No market-cap reference source is implemented for this provider.',
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
  const dvolCache = createTtlCache<CachedReceiptPayload<DvolSnapshot>>(OPTIONS_TTL_MS);
  const chainCache = createTtlCache<CachedReceiptPayload<OptionsChain>>(OPTIONS_TTL_MS);
  const termStructureCache = createTtlCache<CachedReceiptPayload<TermStructure>>(TERM_STRUCTURE_TTL_MS);
  const oiDeltaCache = createTtlCache<CachedReceiptPayload<OiDelta>>(OI_DELTA_TTL_MS);
  const getDvol = provider.getDvol?.bind(provider);
  const getOptionsChain = provider.getOptionsChain?.bind(provider);
  const getTermStructure = provider.getFuturesTermStructure?.bind(provider);
  const getOiDelta = provider.getOiDelta?.bind(provider);

  app.get<{ Querystring: { symbol?: string } }>(DATA_ROUTE_PATHS.dvol, async (req) => {
    const raw = normalizeSymbol(req.query.symbol);
    if (!raw) throw new ProviderError('Missing or invalid symbol', 400);
    const base = raw.split('/')[0].replace(/:.*$/, '');
    if (!DVOL_SYMBOLS.has(base)) {
      throw new ProviderError('DVOL is published for BTC and ETH only', 400, base);
    }
    const symbol = base as DvolSymbol;
    if (!getDvol) {
      const payload = withHonestNote(
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
      const receipt = unavailableReceipt(
        provider,
        {
          family: 'options',
          instrument: symbol,
          coverage: 'Deribit DVOL index.',
          limitations: ['Provider does not implement a DVOL read.'],
          note: payload.note!,
          traceId: String(req.id),
          expectedCadenceMs: OPTIONS_TTL_MS,
          maxAgeMs: OPTIONS_TTL_MS * 2,
        },
        dataStatus,
      );
      return withDataReceipt(payload, receipt);
    }
    return serveReceiptPayload(
      provider,
      'options',
      dvolCache,
      symbol,
      String(req.id),
      dataStatus,
      async () =>
        withHonestNote(
          await trackProviderCall(provider, 'options', dataStatus, () => getDvol(symbol)),
          'DVOL is not live.',
        ),
      { instrument: symbol },
    );
  });

  app.get<{ Querystring: { symbol?: string; expiry?: string } }>(DATA_ROUTE_PATHS.optionsChain, async (req) => {
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
      const payload = withHonestNote(
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
      const receipt = unavailableReceipt(
        provider,
        {
          family: 'options',
          instrument: symbol,
          coverage: expiry === 'nearest' ? 'Nearest listed expiry.' : `Expiry ${expiry}.`,
          limitations: ['Provider does not implement an options-chain read.'],
          note: payload.note!,
          traceId: String(req.id),
          expectedCadenceMs: OPTIONS_TTL_MS,
          maxAgeMs: OPTIONS_TTL_MS * 2,
        },
        dataStatus,
      );
      return withDataReceipt(payload, receipt);
    }
    return serveReceiptPayload(
      provider,
      'options',
      chainCache,
      `${symbol}|${expiry}`,
      String(req.id),
      dataStatus,
      async () =>
        withHonestNote(
          await trackProviderCall(provider, 'options', dataStatus, () => getOptionsChain(symbol, expiry)),
          'Options chain is not live.',
        ),
      { instrument: symbol, expiry: expiry === 'nearest' ? undefined : expiry },
    );
  });

  app.get<{ Querystring: { symbol?: string } }>(DATA_ROUTE_PATHS.termStructure, async (req) => {
    const symbol = normalizeSymbol(req.query.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    if (!getTermStructure) {
      const payload = withHonestNote(
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
      const receipt = unavailableReceipt(
        provider,
        {
          family: 'options',
          instrument: symbol,
          coverage: 'Dated futures and perpetual reference curve.',
          limitations: ['Provider does not implement a dated-futures read.'],
          note: payload.note!,
          traceId: String(req.id),
          expectedCadenceMs: TERM_STRUCTURE_TTL_MS,
          maxAgeMs: TERM_STRUCTURE_TTL_MS * 2,
        },
        dataStatus,
      );
      return withDataReceipt(payload, receipt);
    }
    return serveReceiptPayload(
      provider,
      'options',
      termStructureCache,
      symbol,
      String(req.id),
      dataStatus,
      async () =>
        withHonestNote(
          await trackProviderCall(provider, 'options', dataStatus, () => getTermStructure(symbol)),
          'Futures term structure is not live.',
        ),
      { instrument: symbol },
    );
  });

  // OI-delta positioning: OI CHANGE vs price CHANGE over a window — the
  // trader's four-quadrant read (long buildup / short buildup / long unwind /
  // short covering) that a static OI snapshot cannot give. Single-symbol
  // payload with its own provenance, like the options surface; providers
  // without an OI-history read degrade to an honest 'unavailable', never a
  // delta synthesized from two snapshots.
  app.get<{ Querystring: { symbol?: string; window?: string } }>(DATA_ROUTE_PATHS.oiDelta, async (req) => {
    const symbol = normalizeSymbol(req.query.symbol);
    if (!symbol) throw new ProviderError('Missing or invalid symbol', 400);
    const windowRaw = firstStr(req.query.window) || '24h';
    if (!isOiDeltaWindow(windowRaw)) {
      throw new ProviderError('Invalid window — expected one of: 1h, 4h, 24h, 7d', 400, symbol);
    }
    const window: OiDeltaWindow = windowRaw;
    if (!getOiDelta) {
      const payload = withHonestNote(
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
      const receipt = unavailableReceipt(
        provider,
        {
          family: 'open-interest-delta',
          instrument: symbol,
          coverage: `${window} OI and price change.`,
          limitations: ['Provider does not implement an open-interest history read.'],
          note: payload.note!,
          traceId: String(req.id),
          expectedCadenceMs: OI_DELTA_TTL_MS,
          maxAgeMs: OI_DELTA_TTL_MS * 2,
        },
        dataStatus,
      );
      return withDataReceipt(payload, receipt);
    }
    return serveReceiptPayload(
      provider,
      'open-interest-delta',
      oiDeltaCache,
      `${symbol}|${window}`,
      String(req.id),
      dataStatus,
      async () =>
        withHonestNote(
          await trackProviderCall(provider, 'open-interest-delta', dataStatus, () => getOiDelta(symbol, window)),
          'OI-delta is not live.',
        ),
      { instrument: symbol, window },
    );
  });

  registerFundingBoard(app, { provider, dataStatus });

  // The three cross-venue boards share one fan-out-behind-a-TTL-cache shape
  // (registerVenueBoard). Each keeps only rows whose signal field is non-null
  // (funding spread ≥ 2 venues / price dispersion ≥ 2 venues / OI ≥ 1 venue) and
  // ranks by it descending — supplied here as `compute` + `rank`.
  registerVenueBoard<FundingDispersionRow & { receipt: DataReceipt }>(app, provider, dataStatus, {
    path: DATA_ROUTE_PATHS.fundingDispersion,
    family: 'funding',
    ttlMs: FUNDING_DISPERSION_TTL_MS,
    compute: async (symbol, traceId) => {
      const raw = await trackProviderCall(provider, 'venue-derivatives', dataStatus, () =>
        provider.getVenueDerivatives(symbol),
      );
      const inputs = attachProviderReceiptRows(
        provider,
        'venue-derivatives',
        raw,
        traceId,
        dataStatus,
        undefined,
        undefined,
        { instrument: symbol },
      );
      const row = computeFundingDispersion(symbol, inputs);
      const missingIntervals = inputs.filter(
        (input) => input.fundingRate != null && input.fundingIntervalHours == null,
      ).length;
      const limitations = [
        ...(missingIntervals > 0
          ? [
              partialEvidenceLimitation(
                `${missingIntervals} venue funding rate(s) lacked a settlement interval and were excluded.`,
              ),
            ]
          : []),
        ...(row.totalOiValue == null
          ? [partialEvidenceLimitation('No venue reported open-interest value.')]
          : []),
      ];
      const receipt = deriveRouteReceipt(
        provider,
        {
          family: 'funding',
          instrument: symbol,
          coverage: `${inputs.length} venue derivative snapshot(s).`,
          inputReceipts: inputs.map((input) => input.receipt),
          methodology: {
            id: 'midas.funding-dispersion-8h',
            version: '1.0',
            formula: 'normalizedRate = fundingRate * 8 / intervalHours; spreadBps = (max - min) * 10000',
          },
          units: {
            fundingRate: 'fraction/settlement',
            normalizedRate: 'fraction/8h',
            spreadBps: 'basis points/8h',
            totalOiValue: 'quote currency',
          },
          limitations,
          traceId,
          expectedCadenceMs: FUNDING_DISPERSION_TTL_MS,
          maxAgeMs: FUNDING_DISPERSION_TTL_MS * 2,
        },
        dataStatus,
        limitations.length > 0 ? 'partial' : null,
      );
      return withDataReceipt(row, receipt);
    },
    rank: (row) => row.spreadBps,
  });

  registerVenueBoard<VenueArbRow & { receipt: DataReceipt }>(app, provider, dataStatus, {
    path: DATA_ROUTE_PATHS.venueArb,
    family: 'venue-arbitrage',
    ttlMs: VENUE_ARB_TTL_MS,
    compute: async (symbol, traceId) => {
      const raw = await trackProviderCall(provider, 'venue-quotes', dataStatus, () =>
        provider.getExchangeQuotes(symbol),
      );
      const inputs = attachProviderReceiptRows(
        provider,
        'venue-quotes',
        raw,
        traceId,
        dataStatus,
        undefined,
        undefined,
        { instrument: symbol },
      );
      const computed = computeVenueArbRow(symbol, inputs, Date.now());
      // Defense in depth around the pure calculation: missing fee, size, or
      // aligned-time evidence can never leave an actionable net result.
      const row = computed.netLimitations.length > 0
        ? { ...computed, netSpreadBps: null, netCrossed: false }
        : computed;
      const receipt = deriveRouteReceipt(
        provider,
        {
          family: 'venue-arbitrage',
          instrument: symbol,
          coverage: `${inputs.length} venue top-of-book snapshot(s).`,
          inputReceipts: inputs.map((input) => input.receipt),
          methodology: {
            id: 'midas.venue-arbitrage-top-of-book',
            version: '1.0',
            formula:
              'grossBps = (bestBid - bestAsk) / bestAsk * 10000; netBps = grossBps - referenceTakerFeesBps',
          },
          units: {
            spreadBps: 'basis points',
            feeBps: 'basis points',
            netSpreadBps: 'basis points',
            executableSize: 'base asset',
            timestampSkewMs: 'milliseconds',
          },
          limitations: [
            ...row.netLimitations.map(partialEvidenceLimitation),
            'Fees use a static reference taker tier and exclude transfer/withdrawal costs and user-specific tiers.',
          ],
          traceId,
          expectedCadenceMs: VENUE_ARB_TTL_MS,
          maxAgeMs: VENUE_ARB_TTL_MS * 2,
        },
        dataStatus,
        row.netLimitations.length > 0 ? 'partial' : null,
      );
      return withDataReceipt(row, receipt);
    },
    rank: (row) => row.dispersionBps,
  });

  registerVenueBoard<OiConcentrationRow & { receipt: DataReceipt }>(app, provider, dataStatus, {
    path: DATA_ROUTE_PATHS.oiConcentration,
    family: 'open-interest',
    ttlMs: OI_CONCENTRATION_TTL_MS,
    compute: async (symbol, traceId) => {
      const raw = await trackProviderCall(provider, 'venue-derivatives', dataStatus, () =>
        provider.getVenueDerivatives(symbol),
      );
      const inputs = attachProviderReceiptRows(
        provider,
        'venue-derivatives',
        raw,
        traceId,
        dataStatus,
        undefined,
        undefined,
        { instrument: symbol },
      );
      const row = computeOiConcentration(symbol, inputs);
      const missingOi = inputs.length - row.venueCount;
      const limitations = missingOi > 0
        ? [partialEvidenceLimitation(`${missingOi} venue(s) did not report open-interest value.`)]
        : [];
      const receipt = deriveRouteReceipt(
        provider,
        {
          family: 'open-interest',
          instrument: symbol,
          coverage: `${inputs.length} venue derivative snapshot(s).`,
          inputReceipts: inputs.map((input) => input.receipt),
          methodology: {
            id: 'midas.open-interest-concentration',
            version: '1.0',
            formula: 'share_i = oi_i / sum(oi); herfindahl = sum(share_i^2)',
          },
          units: {
            totalOiValue: 'quote currency',
            topVenueShare: 'fraction',
            herfindahl: 'index 0..1',
          },
          limitations,
          traceId,
          expectedCadenceMs: OI_CONCENTRATION_TTL_MS,
          maxAgeMs: OI_CONCENTRATION_TTL_MS * 2,
        },
        dataStatus,
        limitations.length > 0 ? 'partial' : null,
      );
      return withDataReceipt(row, receipt);
    },
    rank: (row) => row.totalOiValue,
  });

  registerLiquidationsBoard(app, { provider, dataStatus });

  app.get<{ Querystring: { q?: string } }>(DATA_ROUTE_PATHS.search, async (req) => {
    const q = firstStr(req.query.q).trim().slice(0, 64);
    if (q.length === 0) return [];
    return provider.search(q);
  });

  app.get<{ Querystring: { symbol?: string } }>(DATA_ROUTE_PATHS.news, async (req) => {
    const symbol = normalizeSymbol(req.query.symbol) || undefined;
    return provider.getNews(symbol);
  });
}
