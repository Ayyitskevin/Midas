/**
 * Structural coverage map for route-level data receipts.
 *
 * This is intentionally about HTTP surfaces, not provider methods. A provider
 * capability says whether an upstream can supply a dataset; this registry says
 * whether the API preserves/derives a receipt for that dataset before returning
 * it to a caller. The structural test registers the real Fastify routes and
 * compares them with this map, so adding a GET under market/account routes
 * requires an explicit receipt decision here.
 */

export const DATA_ROUTE_PATHS = {
  health: '/api/health',
  dataStatus: '/api/data/status',
  quote: '/api/quote/:symbol',
  quotes: '/api/quotes',
  history: '/api/history/:symbol',
  orderBook: '/api/orderbook/:symbol',
  exchangeQuotes: '/api/exchange-quotes/:symbol',
  venueDerivatives: '/api/venue-derivatives/:symbol',
  derivatives: '/api/derivatives/:symbol',
  onChain: '/api/onchain/:symbol',
  fundingHistory: '/api/funding-history/:symbol',
  screener: '/api/screener',
  coins: '/api/coins',
  dvol: '/api/options/dvol',
  optionsChain: '/api/options/chain',
  termStructure: '/api/futures/term-structure',
  oiDelta: '/api/oi-delta',
  funding: '/api/funding',
  fundingDispersion: '/api/funding-dispersion',
  venueArb: '/api/venue-arb',
  oiConcentration: '/api/oi-concentration',
  liquidations: '/api/liquidations',
  search: '/api/search',
  news: '/api/news',
  balances: '/api/balances',
  orders: '/api/orders',
  positions: '/api/positions',
  fills: '/api/fills',
  order: '/api/orders/:id',
  tradingStatus: '/api/trading/status',
} as const;

export type DataRoutePath = (typeof DATA_ROUTE_PATHS)[keyof typeof DATA_ROUTE_PATHS];

export type DataRouteCoverage =
  | { state: 'receipt'; families: readonly string[] }
  | { state: 'not-applicable'; families: readonly string[]; reason: string }
  | {
      state: 'temporary-exemption';
      families: readonly string[];
      reason: string;
      backlog: string;
    };

export interface DataRouteCoverageEntry {
  path: DataRoutePath;
  coverage: DataRouteCoverage;
}

const receipt = (...families: string[]): DataRouteCoverage => ({ state: 'receipt', families });
const notApplicable = (reason: string): DataRouteCoverage => ({
  state: 'not-applicable',
  families: [],
  reason,
});
const exempt = (families: string[], reason: string, backlog: string): DataRouteCoverage => ({
  state: 'temporary-exemption',
  families,
  reason,
  backlog,
});

/**
 * Every GET registered by routes/market.ts, routes/account.ts and
 * routes/dataStatus.ts appears exactly once. Keep exemptions narrow and
 * actionable: each one records both the compatibility reason and the concrete
 * follow-up needed to remove it.
 */
export const DATA_ROUTE_COVERAGE: readonly DataRouteCoverageEntry[] = [
  {
    path: DATA_ROUTE_PATHS.health,
    coverage: notApplicable('Process liveness metadata; it does not return a market or account observation.'),
  },
  {
    path: DATA_ROUTE_PATHS.dataStatus,
    coverage: notApplicable('Trust-plane self-description assembled from sanitized receipt health.'),
  },
  { path: DATA_ROUTE_PATHS.quote, coverage: receipt('quote') },
  { path: DATA_ROUTE_PATHS.quotes, coverage: receipt('quote') },
  { path: DATA_ROUTE_PATHS.history, coverage: receipt('history') },
  {
    path: DATA_ROUTE_PATHS.orderBook,
    coverage: exempt(
      ['order-book'],
      'Level-2 depth is outside the bounded v1 receipt slice.',
      'Add an order-book capability plus per-snapshot receipt before treating depth as trusted evidence.',
    ),
  },
  { path: DATA_ROUTE_PATHS.exchangeQuotes, coverage: receipt('venue-quotes') },
  {
    path: DATA_ROUTE_PATHS.venueDerivatives,
    coverage: receipt('venue-derivatives'),
  },
  {
    path: DATA_ROUTE_PATHS.derivatives,
    coverage: receipt('derivatives'),
  },
  {
    path: DATA_ROUTE_PATHS.onChain,
    coverage: exempt(
      ['on-chain'],
      'DEX/on-chain datasets are outside the bounded v1 receipt slice.',
      'Declare provider capability and attach pool-level observation receipts in a later trust-plane slice.',
    ),
  },
  {
    path: DATA_ROUTE_PATHS.fundingHistory,
    coverage: receipt('funding-history'),
  },
  {
    path: DATA_ROUTE_PATHS.screener,
    coverage: exempt(
      ['screener'],
      'The broad screener is outside the bounded v1 receipt slice.',
      'Add a screener dataset receipt that records ticker coverage and partial failures.',
    ),
  },
  {
    path: DATA_ROUTE_PATHS.coins,
    coverage: exempt(
      ['coin-universe'],
      'Market-cap reference data is outside the bounded v1 receipt slice.',
      'Add reference-provider capability, cadence and coverage receipts.',
    ),
  },
  { path: DATA_ROUTE_PATHS.dvol, coverage: receipt('options') },
  { path: DATA_ROUTE_PATHS.optionsChain, coverage: receipt('options') },
  { path: DATA_ROUTE_PATHS.termStructure, coverage: receipt('options') },
  { path: DATA_ROUTE_PATHS.oiDelta, coverage: receipt('open-interest-delta') },
  { path: DATA_ROUTE_PATHS.funding, coverage: receipt('funding') },
  { path: DATA_ROUTE_PATHS.fundingDispersion, coverage: receipt('funding') },
  { path: DATA_ROUTE_PATHS.venueArb, coverage: receipt('venue-arbitrage') },
  { path: DATA_ROUTE_PATHS.oiConcentration, coverage: receipt('open-interest') },
  { path: DATA_ROUTE_PATHS.liquidations, coverage: receipt('liquidations') },
  {
    path: DATA_ROUTE_PATHS.search,
    coverage: notApplicable('Symbol discovery contains no trusted numeric market or account value.'),
  },
  {
    path: DATA_ROUTE_PATHS.news,
    coverage: notApplicable('News discovery is outside the numeric data-trust contract.'),
  },
  { path: DATA_ROUTE_PATHS.balances, coverage: receipt('balances') },
  { path: DATA_ROUTE_PATHS.orders, coverage: receipt('account-orders') },
  { path: DATA_ROUTE_PATHS.positions, coverage: receipt('account-positions') },
  { path: DATA_ROUTE_PATHS.fills, coverage: receipt('account-fills') },
  {
    path: DATA_ROUTE_PATHS.order,
    coverage: exempt(
      ['account-orders'],
      'The legacy single-order shape has no provenance envelope.',
      'Add a read-only order-observation receipt without changing cancel ownership checks.',
    ),
  },
  {
    path: DATA_ROUTE_PATHS.tradingStatus,
    coverage: notApplicable('Execution posture metadata; order placement remains held independently.'),
  },
] as const;

export const RECEIPT_ROUTE_PATHS = new Set(
  DATA_ROUTE_COVERAGE.filter((entry) => entry.coverage.state === 'receipt').map((entry) => entry.path),
);
