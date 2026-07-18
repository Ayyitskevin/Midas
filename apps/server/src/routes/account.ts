import type { FastifyInstance } from 'fastify';
import type { AccountFills, AccountPositions, Balances, OpenOrders } from '@midas/shared';
import { ProviderError } from '../providers';
import { EXECUTION_SAFETY_HOLD_REASON, executionSafetyHoldStatus } from '../trading';
import { normalizeSymbol } from './shared';
import type { ProviderResolver } from './shared';

const PER_USER_ACCOUNT_SOURCE = 'per-user-keys';
const PER_USER_ACCOUNT_UNAVAILABLE_NOTE =
  'No usable per-user exchange key is configured for this account. Save read-only credentials in KEYS. ' +
  'Operator account credentials are never used as a fallback.';

/**
 * Read-only account routes (balances, orders, positions, fills, single-order
 * lookup) plus the execution safety hold. Auth-guarded when auth is enabled
 * (these are not public prefixes). With the per-user store enabled, every
 * authenticated caller resolves to their OWN exchange client or an honest
 * unavailable snapshot — never the operator's env-keyed account. The two
 * mutation endpoints fail closed regardless of keys or environment flags.
 */
export function registerAccountRoutes(app: FastifyInstance, pool: ProviderResolver): void {
  const unavailableBalances = (): Balances => ({
    source: PER_USER_ACCOUNT_SOURCE,
    provenance: 'unavailable',
    note: PER_USER_ACCOUNT_UNAVAILABLE_NOTE,
    totalValueUsd: null,
    balances: [],
    asOf: Date.now(),
  });
  const unavailableOrders = (): OpenOrders => ({
    source: PER_USER_ACCOUNT_SOURCE,
    provenance: 'unavailable',
    note: PER_USER_ACCOUNT_UNAVAILABLE_NOTE,
    orders: [],
    asOf: Date.now(),
  });
  const unavailablePositions = (): AccountPositions => ({
    source: PER_USER_ACCOUNT_SOURCE,
    provenance: 'unavailable',
    note: PER_USER_ACCOUNT_UNAVAILABLE_NOTE,
    totalUnrealizedPnlUsd: null,
    positions: [],
    asOf: Date.now(),
  });
  const unavailableFills = (): AccountFills => ({
    source: PER_USER_ACCOUNT_SOURCE,
    provenance: 'unavailable',
    note: PER_USER_ACCOUNT_UNAVAILABLE_NOTE,
    fills: [],
    asOf: Date.now(),
  });

  app.get('/api/balances', async (req) =>
    pool.accountFor(req.userId)?.getBalances() ?? unavailableBalances(),
  );
  app.get('/api/orders', async (req) =>
    pool.accountFor(req.userId)?.getOpenOrders() ?? unavailableOrders(),
  );
  app.get('/api/positions', async (req) =>
    pool.accountFor(req.userId)?.getPositions() ?? unavailablePositions(),
  );
  app.get<{ Querystring: { symbol?: string } }>('/api/fills', async (req) => {
    const symbol = normalizeSymbol(req.query.symbol) || undefined;
    return pool.accountFor(req.userId)?.getFills(symbol) ?? unavailableFills();
  });
  // Read-only single-order lookup — powers TICKET's post-placement tracking
  // (placed → partial → filled/canceled) and the account watcher's
  // closed-order resolution. A read, so it is NOT gated by the trading
  // switches — only by the provider actually supporting the lookup.
  app.get<{ Params: { id: string }; Querystring: { symbol?: string } }>(
    '/api/orders/:id',
    async (req) => {
      const id = req.params.id.trim();
      const symbol = normalizeSymbol(req.query.symbol);
      if (!id) throw new ProviderError('Missing order id', 400);
      if (!symbol) throw new ProviderError('Missing symbol (most exchanges require it to look up an order)', 400);
      const reader = pool.accountFor(req.userId);
      if (!reader) throw new ProviderError(PER_USER_ACCOUNT_UNAVAILABLE_NOTE, 503);
      if (!reader.getOrder) throw new ProviderError('This provider cannot look up orders.', 501);
      return reader.getOrder(id, symbol);
    },
  );

  // --- Execution safety hold -------------------------------------------------
  // Market, account-read, paper, and preview routes stay available. The two
  // mutation endpoints fail closed regardless of keys or environment flags.
  // Existing resting orders must be managed directly at the exchange.
  app.get('/api/trading/status', async (req) => {
    // Keep the hold unconditional, but report the same account-data source
    // this caller's reads resolve to. A keyed user must not be told "mock"
    // while BAL/ORD/POSN/FILLS are served by their isolated ccxt provider.
    return executionSafetyHoldStatus(pool.accountFor(req.userId)?.name ?? PER_USER_ACCOUNT_SOURCE);
  });

  const safetyHoldResponse = () => ({
    error: 'TradingSafetyHold',
    message: EXECUTION_SAFETY_HOLD_REASON,
    statusCode: 503,
  });

  app.post('/api/orders', async (_req, reply) => {
    reply.status(503);
    return safetyHoldResponse();
  });

  app.delete('/api/orders/:id', async (_req, reply) => {
    reply.status(503);
    return safetyHoldResponse();
  });
}
