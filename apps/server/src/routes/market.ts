import type { FastifyInstance } from 'fastify';
import {
  computeFundingDispersion,
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
  DataReceipt,
  TrustDatasetFamily,
} from '@midas/shared';
import type { DataProvider } from '../providers';
import { ProviderError } from '../providers';
import { config } from '../config';
import { createTtlCache, type TtlCache } from '../ttlCache';
import { providerStreamsLive } from '../streaming';
import { normalizeLiquidationsMeta } from '../liquidationsHonesty';
import { firstStr, normalizeSymbol, normalizeQuote } from './shared';
import type { DataStatusTracker } from '../dataStatus';
import { DATA_ROUTE_PATHS } from '../dataCoverage';
import {
  attachProviderReceipt,
  attachProviderReceiptRows,
  deriveRouteReceipt,
  receiptHasPartialEvidence,
  trackProviderCall,
  transportDerivedReceipt,
  unavailableReceipt,
  type ReceiptCarrier,
  type ReceiptExpectation,
} from './dataTrust';

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
  insufficient: number;
  partialRows: number;
  total: number;
  receipt: DataReceipt;
}

interface CachedReceiptPayload<T> {
  payload: T;
  storedAt: number;
}

/**
 * Wrap cached board rows in the shared envelope. Provenance comes straight
 * from the provider (ccxt → 'live', mock → 'synthetic' — never claimed live
 * for synthetic data). The note is null only for a fully live, complete
 * board; synthetic provenance and dropped symbols are always stated.
 */
function boardEnvelope<Row>(
  entry: CachedBoard<Row>,
  fromCache: boolean,
): BoardEnvelope<Row> {
  const provenance: BoardProvenance = entry.receipt.provenance;
  const caveats: string[] = [];
  if (provenance === 'synthetic') {
    caveats.push(`Synthetic data from ${entry.receipt.source} — not real market data.`);
  }
  if (provenance === 'unavailable' && entry.receipt.note) caveats.push(entry.receipt.note);
  if (entry.failed > 0) caveats.push(`${entry.failed} of ${entry.total} symbols unavailable`);
  if (entry.insufficient > 0) {
    caveats.push(`${entry.insufficient} of ${entry.total} symbols lacked the required signal and were omitted`);
  }
  if (entry.partialRows > 0) caveats.push(`${entry.partialRows} returned row(s) carry partial evidence`);
  return {
    rows: entry.rows,
    meta: {
      provenance,
      source: entry.receipt.source,
      asOf: entry.computedAt,
      cachedAt: fromCache ? entry.computedAt : null,
      partial: entry.failed > 0 || entry.insufficient > 0 || entry.partialRows > 0,
      note: caveats.length > 0 ? caveats.join(' ') : null,
      receipt: entry.receipt,
    },
  };
}

/**
 * Serve a fan-out board through its TTL cache and wrap it in a BoardEnvelope.
 * The cache stores the rows stamped with their compute time and drop count;
 * `cachedAt` is set only when this request was served a previously stored
 * entry (a fresh compute, or sharing one in flight, reports null).
 */
async function serveBoard<Row extends object & { receipt: DataReceipt }>(
  provider: DataProvider,
  family: TrustDatasetFamily,
  cache: TtlCache<CachedBoard<Row>>,
  key: string,
  traceId: string,
  dataStatus: DataStatusTracker,
  build: () => Promise<{
    rows: Row[];
    failed: number;
    insufficient?: number;
    evidenceReceipts?: DataReceipt[];
    total: number;
  }>,
): Promise<BoardEnvelope<Row>> {
  let computed = false;
  const entry = await cache.get(key, async () => {
    computed = true;
    const { rows, failed, insufficient = 0, evidenceReceipts, total } = await build();
    const computedAt = Date.now();
    const inputs = evidenceReceipts ?? rows.map((row) => row.receipt);
    const partialRows = rows.filter((row) => receiptHasPartialEvidence(row.receipt)).length;
    const limitations = [
      ...(failed > 0
        ? [partialEvidenceLimitation(`${failed} of ${total} board input(s) failed.`)]
        : []),
      ...(insufficient > 0
        ? [
            partialEvidenceLimitation(
              `${insufficient} of ${total} board input(s) lacked the required signal and were omitted.`,
            ),
          ]
        : []),
      ...(partialRows > 0
        ? [partialEvidenceLimitation(`${partialRows} returned board row(s) carry partial evidence.`)]
        : []),
    ];
    const partial = limitations.length > 0;
    const receipt = inputs.length > 0
      ? deriveRouteReceipt(
          provider,
          {
            family,
            coverage: `${rows.length} of ${total} requested board row(s).`,
            inputReceipts: inputs,
            methodology:
              family === 'venue-arbitrage' &&
              provider.capabilities.capabilities['venue-arbitrage'].methodology
                ? provider.capabilities.capabilities['venue-arbitrage'].methodology
                : {
                    id: `midas.${family}.board-assembly`,
                    version: '1.0',
                    formula:
                      'Assemble successful per-symbol derivations; retain route-defined ranking; report omissions.',
                  },
            units: {},
            limitations,
            traceId,
            cache: { status: 'miss', ageMs: 0 },
          },
          dataStatus,
          partial ? 'partial' : null,
          computedAt,
        )
      : unavailableReceipt(
          provider,
          {
            family,
            coverage: `0 of ${total} requested board row(s).`,
            limitations: [
              ...limitations,
              'No receipted board rows were available.',
            ],
            note: 'No receipted board rows are currently available.',
            traceId,
          },
          dataStatus,
          partial ? 'partial' : 'upstream-unavailable',
          computedAt,
        );
    return { rows, failed, insufficient, partialRows, total, computedAt, receipt };
  });
  const now = Date.now();
  const fromCache = !computed;
  const rows = entry.rows.map((row) =>
    suppressStaleArbitrage(
      family,
      transportDerivedReceipt(
        provider,
        row,
        traceId,
        dataStatus,
        { status: fromCache ? 'hit' : 'miss', ageMs: fromCache ? Math.max(0, now - entry.computedAt) : 0 },
        now,
      ),
    ),
  );
  const receipt = transportDerivedReceipt(
    provider,
    { receipt: entry.receipt },
    traceId,
    dataStatus,
    { status: fromCache ? 'hit' : 'miss', ageMs: fromCache ? Math.max(0, now - entry.computedAt) : 0 },
    now,
  ).receipt;
  return boardEnvelope({ ...entry, rows, receipt }, fromCache);
}

