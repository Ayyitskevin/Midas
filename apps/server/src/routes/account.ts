import type { FastifyInstance } from 'fastify';
import type { AccountFills, AccountPositions, Balances, OpenOrders } from '@midas/shared';
import { withDataReceipt } from '@midas/shared';
import { ProviderError } from '../providers';
import { EXECUTION_SAFETY_HOLD_REASON, executionSafetyHoldStatus } from '../trading';
import { normalizeSymbol } from './shared';
import type { ProviderResolver } from './shared';
import type { DataStatusTracker } from '../dataStatus';
import type { DataStatusSource } from '../dataStatus';
import { DATA_ROUTE_PATHS } from '../dataCoverage';
import {
  buildProviderCapabilities,
  type CapabilityDefinition,
} from '../providers/receipts';
import {
  attachProviderReceipt,
  trackProviderCall,
  unavailableReceiptForSource,
} from './dataTrust';

const PER_USER_ACCOUNT_SOURCE = 'per-user-keys';
const PER_USER_ACCOUNT_UNAVAILABLE_NOTE =
  'No usable per-user exchange key is configured for this account. Save read-only credentials in KEYS. ' +
  'Operator account credentials are never used as a fallback.';

const unavailableAccountCapability = (method: string): CapabilityDefinition => ({
  method,
  support: 'conditional',
  auth: 'credentials-required',
  mode: 'unavailable',
  source: PER_USER_ACCOUNT_SOURCE,
  venue: null,
  coverage: 'Authenticated caller account only; no operator-account fallback.',
  expectedCadenceMs: null,
  maxAgeMs: null,
  cacheTtlMs: null,
  methodology: null,
  caveats: ['No usable per-user exchange key is configured.'],
});

/** Safe virtual manifest used only when this caller has no keyed account provider. */
export const PER_USER_ACCOUNT_STATUS_SOURCE: DataStatusSource = {
  name: PER_USER_ACCOUNT_SOURCE,
  capabilities: buildProviderCapabilities({
    providerId: PER_USER_ACCOUNT_SOURCE,
    providerVersion: '1.0',
    source: PER_USER_ACCOUNT_SOURCE,
    capabilities: {
      balances: unavailableAccountCapability('getBalances'),
      'account-orders': unavailableAccountCapability('getOpenOrders'),
      'account-positions': unavailableAccountCapability('getPositions'),
      'account-fills': unavailableAccountCapability('getFills'),
    },
  }),
};

/**
 * Read-only account routes (balances, orders, positions, fills, single-order
 * lookup) plus the execution posture. Auth-guarded when auth is enabled
 * (these are not public prefixes). With the per-user store enabled, every
 * authenticated caller resolves to their OWN exchange client or an honest
 * unavailable snapshot — never the operator's env-keyed account. Placement
 * fails closed regardless of keys or environment flags; cancellation is live
 * but ownership-gated (the order must sit in the caller's own open-orders
 * list before any cancel call is made).
 */
