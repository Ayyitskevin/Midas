import { describe, it, expect } from 'vitest';
import {
  computeTradingStatus,
  validateOrderRequest,
  estimateNotionalUsd,
  mapPlacedOrder,
  type TradingConfig,
} from './trading';
import type { OrderRequest } from '@midas/shared';

const liveCtx = { providerName: 'ccxt:binance', providerLive: true, hasKeys: true };
// Every gate passing: master on, live provider, keys, auth on.
const onCfg: TradingConfig = { enabled: true, allowNoAuth: false, maxOrderUsd: 1000, authEnabled: true };

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

  it('refuses to trade without auth unless explicitly overridden', () => {
    const noAuth = computeTradingStatus({ ...onCfg, authEnabled: false }, liveCtx);
    expect(noAuth.enabled).toBe(false);
    expect(noAuth.reason).toMatch(/without auth/i);
    // explicit escape hatch
    const overridden = computeTradingStatus({ ...onCfg, authEnabled: false, allowNoAuth: true }, liveCtx);
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
