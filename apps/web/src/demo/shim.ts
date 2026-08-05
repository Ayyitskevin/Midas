import { CROSS_VENUE_SCREEN_SORTS, isOiDeltaWindow, MIDAS_VERSION, type CrossVenueScreenSort } from '@midas/shared';
import type {
  BoardEnvelope,
  DataMethodology,
  DataReceipt,
  HealthResponse,
  SystemStatus,
  TradingStatus,
  TrustDatasetFamily,
} from '@midas/shared';
import {
  DEMO_SOURCE,
  balancesFor,
  boardEnvelope,
  coinUniverseFor,
  derivativesFor,
  dexPoolsFor,
  dvolFor,
  fillsFor,
  fundingDispersionRows,
  fundingHistoryFor,
  fundingRows,
  historyFor,
  liquidationsFeed,
  venueScreenRows,
  venueScreenerRows,
  newsFor,
  oiConcentrationRows,
  oiDeltaFor,
  openOrdersFor,
  optionsChainFor,
  orderBookFor,
  positionsFor,
  quoteFor,
  screenerRows,
  searchFor,
  solanaDexPoolsFor,
  solanaMarketFor,
  solanaNetworkFor,
  solanaQuoteFor,
  solanaStakingFor,
  solanaTokenFor,
  solanaTrendingFor,
  solanaValidatorsFor,
  solanaWalletFor,
  termStructureFor,
  venueArbRows,
  venueDerivatives,
  venueQuotes,
} from './engine';
import { demoDataStatus, demoDerivedReceipt, demoReceipt, withDemoReceipt } from './trust';

/**
 * The static demo's API — a fetch wrapper that answers /api/* from the
 * in-browser engine, so the whole terminal runs from a static host (GitHub
 * Pages) with no server at all. Anything the demo can't honestly provide
 * answers 501 with an explanation, and every response is labeled synthetic.
 */

const DEMO_VERSION = MIDAS_VERSION;
const startedAt = Date.now();
const MAX_OPTIONS_EXPIRY_MS = 4_102_444_800_000;

const latestDemoReceipts = new Map<TrustDatasetFamily, DataReceipt>();
const lastSuccessfulDemoReceipts = new Map<TrustDatasetFamily, DataReceipt>();

function captureDemoReceipts(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) captureDemoReceipts(item);
    return;
  }
  if (value == null || typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  const candidate = object.receipt as Partial<DataReceipt> | undefined;
  if (candidate?.schemaVersion === '1.0' && typeof candidate.receiptId === 'string' && candidate.datasetFamily) {
    const receipt = candidate as DataReceipt;
    latestDemoReceipts.set(receipt.datasetFamily, receipt);
    if (receipt.provenance !== 'unavailable') lastSuccessfulDemoReceipts.set(receipt.datasetFamily, receipt);
  }
  if (Array.isArray(object.rows)) captureDemoReceipts(object.rows);
  if (object.meta) captureDemoReceipts(object.meta);
}

const json = (body: unknown, status = 200): Response => {
  if (status >= 200 && status < 300) captureDemoReceipts(body);
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
};

const unavailable = (what: string): Response =>
  json(
    {
      error: 'DemoUnavailable',
      message: `${what} isn't part of the static demo — deploy your own Midas (docker compose up -d) for the full server.`,
      statusCode: 501,
    },
    501,
  );

const executionHeld = (): Response =>
  json(
    {
      error: 'TradingSafetyHold',
      message: 'Execution safety hold: order placement is disabled. Order preview remains available; canceling your own resting orders works on a real server (cancel-only mode).',
      statusCode: 503,
    },
    503,
  );

const notFound = (symbol: string): Response =>
  json({ error: 'NotFound', message: `Unknown demo symbol ${symbol} — try BTC/USDT, ETH/USDT, SOL/USDT…`, statusCode: 404 }, 404);

/**
 * A positive numeric query param, or the default when absent / empty / non-numeric.
 * Mirrors the server's `Number.isFinite && > 0` guard — `Number('')` is 0 and
 * `Number('x')` is NaN, either of which would otherwise yield an empty response.
 */
const numParam = (v: string | null, dflt: number): number => {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) && n > 0 ? n : dflt;
};

