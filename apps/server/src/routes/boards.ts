import type { FastifyInstance } from 'fastify';
import { partialEvidenceLimitation } from '@midas/shared';
import type {
  BoardEnvelope,
  BoardProvenance,
  VenueArbRow,
  DataReceipt,
  TrustDatasetFamily,
} from '@midas/shared';
import type { DataProvider } from '../providers';
import { createTtlCache, type TtlCache } from '../ttlCache';
import { normalizeQuote } from './shared';
import type { DataStatusTracker } from '../dataStatus';
import {
  attachProviderReceipt,
  deriveRouteReceipt,
  receiptHasPartialEvidence,
  trackProviderCall,
  transportDerivedReceipt,
  unavailableReceipt,
  type ReceiptCarrier,
  type ReceiptExpectation,
} from './dataTrust';

/**
 * What a board TTL cache stores: the rows plus the build-time facts the
 * envelope meta needs — when the board was computed (→ `asOf`, and `cachedAt`
 * on a stale serve) and how many symbols failed and were dropped (→ `partial`
 * and the note). Stamping the cache entry means a cached serve reports the
 * board's true age and completeness instead of looking freshly computed.
 */
export interface CachedBoard<Row> {
  rows: Row[];
  computedAt: number;
  failed: number;
  insufficient: number;
  partialRows: number;
  total: number;
  receipt: DataReceipt;
}

export interface CachedReceiptPayload<T> {
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
export async function serveBoard<Row extends object & { receipt: DataReceipt }>(
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

export async function serveReceiptPayload<T extends object & ReceiptCarrier>(
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
export function registerVenueBoard<Row extends object & { receipt: DataReceipt }>(
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
