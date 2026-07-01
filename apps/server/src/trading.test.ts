import { describe, it, expect } from 'vitest';
import {
  computeTradingStatus,
  createIdempotencyCache,
  validateOrderRequest,
  estimateNotionalUsd,
  mapPlacedOrder,
  type TradingConfig,
} from './trading';
import type { PlacedOrder } from '@midas/shared';
import type { OrderRequest } from '@midas/shared';

const liveCtx = { providerName: 'ccxt:binance', providerLive: true, hasKeys: true };
// Every gate passing: master on, live provider, keys, auth on.
const onCfg: TradingConfig = {
  enabled: true,
  allowNoAuth: false,
  maxOrderUsd: 1000,
  authEnabled: true,
  corsOrigin: '*',
};

describe('computeTradingStatus — defense in depth', () => {
  it('is enabled only when every gate passes', () => {
    const s = computeTradingStatus(onCfg, liveCtx);
    expect(s.enabled).toBe(true);
    expect(s.maxOrderUsd).toBe(1000);
    expect(s.reason).toMatch(/ENABLED/);
  });

  it('is OFF by default (master switch off), explaining how to enable', () => {
    const s = computeTradingStatus({ ...onCfg, enabled: false }, liveCtx);
    expect(s.enabled).toBe(false);
    expect(s.reason).toMatch(/MIDAS_TRADING_ENABLED/);
  });

  it('refuses a non-live provider and missing keys', () => {
    expect(computeTradingStatus(onCfg, { ...liveCtx, providerLive: false }).enabled).toBe(false);
    expect(computeTradingStatus(onCfg, { ...liveCtx, hasKeys: false }).enabled).toBe(false);
  });

  it('refuses to trade without auth unless overridden AND a CORS origin is pinned', () => {
    const noAuth = computeTradingStatus({ ...onCfg, authEnabled: false }, liveCtx);
    expect(noAuth.enabled).toBe(false);
    expect(noAuth.reason).toMatch(/without auth/i);

    // The no-auth override alone is not enough with wildcard CORS — that is a
    // CSRF vector (a malicious page could place orders cross-origin).
    const wildcard = computeTradingStatus(
      { ...onCfg, authEnabled: false, allowNoAuth: true, corsOrigin: '*' },
      liveCtx,
    );
    expect(wildcard.enabled).toBe(false);
    expect(wildcard.reason).toMatch(/cross-origin|CORS/i);

    // Override + a pinned CORS origin → the browser preflight blocks foreign
    // pages, so trading may enable.
    const overridden = computeTradingStatus(
      { ...onCfg, authEnabled: false, allowNoAuth: true, corsOrigin: 'http://localhost:5173' },
      liveCtx,
    );
    expect(overridden.enabled).toBe(true);
  });

  it('reports an uncapped configuration as maxOrderUsd null', () => {
    expect(computeTradingStatus({ ...onCfg, maxOrderUsd: 0 }, liveCtx).maxOrderUsd).toBeNull();
  });
});

describe('validateOrderRequest', () => {
  it('accepts a well-formed limit order', () => {
    expect(validateOrderRequest({ symbol: 'BTC/USDT', side: 'buy', type: 'limit', amount: 0.1, price: 60000 }).ok).toBe(true);
  });

  it('requires a price for limit orders and a positive amount', () => {
    expect(validateOrderRequest({ symbol: 'BTC/USDT', side: 'buy', type: 'limit', amount: 0.1 }).errors.join(' ')).toMatch(/price/i);
    expect(validateOrderRequest({ symbol: 'BTC/USDT', side: 'buy', type: 'market', amount: 0 }).errors.join(' ')).toMatch(/amount/i);
  });

  it('rejects bad side/type and a missing body', () => {
    expect(validateOrderRequest({ symbol: 'BTC/USDT', side: 'long', type: 'market', amount: 1 }).ok).toBe(false);
    expect(validateOrderRequest({ symbol: 'BTC/USDT', side: 'buy', type: 'stop', amount: 1 }).ok).toBe(false);
    expect(validateOrderRequest(null).ok).toBe(false);
  });
});

describe('estimateNotionalUsd', () => {
  const mkt: OrderRequest = { symbol: 'BTC/USDT', side: 'buy', type: 'market', amount: 0.5 };
  const lim: OrderRequest = { symbol: 'BTC/USDT', side: 'buy', type: 'limit', amount: 0.5, price: 60000 };

  it('uses the limit price for limit orders', () => {
    expect(estimateNotionalUsd(lim, 99999)).toBe(30000); // 0.5 * 60000, ignores refPrice
  });
  it('uses the reference price for market orders', () => {
    expect(estimateNotionalUsd(mkt, 60000)).toBe(30000);
  });
  it('returns null (fail safe) when a market order cannot be priced', () => {
    expect(estimateNotionalUsd(mkt, null)).toBeNull();
    expect(estimateNotionalUsd(mkt, 0)).toBeNull();
  });
});

describe('createIdempotencyCache', () => {
  const order = (id: string): PlacedOrder => ({
    id,
    clientOrderId: id,
    symbol: 'BTC/USDT',
    side: 'buy',
    type: 'limit',
    amount: 1,
    price: 100,
    filled: 0,
    status: 'open',
    timestamp: 0,
  });

  it('returns the original result for a duplicate clientOrderId within the TTL', () => {
    const cache = createIdempotencyCache(1000);
    cache.remember('abc', order('1'), 0);
    expect(cache.recall('abc', 500)?.id).toBe('1'); // retry → same ack, no re-place
    expect(cache.recall('other', 500)).toBeNull();
  });

  it('expires entries past the TTL and ignores empty ids', () => {
    const cache = createIdempotencyCache(1000);
    cache.remember('abc', order('1'), 0);
    expect(cache.recall('abc', 1500)).toBeNull(); // expired
    cache.remember('', order('2'), 0);
    expect(cache.size()).toBe(0); // '' never stored ('abc' was deleted on expiry)
  });

  it('evicts the oldest entry beyond the size bound', () => {
    const cache = createIdempotencyCache(60_000, 2);
    cache.remember('a', order('1'), 0);
    cache.remember('b', order('2'), 0);
    cache.remember('c', order('3'), 0);
    expect(cache.size()).toBe(2);
    expect(cache.recall('a', 1)).toBeNull(); // oldest evicted
    expect(cache.recall('c', 1)?.id).toBe('3');
  });
});

describe('mapPlacedOrder', () => {
  const req: OrderRequest = { symbol: 'BTC/USDT', side: 'buy', type: 'limit', amount: 0.1, price: 60000, clientOrderId: 'abc' };

  it('maps a ccxt order result', () => {
    const p = mapPlacedOrder(
      { id: '42', clientOrderId: 'abc', symbol: 'BTC/USDT', side: 'buy', type: 'limit', price: 60000, amount: 0.1, filled: 0, status: 'open', timestamp: 1700000000000 },
      req,
    );
    expect(p).toEqual({
      id: '42',
      clientOrderId: 'abc',
      symbol: 'BTC/USDT',
      side: 'buy',
      type: 'limit',
      price: 60000,
      amount: 0.1,
      filled: 0,
      status: 'open',
      timestamp: 1700000000000,
    });
  });

  it('falls back to the request when fields are missing', () => {
    const p = mapPlacedOrder({}, req);
    expect(p.symbol).toBe('BTC/USDT');
    expect(p.amount).toBe(0.1);
    expect(p.price).toBe(60000);
    expect(p.clientOrderId).toBe('abc');
    expect(p.status).toBe('open');
  });
});
