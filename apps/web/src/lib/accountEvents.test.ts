import { describe, it, expect } from 'vitest';
import type { AccountOrderEvent } from '@midas/shared';
import { eventBody, eventHeadline, eventTone } from './accountEvents';

const ev = (over: Partial<AccountOrderEvent> = {}): AccountOrderEvent => ({
  id: 1,
  at: 0,
  kind: 'fill',
  orderId: '42',
  symbol: 'BTC/USDT',
  side: 'buy',
  price: 60000,
  amount: 1,
  filled: 0.4,
  filledDelta: 0.4,
  status: 'open',
  ...over,
});

describe('eventHeadline', () => {
  it('sizes fills by the newly filled amount, everything else by the order size', () => {
    expect(eventHeadline(ev())).toBe('Fill: BUY 0.4 BTC/USDT');
    expect(eventHeadline(ev({ kind: 'filled', filled: 1 }))).toBe('Order filled: BUY 1 BTC/USDT');
    expect(eventHeadline(ev({ kind: 'canceled', side: 'sell' }))).toBe('Order canceled: SELL 1 BTC/USDT');
    expect(eventHeadline(ev({ kind: 'new' }))).toBe('New order: BUY 1 BTC/USDT');
    expect(eventHeadline(ev({ kind: 'closed' }))).toBe('Order closed: BUY 1 BTC/USDT');
  });

  it('falls back to cumulative filled when a fill has no delta', () => {
    expect(eventHeadline(ev({ filledDelta: null }))).toBe('Fill: BUY 0.4 BTC/USDT');
  });
});

describe('eventBody', () => {
  it('shows fill progress, price and the order id', () => {
    expect(eventBody(ev())).toBe('0.4/1 filled · @ 60000 · order 42');
    expect(eventBody(ev({ kind: 'filled', filled: 1 }))).toBe('@ 60000 · order 42');
  });

  it('omits an unknown price and stays honest about unresolved closes', () => {
    expect(eventBody(ev({ kind: 'canceled', price: null }))).toBe('order 42');
    expect(eventBody(ev({ kind: 'closed' }))).toBe('@ 60000 · final status unknown · order 42');
  });
});

describe('eventTone', () => {
  it('colors executions by side and keeps lifecycle events neutral', () => {
    expect(eventTone(ev())).toBe('up'); // buy fill
    expect(eventTone(ev({ side: 'sell' }))).toBe('down');
    expect(eventTone(ev({ kind: 'filled', side: 'sell' }))).toBe('down');
    expect(eventTone(ev({ kind: 'new' }))).toBe('info');
    expect(eventTone(ev({ kind: 'canceled' }))).toBe('info');
    expect(eventTone(ev({ kind: 'closed' }))).toBe('info');
  });
});
