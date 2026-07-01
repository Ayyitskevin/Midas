import type { OrderRequest, PlacedOrder, TradingStatus } from '@midas/shared';

/**
 * Live-trading safety core — pure, defensive, and heavily tested. Live order
 * placement is OFF by default and gated by defense in depth: a master switch,
 * a live keyed provider, an auth requirement (with an explicit override), and a
 * hard per-order notional cap. The actual `createOrder` call lives in the ccxt
 * provider and is only reachable when {@link computeTradingStatus} reports
 * enabled AND the request passes validation AND the notional cap.
 *
 * Keeping every gate here pure means the rules are unit-testable without a live
 * exchange — which, for code that can move real money, is the point.
 */
export interface TradingConfig {
  /** MIDAS_TRADING_ENABLED — the master switch. */
  enabled: boolean;
  /** MIDAS_TRADING_ALLOW_NO_AUTH — permit trading without login on a trusted host. */
  allowNoAuth: boolean;
  /** MIDAS_MAX_ORDER_USD — hard per-order notional cap (0 = uncapped). */
  maxOrderUsd: number;
  /** MIDAS_MAX_DAILY_USD — cumulative UTC-day notional cap (0 = uncapped). */
  maxDailyUsd: number;
  /** MIDAS_AUTH_ENABLED — whether the API requires login. */
  authEnabled: boolean;
  /** MIDAS_CORS_ORIGIN — allowed browser origin ('*' = any). */
  corsOrigin: string;
}

export interface ProviderContext {
  /** Provider id, e.g. 'ccxt:binance' or 'mock'. */
  providerName: string;
  /** True only for a live upstream (ccxt); mock/yahoo are false. */
  providerLive: boolean;
  /** Whether read/trade API keys are configured. */
  hasKeys: boolean;
}

/**
 * Effective trading status — every gate must pass. Returns the reasons it is off
 * so the operator (via the UI) sees exactly what to fix. Pure.
 */
export function computeTradingStatus(
  cfg: TradingConfig,
  ctx: ProviderContext,
  dailyUsedUsd = 0,
): TradingStatus {
  const reasons: string[] = [];
  if (!cfg.enabled) reasons.push('Set MIDAS_TRADING_ENABLED=true to enable live order placement.');
  if (!ctx.providerLive) reasons.push('Live trading requires the ccxt provider (MIDAS_DATA_PROVIDER=ccxt).');
  if (!ctx.hasKeys) reasons.push('Set MIDAS_CCXT_API_KEY and MIDAS_CCXT_SECRET (keys must have trade permission).');
  if (!cfg.authEnabled) {
    if (!cfg.allowNoAuth) {
      reasons.push(
        'Refusing to trade without auth — set MIDAS_AUTH_ENABLED=true, or MIDAS_TRADING_ALLOW_NO_AUTH=true to override on a trusted host.',
      );
    } else if (cfg.corsOrigin.trim() === '*') {
      // No-auth + wildcard CORS is a CSRF vector: a page the operator visits
      // could POST an order to a localhost/LAN instance cross-origin (auth would
      // otherwise require a bearer token that browsers don't send cross-site).
      // Force a pinned origin so the browser's preflight blocks foreign pages.
      reasons.push(
        'Refusing to trade with no auth and a wildcard CORS origin — a malicious web page could place orders cross-origin. Set a specific MIDAS_CORS_ORIGIN, or enable MIDAS_AUTH_ENABLED.',
      );
    }
  }
  const enabled = reasons.length === 0;
  return {
    enabled,
    reason: enabled
      ? 'Live trading is ENABLED — orders placed here are real and will execute on the exchange.'
      : reasons.join(' '),
    maxOrderUsd: cfg.maxOrderUsd > 0 ? cfg.maxOrderUsd : null,
    dailyCapUsd: cfg.maxDailyUsd > 0 ? cfg.maxDailyUsd : null,
    dailyUsedUsd,
    source: ctx.providerName,
  };
}

/**
 * Rolling UTC-day notional ledger. A per-order cap alone doesn't stop a
 * runaway loop or a fat-fingered session from firing dozens of just-under-cap
 * orders — the daily ledger bounds the whole day's exposure. In-memory by
 * design (resets on restart; the restart IS the kill switch), clock injected
 * for testability.
 */
export interface DailyLedger {
  used(nowMs: number): number;
  add(notionalUsd: number, nowMs: number): void;
}