export function registerAccountRoutes(
  app: FastifyInstance,
  pool: ProviderResolver,
  dataStatus: DataStatusTracker,
  unavailableAccountSource: DataStatusSource,
): void {
  const unavailable = <T extends object>(
    payload: T,
    family: 'balances' | 'account-orders' | 'account-positions' | 'account-fills',
    traceId: string,
  ): T & { receipt: ReturnType<typeof unavailableReceiptForSource> } => {
    const receipt = unavailableReceiptForSource({
      providerId: PER_USER_ACCOUNT_SOURCE,
      providerVersion: '1.0',
      source: PER_USER_ACCOUNT_SOURCE,
      family,
      coverage: 'Authenticated caller account only; no operator-account fallback.',
      limitations: ['No usable per-user exchange key is configured.'],
      note: PER_USER_ACCOUNT_UNAVAILABLE_NOTE,
      traceId,
    });
    dataStatus.recordReceipt(unavailableAccountSource, receipt, 'not-configured');
    return withDataReceipt(payload, receipt);
  };
  const unavailableBalances = (traceId: string): Balances =>
    unavailable(
      {
        source: PER_USER_ACCOUNT_SOURCE,
        provenance: 'unavailable' as const,
        note: PER_USER_ACCOUNT_UNAVAILABLE_NOTE,
        totalValueUsd: null,
        balances: [],
        asOf: Date.now(),
      },
      'balances',
      traceId,
    );
  const unavailableOrders = (traceId: string): OpenOrders =>
    unavailable(
      {
        source: PER_USER_ACCOUNT_SOURCE,
        provenance: 'unavailable' as const,
        note: PER_USER_ACCOUNT_UNAVAILABLE_NOTE,
        orders: [],
        asOf: Date.now(),
      },
      'account-orders',
      traceId,
    );
  const unavailablePositions = (traceId: string): AccountPositions =>
    unavailable(
      {
        source: PER_USER_ACCOUNT_SOURCE,
        provenance: 'unavailable' as const,
        note: PER_USER_ACCOUNT_UNAVAILABLE_NOTE,
        totalUnrealizedPnlUsd: null,
        positions: [],
        asOf: Date.now(),
      },
      'account-positions',
      traceId,
    );
  const unavailableFills = (traceId: string): AccountFills =>
    unavailable(
      {
        source: PER_USER_ACCOUNT_SOURCE,
        provenance: 'unavailable' as const,
        note: PER_USER_ACCOUNT_UNAVAILABLE_NOTE,
        fills: [],
        asOf: Date.now(),
      },
      'account-fills',
      traceId,
    );

  app.get(DATA_ROUTE_PATHS.balances, async (req) => {
    const provider = pool.accountFor(req.userId);
    if (!provider) return unavailableBalances(String(req.id));
    const payload = await trackProviderCall(provider, 'balances', dataStatus, () => provider.getBalances());
    return attachProviderReceipt(provider, 'balances', payload, String(req.id), dataStatus);
  });
  app.get(DATA_ROUTE_PATHS.orders, async (req) => {
    const provider = pool.accountFor(req.userId);
    if (!provider) return unavailableOrders(String(req.id));
    const payload = await trackProviderCall(provider, 'account-orders', dataStatus, () => provider.getOpenOrders());
    return attachProviderReceipt(provider, 'account-orders', payload, String(req.id), dataStatus);
  });
  app.get(DATA_ROUTE_PATHS.positions, async (req) => {
    const provider = pool.accountFor(req.userId);
    if (!provider) return unavailablePositions(String(req.id));
    const payload = await trackProviderCall(provider, 'account-positions', dataStatus, () => provider.getPositions());
    return attachProviderReceipt(provider, 'account-positions', payload, String(req.id), dataStatus);
  });
  app.get<{ Querystring: { symbol?: string } }>(DATA_ROUTE_PATHS.fills, async (req) => {
    const symbol = normalizeSymbol(req.query.symbol) || undefined;
    const provider = pool.accountFor(req.userId);
    if (!provider) return unavailableFills(String(req.id));
    const payload = await trackProviderCall(provider, 'account-fills', dataStatus, () => provider.getFills(symbol));
    return attachProviderReceipt(
      provider,
      'account-fills',
      payload,
      String(req.id),
      dataStatus,
      undefined,
      undefined,
      { instrument: symbol },
    );
  });
  // Read-only single-order lookup — powers TICKET's post-placement tracking
  // (placed → partial → filled/canceled) and the account watcher's
  // closed-order resolution. A read, so it is NOT gated by the trading
  // switches — only by the provider actually supporting the lookup.
  app.get<{ Params: { id: string }; Querystring: { symbol?: string } }>(
    DATA_ROUTE_PATHS.order,
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

  // --- Execution posture: cancel-only ---------------------------------------
  // Market, account-read, paper, and preview routes stay available. Order
  // PLACEMENT fails closed regardless of keys or environment flags. Order
  // CANCELLATION is live for the authenticated owner of the order: it is
  // risk-reducing (moves no funds, needs no notional caps), and forcing a
  // trader to context-switch to the exchange UI to pull a resting order in a
  // fast market is itself a safety hazard.
  app.get(DATA_ROUTE_PATHS.tradingStatus, async (req) => {
    // Keep the placement hold unconditional, but report the same account-data
    // source this caller's reads resolve to. A keyed user must not be told
    // "mock" while BAL/ORD/POSN/FILLS are served by their isolated ccxt
    // provider.
    return executionSafetyHoldStatus(pool.accountFor(req.userId)?.name ?? PER_USER_ACCOUNT_SOURCE);
  });

  const safetyHoldResponse = () => ({
    error: 'TradingSafetyHold',
    message: EXECUTION_SAFETY_HOLD_REASON,
    statusCode: 503,
  });

  app.post(DATA_ROUTE_PATHS.orders, async (_req, reply) => {
    reply.status(503);
    return safetyHoldResponse();
  });

  app.delete<{ Params: { id: string }; Querystring: { symbol?: string } }>(
    DATA_ROUTE_PATHS.order,
    async (req) => {
      const id = req.params.id.trim();
      if (!id || id.length > 128) throw new ProviderError('Missing or malformed order id', 400);
      // Resolve exactly like the account reads do: the operator session's base
      // provider, or the caller's own per-user key — NEVER an operator-account
      // fallback for a keyed deployment (pool.accountFor enforces this).
      const account = pool.accountFor(req.userId);
      if (!account) throw new ProviderError(PER_USER_ACCOUNT_UNAVAILABLE_NOTE, 503);
      // Ownership proof BEFORE touching the exchange: the id must appear in
      // THIS caller's open-orders list. An id that isn't there gets a 404 —
      // never a blind cancel call.
      const open = await account.getOpenOrders();
      const mine = open.orders.find((o) => o.id === id);
      if (!mine) {
        throw new ProviderError(
          `Order ${id} is not among this account's open orders — it may already be filled or canceled, or belong to a different account.`,
          404,
        );
      }
      if (!account.cancelOrder) {
        throw new ProviderError('This provider cannot cancel orders.', 501);
      }
      // The exchange needs the symbol for most venues; trust the caller's own
      // open-orders entry, with the query param as an override.
      const symbol = normalizeSymbol(req.query.symbol) || mine.symbol;
      // Provider outcomes are already honest: confirmed → 200 CancelResult,
      // already filled/canceled → 409, timeout/unknown → 502 "outcome unknown".
      return account.cancelOrder(id, symbol);
    },
  );
}
