import { describe, it, expect } from 'vitest';
import { ordersBadge, positionsBadge } from './accountReadsView';
import type { AccountPositions, OpenOrders } from '@midas/shared';

const orders = (over: Partial<OpenOrders>): OpenOrders => ({
  source: 'mock',
  provenance: 'synthetic',
  note: null,
  orders: [],
  asOf: 0,
  ...over,
});

const positions = (over: Partial<AccountPositions>): AccountPositions => ({
  source: 'mock',
  provenance: 'synthetic',
  note: null,
  totalUnrealizedPnlUsd: null,
  positions: [],
  asOf: 0,
  ...over,
});

describe('ordersBadge', () => {
  it('labels a live keyed read green, naming the source', () => {
    const b = ordersBadge(orders({ provenance: 'live', source: 'ccxt:binance' }));
    expect(b.tone).toBe('live');
    expect(b.label).toBe('live');
    expect(b.detail).toMatch(/ccxt:binance/);
  });

  it('labels a synthetic demo set amber as not real', () => {
    const b = ordersBadge(orders({ provenance: 'synthetic' }));
    expect(b.tone).toBe('synthetic');
    expect(b.label).toBe('demo');
    expect(b.detail).toMatch(/not a real account/i);
  });

  it('surfaces the provider note when unavailable', () => {
    const b = ordersBadge(orders({ provenance: 'unavailable', note: 'need read-only keys' }));
    expect(b.tone).toBe('unavailable');
    expect(b.detail).toBe('need read-only keys');
  });
});

describe('positionsBadge', () => {
  it('labels live/synthetic/unavailable with positions wording', () => {
    expect(positionsBadge(positions({ provenance: 'live', source: 'ccxt:bybit' })).detail).toMatch(/ccxt:bybit/);
    expect(positionsBadge(positions({ provenance: 'synthetic' })).label).toBe('demo');
    expect(positionsBadge(positions({ provenance: 'unavailable' })).tone).toBe('unavailable');
  });
});