/** Cached quote evidence can age out while the numeric row remains cached. */
function suppressStaleArbitrage<Row extends object & { receipt: DataReceipt }>(
  family: TrustDatasetFamily,
  row: Row,
): Row {
  if (family !== 'venue-arbitrage' || row.receipt.freshness.state === 'fresh') return row;
  const arb = row as Row & VenueArbRow;
  return {
    ...arb,
    netSpreadBps: null,
    netCrossed: false,
    netLimitations: [
      ...arb.netLimitations,
      'Cached quote evidence is no longer fresh enough for an actionable net calculation.',
    ],
  };
}

async function serveReceiptPayload<T extends object & ReceiptCarrier>(
  provider: DataProvider,
  family: TrustDatasetFamily,
  cache: TtlCache<CachedReceiptPayload<T>>,
  key: string,
  traceId: string,
  dataStatus: DataStatusTracker,
  build: () => Promise<T>,
  expected: ReceiptExpectation = {},
): Promise<T & { receipt: DataReceipt }> {
  let computed = false;
  const entry = await cache.get(key, async () => {
    computed = true;
    return { payload: await build(), storedAt: Date.now() };
  });
  const now = Date.now();
  return attachProviderReceipt(
    provider,
    family,
    entry.payload,
    traceId,
    dataStatus,
    {
      status: computed ? 'miss' : 'hit',
      ageMs: computed ? 0 : Math.max(0, now - entry.storedAt),
    },
    now,
    expected,
  );
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
function registerVenueBoard<Row extends object & { receipt: DataReceipt }>(
  app: FastifyInstance,
  provider: DataProvider,
  dataStatus: DataStatusTracker,
  opts: {
    path: string;
    family: TrustDatasetFamily;
    ttlMs: number;
    /** Per-symbol upstream read + row compute; a throw drops the symbol. */
    compute: (symbol: string, traceId: string) => Promise<Row>;
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
    return serveBoard(provider, opts.family, cache, `${quote}|${limit}`, String(req.id), dataStatus, async () => {
      const rows = await trackProviderCall(provider, opts.family, dataStatus, () =>
        provider.screen({ quote, sort: 'volume', limit }),
      );
      let failed = 0;
      // Cast the resolved array: for a generic Row, TS widens Promise.all's
      // result to Awaited<Row>, which it can't prove equals Row. Every call
      // site's Row is a plain row object (never a promise), so this is sound.
      const board = (await Promise.all(
        rows.map(async (r): Promise<Row | null> => {
          try {
            return await opts.compute(r.symbol, String(req.id));
          } catch {
            failed += 1;
            return null;
          }
        }),
      )) as (Row | null)[];
      const successful = board.filter((row): row is Row => row !== null);
      const ranked = successful
        .filter((row) => opts.rank(row) !== null)
        .sort((a, b) => (opts.rank(b) ?? 0) - (opts.rank(a) ?? 0));
      const omitted = successful.filter((row) => opts.rank(row) === null);
      return {
        rows: ranked,
        failed,
        insufficient: omitted.length,
        // Keep returned-row lineage in display order, then append evidence for
        // rows omitted solely because their required signal was unavailable.
        evidenceReceipts: [...ranked, ...omitted].map((row) => row.receipt),
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
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.max(1, Math.floor(limitRaw)), 60) : 30;
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
      const perSymbol = await Promise.all(
        rows.map(async (r): Promise<{ events: LiquidationEvent[]; receipt: DataReceipt } | null> => {
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
            return {
              receipt: d.receipt,
              events: d.recentLiquidations.map((liquidation) => ({
                symbol: r.symbol,
                side: liquidation.side,
                price: liquidation.price,
                amount: liquidation.amount,
                value: liquidation.price * liquidation.amount,
                timestamp: liquidation.timestamp,
              })),
            };
          } catch {
            failed += 1;
            return null;
          }
        }),
      );
      const successful = perSymbol.filter(
        (result): result is { events: LiquidationEvent[]; receipt: DataReceipt } => result !== null,
      );
      const eventful = successful.filter((result) => result.events.length > 0);
      const events = eventful
        .flatMap((result) => result.events)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 120);
      const limitations = [
        ...(failed > 0
          ? [partialEvidenceLimitation(`${failed} of ${rows.length} symbol liquidation read(s) failed.`)]
          : []),
        'Public exchange liquidation feeds may be throttled or incomplete; event totals are not exhaustive.',
      ];
      const receipt = deriveRouteReceipt(
        provider,
        {
          family: 'liquidations',
          coverage: `${rows.length} screened perpetual symbol(s); latest 120 events retained.`,
          inputReceipts: [
            provenance.receipt,
            ...successful.map((result) => result.receipt),
          ],
          methodology: {
            id: 'midas.liquidations-feed',
            version: '1.0',
            formula: 'eventNotional = observedPrice * observedBaseAmount; merge newest-first; retain 120',
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
      const meta = withDataReceipt(normalizeLiquidationsMeta(provenance, Date.now()), receipt);
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