export function createDailyLedger(): DailyLedger {
  let day = '';
  let used = 0;
  const roll = (nowMs: number) => {
    const key = new Date(nowMs).toISOString().slice(0, 10); // UTC day
    if (key !== day) {
      day = key;
      used = 0;
    }
  };
  return {
    used(nowMs) {
      roll(nowMs);
      return used;
    },
    add(notionalUsd, nowMs) {
      roll(nowMs);
      used += Math.max(0, notionalUsd);
    },
  };
}

/** Reject reason when an order would push the day over its cumulative cap; null when allowed. Pure. */
export function checkDailyCap(capUsd: number | null, usedUsd: number, notionalUsd: number): string | null {
  if (capUsd == null || capUsd <= 0) return null;
  if (usedUsd + notionalUsd <= capUsd) return null;
  return (
    `Order notional ~$${Math.round(notionalUsd)} would push today's total to ` +
    `$${Math.round(usedUsd + notionalUsd)}, over the daily cap of $${capUsd} ` +
    `(raise MIDAS_MAX_DAILY_USD or wait for the UTC day to roll).`
  );
}

export interface OrderValidation {
  ok: boolean;
  errors: string[];
}

/** Validate a raw order body, defensively. Pure. */
export function validateOrderRequest(body: unknown): OrderValidation {
  const b = body as Partial<OrderRequest> | null | undefined;
  if (!b || typeof b !== 'object') return { ok: false, errors: ['Missing order body.'] };
  const errors: string[] = [];
  if (typeof b.symbol !== 'string' || !b.symbol.trim()) errors.push('symbol is required.');
  if (b.side !== 'buy' && b.side !== 'sell') errors.push("side must be 'buy' or 'sell'.");
  if (b.type !== 'market' && b.type !== 'limit') errors.push("type must be 'market' or 'limit'.");
  if (!(typeof b.amount === 'number' && Number.isFinite(b.amount) && b.amount > 0)) {
    errors.push('amount must be a positive number.');
  }
  if (b.type === 'limit' && !(typeof b.price === 'number' && Number.isFinite(b.price) && b.price > 0)) {
    errors.push('limit orders require a positive price.');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Estimated USD notional for the cap check: limit uses its own price, market uses
 * the supplied reference price. Returns null when it can't be priced — the caller
 * treats null as "can't bound risk → reject" (fail safe). Pure.
 */
export function estimateNotionalUsd(req: OrderRequest, refPrice: number | null): number | null {
  const px = req.type === 'limit' ? req.price ?? null : refPrice;
  if (px == null || !(px > 0)) return null;
  return req.amount * px;
}

/**
 * Server-side idempotency for order placement. The clientOrderId is forwarded
 * to the exchange, but not every venue honors it — so a network retry or a
 * double-submit could place twice. Remembering recent (id → result) pairs lets
 * the route return the original acknowledgement instead of re-placing. Bounded
 * (LRU-ish, insertion-order eviction) and TTL'd; the clock is injected so the
 * behavior is unit-testable.
 */
export interface IdempotencyCache {
  recall(id: string, nowMs: number): PlacedOrder | null;
  remember(id: string, order: PlacedOrder, nowMs: number): void;
  size(): number;
}

export function createIdempotencyCache(ttlMs = 10 * 60_000, maxEntries = 500): IdempotencyCache {
  const entries = new Map<string, { at: number; order: PlacedOrder }>();
  return {
    recall(id, nowMs) {
      if (!id) return null;
      const hit = entries.get(id);
      if (!hit) return null;
      if (nowMs - hit.at > ttlMs) {
        entries.delete(id);
        return null;
      }
      return hit.order;
    },
    remember(id, order, nowMs) {
      if (!id) return;
      entries.set(id, { at: nowMs, order });
      if (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
    },
    size: () => entries.size,
  };
}

const toNum = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Map a ccxt `createOrder` result to our PlacedOrder, falling back to the request. Pure. */
export function mapPlacedOrder(raw: unknown, req: OrderRequest): PlacedOrder {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(o.id) || str(o.clientOrderId) || '—',
    clientOrderId: str(o.clientOrderId) || req.clientOrderId || null,
    symbol: str(o.symbol) || req.symbol,
    side: o.side === 'sell' ? 'sell' : 'buy',
    type: str(o.type) || req.type,
    price: toNum(o.price) ?? (req.type === 'limit' ? req.price ?? null : null),
    amount: toNum(o.amount) ?? req.amount,
    filled: toNum(o.filled) ?? 0,
    status: str(o.status) || 'open',
    timestamp: toNum(o.timestamp),
  };
}