/** The AI copilot needs a server API key — a 503 NotConfigured, not the demo's generic 501. */
const aiUnavailable = (): Response =>
  json({ error: 'NotConfigured', message: 'The AI copilot needs a server with an API key.', statusCode: 503 }, 503);

function withDemoDerived<T extends object>(
  payload: T,
  datasetFamily: TrustDatasetFamily,
  instrument: string | null,
  now: number,
  inputFamily: TrustDatasetFamily,
  methodology: DataMethodology,
  limitations: readonly string[] = [],
): T & { receipt: DataReceipt } {
  const input = demoReceipt(inputFamily, instrument, now);
  return {
    ...payload,
    receipt: demoDerivedReceipt(datasetFamily, instrument, now, [input], methodology, { limitations }),
  };
}

function withDemoBoard<T extends { receipt?: DataReceipt }>(
  rows: T[],
  datasetFamily: TrustDatasetFamily,
  now: number,
  methodology: DataMethodology,
): BoardEnvelope<T> {
  const inputs = rows.flatMap((row) => (row.receipt ? [row.receipt] : []));
  // An empty board still has evidence for the attempted synthetic fan-out; it
  // never borrows a prior row or fabricates a numeric value.
  const lineage = inputs.length > 0 ? inputs : [demoReceipt(datasetFamily, null, now)];
  const envelope = boardEnvelope(rows, now);
  return {
    ...envelope,
    meta: {
      ...envelope.meta,
      receipt: demoDerivedReceipt(datasetFamily, null, now, lineage, methodology),
    },
  };
}

