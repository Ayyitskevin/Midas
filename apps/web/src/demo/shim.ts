import { MIDAS_VERSION } from '@midas/shared';
import type { HealthResponse, SystemStatus, TradingStatus } from '@midas/shared';
import {
  DEMO_SOURCE,
  balancesFor,
  derivativesFor,
  dexPoolsFor,
  fillsFor,
  fundingHistoryFor,
  fundingRows,
  historyFor,
  liquidationsFeed,
  newsFor,
  openOrdersFor,
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
  venueDerivatives,
  venueQuotes,
} from './engine';

/**
 * The static demo's API — a fetch wrapper that answers /api/* from the
 * in-browser engine, so the whole terminal runs from a static host (GitHub
 * Pages) with no server at all. Anything the demo can't honestly provide
 * answers 501 with an explanation, and every response is labeled synthetic.
 */

const DEMO_VERSION = MIDAS_VERSION;
const startedAt = Date.now();

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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
      message: 'Execution safety hold: order placement and in-app cancellation are disabled. Order preview remains available.',
      statusCode: 503,
    },
    503,
  );

const notFound = (symbol: string): Response =>
  json({ error: 'NotFound', message: `Unknown demo symbol ${symbol} — try BTC/USDT, ETH/USDT, SOL/USDT…`, statusCode: 404 }, 404);

function handle(method: string, url: URL): Response | null {
  const path = url.pathname.replace(/^.*?\/api\//, '/api/');
  const seg = (i: number): string => decodeURIComponent(path.split('/')[i] ?? '');
  const now = Date.now();

  if (method !== 'GET') {
    if (path.startsWith('/api/alerts')) return unavailable('The server-side alert engine');
    if (path.startsWith('/api/orders')) return executionHeld();
    if (path.startsWith('/api/auth')) return unavailable('Accounts');
    if (path.startsWith('/api/account/keys')) return unavailable('Per-user exchange keys');
    return unavailable('This action');
  }

  switch (true) {
    case path === '/api/health': {
      const body: HealthResponse = {
        status: 'ok',
        provider: DEMO_SOURCE,
        live: false,
        time: now,
        version: DEMO_VERSION,
        demo: true,
      };
      return json(body);
    }
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
      return q ? json(q) : notFound(seg(3));
    }
    case path === '/api/quotes': {
      const symbols = (url.searchParams.get('symbols') ?? '').split(',').filter(Boolean);
      return json(symbols.map((s) => quoteFor(s, now)).filter(Boolean));
    }
    case path.startsWith('/api/history/'): {
      const h = historyFor(seg(3), url.searchParams.get('interval') ?? '1h', url.searchParams.get('range') ?? '1mo', now);
      return h ? json(h) : notFound(seg(3));
    }
    case path.startsWith('/api/orderbook/'): {
      const b = orderBookFor(seg(3), Number(url.searchParams.get('depth') ?? 20), now);
      return b ? json(b) : notFound(seg(3));
    }
    case path === '/api/search':
      return json(searchFor(url.searchParams.get('q') ?? ''));
    case path.startsWith('/api/derivatives/'): {
      const d = derivativesFor(seg(3), now);
      return d ? json(d) : notFound(seg(3));
    }
    case path === '/api/funding':
      return json(fundingRows(url.searchParams.get('quote') ?? 'USDT', Number(url.searchParams.get('limit') ?? 30), now));
    case path.startsWith('/api/funding-history/'):
      return json(fundingHistoryFor(seg(3), Number(url.searchParams.get('limit') ?? 90), now));
    case path.startsWith('/api/exchange-quotes/'):
      return json(venueQuotes(seg(3), now));
    case path.startsWith('/api/venue-derivatives/'):
      return json(venueDerivatives(seg(3), now));
    case path === '/api/screener':
      return json(
        screenerRows(
          url.searchParams.get('quote') ?? 'USDT',
          url.searchParams.get('sort') ?? 'volume',
          Number(url.searchParams.get('limit') ?? 50),
          now,
        ),
      );
    case path === '/api/liquidations':
      return json(liquidationsFeed(url.searchParams.get('quote') ?? 'USDT', Number(url.searchParams.get('limit') ?? 30), now));
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
    case path === '/api/news' || path.startsWith('/api/news/'):
      return json(newsFor(path === '/api/news' ? undefined : seg(3), now));
    case path === '/api/balances':
      return json(balancesFor(now));
    case path === '/api/orders':
      return json(openOrdersFor(now));
    case path === '/api/positions':
      return json(positionsFor(now));
    case path === '/api/fills':
      return json(fillsFor(now));
    case path.startsWith('/api/orders/'):
      return unavailable('Order lookup');
    case path === '/api/trading/status': {
      const body: TradingStatus = {
        enabled: false,
        reason: 'This is the public static demo. Midas execution is under a server safety hold; order preview remains available.',
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
      return json({ error: 'NotConfigured', message: 'The AI copilot needs a server with an API key.', statusCode: 503 }, 503);
    default:
      return unavailable('This endpoint');
  }
}

/** Answer /api/* in-browser; pass every other request through untouched. */
export function installDemoShim(): void {
  const w = window as Window & { __MIDAS_STATIC_DEMO__?: boolean };
  if (w.__MIDAS_STATIC_DEMO__) return;
  w.__MIDAS_STATIC_DEMO__ = true; // stream.ts checks this and stays offline

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