function handle(method: string, url: URL): Response | null {
  const path = url.pathname.replace(/^.*?\/api\//, '/api/');
  const seg = (i: number): string => decodeURIComponent(path.split('/')[i] ?? '');
  const now = Date.now();

  if (method !== 'GET') {
    if (path.startsWith('/api/alerts')) return unavailable('The server-side alert engine');
    // Placement mirrors the server's fail-closed hold exactly. Cancellation is
    // live on a real server, but the in-browser demo has no account to cancel
    // against — it answers like the demo's other unavailable mutations.
    if (method === 'POST' && path === '/api/orders') return executionHeld();
    if (path.startsWith('/api/orders')) return unavailable('In-browser order cancellation');
    if (path.startsWith('/api/auth')) return unavailable('Accounts');
    if (path.startsWith('/api/account/keys')) return unavailable('Per-user exchange keys');
    // The AI copilot is a POST; without this it fell to the generic 501 below
    // instead of the intended NotConfigured 503 (its GET case never runs).
    if (path.startsWith('/api/ai/')) return aiUnavailable();
    return unavailable('This action');
  }

  switch (true) {
    case path === '/api/health': {
      const body: HealthResponse = {
        status: 'ok',
        provider: DEMO_SOURCE,
        live: false,
        streamLive: false, // the static demo never opens a live socket; its data is synthetic
        time: now,
        version: DEMO_VERSION,
        demo: true,
      };
      return json(body);
    }
    case path === '/api/data/status':
      return json(demoDataStatus(now, latestDemoReceipts, lastSuccessfulDemoReceipts));
    case path === '/api/system': {
      const body: SystemStatus = {
        provider: DEMO_SOURCE,
        live: false,
        demo: true,
        version: DEMO_VERSION,
        startedAt,
        accountWatch: { on: false, intervalMs: null },
        streamNudge: false,
        digest: { on: false, hours: null },
        equity: { on: false, intervalMs: null },
        tradingEnabled: false,
        authEnabled: false,
      };
      return json(body);
    }
    case path.startsWith('/api/quote/'): {
      const q = quoteFor(seg(3), now);
      return q
        ? json(withDemoReceipt(q, 'quote', q.symbol, now, { sourceAsOf: q.asOf, units: { price: q.currency } }))
        : notFound(seg(3));
    }
    case path === '/api/quotes': {
      const symbols = (url.searchParams.get('symbols') ?? '').split(',').map((symbol) => symbol.trim()).filter(Boolean);
      if (symbols.length === 0) {
        return json({ error: 'ProviderError', message: 'Missing or invalid symbols', statusCode: 400 }, 400);
      }
      const quotes = symbols.map((symbol) => quoteFor(symbol, now));
      const missingIndex = quotes.findIndex((quote) => quote == null);
      if (missingIndex >= 0) return notFound(symbols[missingIndex]);
      return json(quotes.map((quote) =>
        withDemoReceipt(quote!, 'quote', quote!.symbol, now, {
          sourceAsOf: quote!.asOf,
          units: { price: quote!.currency },
        })));
    }
    case path.startsWith('/api/history/'): {
      const h = historyFor(seg(3), url.searchParams.get('interval') ?? '1d', url.searchParams.get('range') ?? '6mo', now);
      const latest = h?.candles.at(-1)?.time;
      return h
        ? json(
            withDemoReceipt(h, 'history', h.symbol, now, {
              sourceAsOf: latest == null ? null : latest * 1_000,
              coverage: `${h.interval} candles over ${h.range}`,
              units: { open: h.currency, high: h.currency, low: h.currency, close: h.currency, volume: 'base' },
              limitations: latest == null ? ['History series contains no source timestamp.'] : [],
            }),
          )
        : notFound(seg(3));
    }
    case path.startsWith('/api/orderbook/'): {
      const b = orderBookFor(seg(3), numParam(url.searchParams.get('depth'), 20), now);
      return b ? json(b) : notFound(seg(3));
    }
    case path === '/api/search':
      return json(searchFor(url.searchParams.get('q') ?? ''));
    case path.startsWith('/api/derivatives/'): {
      const d = derivativesFor(seg(3), now);
      return d
        ? json(
            withDemoReceipt(d, 'derivatives', seg(3), now, {
              sourceAsOf: d.timestamp,
              coverage: 'funding, open interest, mark/index and synthetic liquidation fields',
              units: { fundingRate: 'fraction', markPrice: 'quote', indexPrice: 'quote', openInterest: 'base' },
            }),
          )
        : notFound(seg(3));
    }
    case path === '/api/funding': {
      // The fan-out boards answer in the shared BoardEnvelope shape, exactly
      // like the server (provenance 'synthetic', asOf now, cachedAt null).
      const rows = fundingRows(
        url.searchParams.get('quote') ?? 'USDT',
        numParam(url.searchParams.get('limit'), 30),
        now,
      ).map((row) =>
        withDemoDerived(row, 'funding', row.symbol, now, 'derivatives', {
          id: 'funding-board-projection',
          version: '1',
          formula: 'fundingRate, markPrice, openInterestValue := derivatives snapshot fields',
        }),
      );
      return json(
        withDemoBoard(rows, 'funding', now, {
          id: 'funding-board-fanout',
          version: '1',
          formula: 'rows := top synthetic instruments projected from derivatives snapshots',
        }),
      );
    }
    case path === '/api/funding-dispersion': {
      const rows = fundingDispersionRows(
        url.searchParams.get('quote') ?? 'USDT',
        numParam(url.searchParams.get('limit'), 15),
        now,
      ).map((row) => ({
        ...row,
        receipt: demoDerivedReceipt(
          'funding',
          row.symbol,
          now,
          venueDerivatives(row.symbol, now).flatMap((input) => (input.receipt ? [input.receipt] : [])),
          {
            id: 'funding-dispersion',
            version: '1',
            formula: 'max(normalized funding) - min(normalized funding)',
          },
        ),
      }));
      return json(
        withDemoBoard(rows, 'funding', now, {
          id: 'funding-dispersion-board',
          version: '1',
          formula: 'rows := per-symbol funding dispersion sorted descending',
        }),
      );
    }
    case path.startsWith('/api/funding-history/'): {
      const symbol = seg(3);
      const points = fundingHistoryFor(symbol, numParam(url.searchParams.get('limit'), 90), now);
      if (points.length === 0) return notFound(symbol);
      return json(
        points.map((point) =>
          withDemoReceipt(point, 'funding-history', symbol, now, {
            sourceAsOf: point.time,
            units: { fundingRate: 'fraction' },
          }),
        ),
      );
    }
    case path.startsWith('/api/exchange-quotes/'): {
      const symbol = seg(3);
      const quotes = venueQuotes(symbol, now);
      if (quotes.length === 0) return notFound(symbol);
      return json(
        quotes.map((quote) =>
          withDemoReceipt(quote, 'venue-quotes', symbol, now, {
            venue: quote.exchange,
            sourceAsOf: quote.timestamp,
            units: { price: 'quote', bid: 'quote', ask: 'quote', bidSize: 'base', askSize: 'base' },
          }),
        ),
      );
    }
    case path === '/api/venue-arb': {
      const rows = venueArbRows(
        url.searchParams.get('quote') ?? 'USDT',
        numParam(url.searchParams.get('limit'), 15),
        now,
      ).map((row) => ({
        ...row,
        receipt: demoDerivedReceipt(
          'venue-arbitrage',
          row.symbol,
          now,
          venueQuotes(row.symbol, now).flatMap((input) => (input.receipt ? [input.receipt] : [])),
          {
            id: 'venue-arbitrage-net',
            version: '1',
            formula: '(bestBid - bestAsk) / bestAsk - buyFee - sellFee; requires size and <=10s skew',
          },
          { limitations: row.netLimitations },
        ),
      }));
      return json(
        withDemoBoard(rows, 'venue-arbitrage', now, {
          id: 'venue-arbitrage-board',
          version: '1',
          formula: 'rows := per-symbol cross-venue dispersion sorted descending',
        }),
      );
    }
    case path === '/api/oi-concentration': {
      const rows = oiConcentrationRows(
        url.searchParams.get('quote') ?? 'USDT',
        numParam(url.searchParams.get('limit'), 15),
        now,
      ).map((row) => ({
        ...row,
        receipt: demoDerivedReceipt(
          'open-interest',
          row.symbol,
          now,
          venueDerivatives(row.symbol, now).flatMap((input) => (input.receipt ? [input.receipt] : [])),
          {
            id: 'open-interest-concentration',
            version: '1',
            formula: 'venue shares and Herfindahl index from non-null OI notionals',
          },
        ),
      }));
      return json(
        withDemoBoard(rows, 'open-interest', now, {
          id: 'open-interest-concentration-board',
          version: '1',
          formula: 'rows := per-symbol OI concentration sorted by total notional',
        }),
      );
    }
    // OI-delta positioning — synthetic parity with the server, same edge rules.
    case path === '/api/oi-delta': {
      const sym = url.searchParams.get('symbol') ?? '';
      if (!sym) return json({ error: 'ProviderError', message: 'Missing or invalid symbol', statusCode: 400 }, 400);
      const window = url.searchParams.get('window') ?? '24h';
      // Mirror the server's edge: the window whitelist is 1h/4h/24h/7d.
      if (!isOiDeltaWindow(window)) {
        return json({ error: 'ProviderError', message: 'Invalid window — expected one of: 1h, 4h, 24h, 7d', statusCode: 400 }, 400);
      }
      const delta = oiDeltaFor(sym, window, now);
      if (delta.provenance === 'unavailable') {
        return json({
          ...delta,
          receipt: demoReceipt('open-interest-delta', sym, now, {
            provenance: 'unavailable',
            sourceAsOf: null,
            note: delta.note,
            limitations: ['No matching static-demo open-interest or price fixture exists.'],
          }),
        });
      }
      const inputs = [
        demoReceipt('open-interest-history', sym, now, { sourceAsOf: delta.asOf }),
        demoReceipt('history', sym, now, { sourceAsOf: delta.asOf }),
      ];
      return json({
        ...delta,
        receipt: demoDerivedReceipt(
          'open-interest-delta',
          sym,
          now,
          inputs,
          {
            id: 'oi-price-positioning',
            version: '1',
            formula: 'percent change in OI and price over aligned lookback, classified into four quadrants',
          },
          { units: { oiChangePct: 'percent', priceChangePct: 'percent' } },
        ),
      });
    }
    // Options / DVOL / term structure — synthetic parity with the server.
    case path === '/api/options/dvol': {
      const raw = (url.searchParams.get('symbol') ?? '').toUpperCase().split('/')[0];
      // Mirror the server's edge: DVOL is published for BTC and ETH only.
      if (raw !== 'BTC' && raw !== 'ETH') {
        return json({ error: 'ProviderError', message: 'DVOL is published for BTC and ETH only', statusCode: 400 }, 400);
      }
      const dvol = dvolFor(raw as 'BTC' | 'ETH', now);
      return json(withDemoReceipt(dvol, 'options', raw, now, { sourceAsOf: dvol.asOf, units: { value: 'volatility-index' } }));
    }
    case path === '/api/options/chain': {
      const sym = url.searchParams.get('symbol') ?? '';
      if (!sym) return json({ error: 'ProviderError', message: 'Missing or invalid symbol', statusCode: 400 }, 400);
      const rawExpiry = url.searchParams.get('expiry') ?? 'nearest';
      const expiry = rawExpiry === 'nearest' ? ('nearest' as const) : Number(rawExpiry);
      if (
        expiry !== 'nearest' &&
        (!Number.isFinite(expiry) || expiry <= 0 || expiry > MAX_OPTIONS_EXPIRY_MS)
      ) {
        return json({ error: 'ProviderError', message: 'Invalid expiry — expected "nearest" or an epoch-millis expiry', statusCode: 400 }, 400);
      }
      const chain = optionsChainFor(sym, expiry === 'nearest' ? expiry : Math.floor(expiry), now);
      if (chain.provenance === 'unavailable') {
        return json({
          ...chain,
          receipt: demoReceipt('options', sym, now, {
            provenance: 'unavailable',
            sourceAsOf: null,
            note: chain.note,
            limitations: ['No matching static-demo options fixture exists.'],
          }),
        });
      }
      const input = demoReceipt('options', sym, now, {
        sourceAsOf: chain.asOf,
        coverage: 'Synthetic per-strike call/put observations',
        units: { mark: 'USD', impliedVol: 'fraction', openInterest: 'contracts' },
      });
      return json({
        ...chain,
        receipt: demoDerivedReceipt(
          'options',
          sym,
          now,
          [input],
          {
            id: 'options-chain-summary',
            version: '1',
            formula: 'max-pain payout minimization; put open interest / call open interest',
          },
          { units: { mark: 'USD', impliedVol: 'fraction', openInterest: 'contracts' } },
        ),
      });
    }
    case path === '/api/futures/term-structure': {
      const sym = url.searchParams.get('symbol') ?? '';
      if (!sym) return json({ error: 'ProviderError', message: 'Missing or invalid symbol', statusCode: 400 }, 400);
      const term = termStructureFor(sym, now);
      if (term.provenance === 'unavailable') {
        return json({
          ...term,
          receipt: demoReceipt('options', sym, now, {
            provenance: 'unavailable',
            sourceAsOf: null,
            note: term.note,
            limitations: ['No matching static-demo futures fixture exists.'],
          }),
        });
      }
      const input = demoReceipt('options', sym, now, {
        sourceAsOf: term.asOf,
        coverage: 'Synthetic perpetual and dated-futures observations',
        units: { price: 'USD' },
      });
      return json({
        ...term,
        receipt: demoDerivedReceipt(
          'options',
          sym,
          now,
          [input],
          {
            id: 'annualized-simple-basis',
            version: '1',
            formula: '(future / spot - 1) * 365 / daysToExpiry * 100',
          },
          { units: { price: 'USD', annualizedBasisPct: 'percent' } },
        ),
      });
    }
    case path.startsWith('/api/venue-derivatives/'): {
      const symbol = seg(3);
      const snapshots = venueDerivatives(symbol, now);
      if (snapshots.length === 0) return notFound(symbol);
      return json(
        snapshots.map((snapshot) =>
          withDemoReceipt(snapshot, 'venue-derivatives', symbol, now, {
            venue: snapshot.exchange,
            sourceAsOf: snapshot.timestamp,
            coverage: 'funding and open-interest snapshot',
            units: { fundingRate: 'fraction', markPrice: 'quote', openInterestValue: 'quote' },
          }),
        ),
      );
    }
    // Cross-venue screener — synthetic parity with the server, same edge rules.
    case path === '/api/venue-screener': {
      const sort = url.searchParams.get('sort') ?? 'volume';
      if (!(CROSS_VENUE_SCREEN_SORTS as readonly string[]).includes(sort)) {
        return json(
          {
            error: 'ProviderError',
            message: `Invalid screener sort — expected one of: ${CROSS_VENUE_SCREEN_SORTS.join(', ')}`,
            statusCode: 400,
          },
          400,
        );
      }
      const quote = url.searchParams.get('quote') ?? 'USDT';
      const venueInputs = venueScreenRows(quote, now).map((venue) =>
        demoReceipt('venue-screener', null, now, {
          venue: venue.exchange,
          sourceAsOf: venue.timestamp,
          coverage: `${venue.rows.length} synthetic pair(s) for this venue`,
        }),
      );
      const rows = venueScreenerRows(
        quote,
        sort as CrossVenueScreenSort,
        numParam(url.searchParams.get('limit'), 50),
        now,
      ).map((row) => ({
        ...row,
        receipt: demoDerivedReceipt('venue-screener', row.symbol, now, venueInputs, {
          id: 'cross-venue-screener',
          version: '1',
          formula:
            'totalQuoteVolume := sum(venue quoteVolume); price := volume-weighted, else median, else single venue',
        }),
      }));
      return json(
        withDemoBoard(rows, 'venue-screener', now, {
          id: 'cross-venue-screener-board',
          version: '1',
          formula: 'rows := per-symbol cross-venue aggregate, ranked by the requested key',
        }),
      );
    }
    case path === '/api/screener': {
      const sort = url.searchParams.get('sort') ?? 'volume';
      // Mirror the server's edge validation: an unknown sort is a 400, not a
      // silent fallback to volume order.
      if (!['volume', 'change', 'price'].includes(sort)) {
        return json(
          { error: 'ProviderError', message: 'Invalid screener sort — expected one of: volume, change, price', statusCode: 400 },
          400,
        );
      }
      return json(
        screenerRows(
          url.searchParams.get('quote') ?? 'USDT',
          sort,
          numParam(url.searchParams.get('limit'), 50),
          now,
        ),
      );
    }
    case path === '/api/coins':
      return json(coinUniverseFor(numParam(url.searchParams.get('limit'), 100), now));
    case path === '/api/liquidations': {
      const feed = liquidationsFeed(
        url.searchParams.get('quote') ?? 'USDT',
        numParam(url.searchParams.get('limit'), 30),
        now,
      );
      const input = demoReceipt('derivatives', null, now, {
        sourceAsOf: feed.meta.asOf,
        coverage: 'Synthetic derivative market fixture used to generate demonstration events',
      });
      const receipt = demoDerivedReceipt(
        'liquidations',
        null,
        now,
        [input],
        {
          id: 'demo-liquidation-estimate',
          version: '1',
          formula: 'deterministic fixture events estimated from the demo derivative market world',
        },
        {
          units: { price: 'quote', amount: 'base', value: 'quote' },
          limitations: ['Events are generated estimates, not observed exchange liquidation events.'],
        },
      );
      return json({ ...feed, receipt, meta: { ...feed.meta, receipt } });
    }
    case path.startsWith('/api/onchain/'):
      return json(dexPoolsFor(seg(3), now));
    // Solana endpoints carry an extra 'solana' segment, so the address is seg(4).
    case path === '/api/solana/network':
      return json(solanaNetworkFor(now));
    case path === '/api/solana/trending':
      return json(solanaTrendingFor(now));
    case path === '/api/solana/validators':
      return json(solanaValidatorsFor(now));
    case path === '/api/solana/staking':
      return json(solanaStakingFor(now));
    case path === '/api/solana/market':
      return json(solanaMarketFor(now));
    case path.startsWith('/api/solana/wallet/'):
      return json(solanaWalletFor(seg(4), now));
    case path.startsWith('/api/solana/pools/'):
      return json(solanaDexPoolsFor(seg(4), now));
    case path.startsWith('/api/solana/token/'):
      return json(solanaTokenFor(seg(4), now));
    case path.startsWith('/api/solana/quote/'):
      return json(solanaQuoteFor(seg(4), seg(5), Number(seg(6)), now));
    case path === '/api/news' || path.startsWith('/api/news/'): {
      // The client sends the symbol as ?symbol= (see api.news); the /api/news/:symbol
      // path form is a fallback. Server's /api/news reads req.query.symbol too.
      const sym = url.searchParams.get('symbol') || (path === '/api/news' ? '' : seg(3));
      return json(newsFor(sym || undefined, now));
    }
    case path === '/api/balances': {
      const balances = balancesFor(now);
      return json(
        withDemoReceipt(balances, 'balances', null, now, {
          sourceAsOf: balances.asOf,
          coverage: 'Synthetic demo account; no private exchange connection',
          units: { free: 'asset', used: 'asset', total: 'asset', valueUsd: 'USD' },
        }),
      );
    }
    case path === '/api/orders': {
      const orders = openOrdersFor(now);
      return json(withDemoReceipt(orders, 'account-orders', null, now, { sourceAsOf: orders.asOf }));
    }
    case path === '/api/positions': {
      const positions = positionsFor(now);
      return json(withDemoReceipt(positions, 'account-positions', null, now, { sourceAsOf: positions.asOf }));
    }
    case path === '/api/fills': {
      // The server's /api/fills honours ?symbol= (getFills(symbol)); pass it through
      // so a symbol-scoped FILLS panel doesn't show other symbols' fills.
      const fills = fillsFor(now, url.searchParams.get('symbol') || undefined);
      return json(
        withDemoReceipt(fills, 'account-fills', url.searchParams.get('symbol'), now, { sourceAsOf: fills.asOf }),
      );
    }
    case path.startsWith('/api/orders/'):
      return unavailable('Order lookup');
    case path === '/api/trading/status': {
      const body: TradingStatus = {
        enabled: false,
        // The static demo has no account at all, so even the server's
        // cancel-only surface is honestly unavailable here.
        cancelEnabled: false,
        mode: 'off',
        reason: 'This is the public static demo. On a real server Midas runs cancel-only: order placement is held, canceling your own resting orders is live. Order preview remains available.',
        maxOrderUsd: null,
        dailyCapUsd: null,
        dailyUsedUsd: 0,
        source: DEMO_SOURCE,
      };
      return json(body);
    }
    case path === '/api/account/events':
      return json({ watching: false, latestId: 0, events: [], note: 'The account watcher needs a real server — this demo is fully in-browser.' });
    case path === '/api/account/equity':
      return json({ watching: false, note: 'Equity snapshots need a real server — this demo is fully in-browser.', points: [] });
    case path === '/api/account/keys':
      return unavailable('Per-user exchange keys');
    case path === '/api/auth/status':
      return json({ enabled: false, allowSignup: false });
    case path.startsWith('/api/auth/'):
      return unavailable('Accounts');
    case path.startsWith('/api/alerts'):
      return unavailable('The server-side alert engine (local alerts work — they run in this tab)');
    case path.startsWith('/api/workspaces') || path.startsWith('/api/portfolio') || path.startsWith('/api/watchlists') || path.startsWith('/api/notes'):
      return unavailable('Server sync');
    case path.startsWith('/api/ai/'):
      return aiUnavailable();
    default:
      return unavailable('This endpoint');
  }
}

/** Answer /api/* in-browser; pass every other request through untouched. */
export function installDemoShim(): void {
  const w = window as Window & { __MIDAS_STATIC_DEMO__?: boolean };
  if (w.__MIDAS_STATIC_DEMO__) return;
  w.__MIDAS_STATIC_DEMO__ = true; // stream.ts checks this and stays offline
  latestDemoReceipts.clear();
  lastSuccessfulDemoReceipts.clear();

  const realFetch = window.fetch.bind(window);
  // window.location exists in every real browser; the fallback keeps the shim
  // testable in a node environment.
  const baseHref = (): string =>
    typeof window.location !== 'undefined' && window.location?.href ? window.location.href : 'http://localhost/';
  const demoFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const base = baseHref();
    const url = new URL(raw, base);
    if (url.origin === new URL(base).origin && url.pathname.includes('/api/')) {
      const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET') ?? 'GET').toUpperCase();
      const res = handle(method, url);
      if (res) return res;
    }
    return realFetch(input as RequestInfo, init);
  };
  // In a browser window IS globalThis; in test environments they can differ,
  // so patch both to make the interception unambiguous.
  window.fetch = demoFetch;
  globalThis.fetch = demoFetch as typeof fetch;
}
