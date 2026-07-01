import { describe, it, expect } from 'vitest';
import type { PlacedOrder } from '@midas/shared';
import { describeOrderTrack, isTerminalOrderStatus } from './orderTrack';

const order = (over: Partial<PlacedOrder> = {}): PlacedOrder => ({
  id: '42',
  clientOrderId: null,
  symbol: 'BTC/USDT',
  side: 'buy',
  type: 'limit',
  amount: 1,
  price: 60000,
  filled: 0,
  status: 'open',
  timestamp: 0,
  ...over,
});

describe('isTerminalOrderStatus', () => {
  it('treats executed and dead statuses as terminal, case-insensitively', () => {
    for (const s of ['closed', 'filled', 'canceled', 'cancelled', 'rejected', 'expired', 'Canceled', ' CLOSED ']) {
      expect(isTerminalOrderStatus(s)).toBe(true);
    }
  });

  it('keeps working states and unknowns non-terminal', () => {
    for (const s of ['open', 'partial', 'new', '', null, undefined]) {
      expect(isTerminalOrderStatus(s)).toBe(false);
    }
  });
});

describe('describeOrderTrack', () => {
  it('walks the progression: open → partially filled → filled', () => {
    const open = describeOrderTrack(order());
    expect(open).toEqual({ label: 'open — waiting for fills', tone: 'info', progress: 0, done: false });

    const partial = describeOrderTrack(order({ filled: 0.4 }));
    expect(partial.label).toBe('partially filled 0.4/1');
    expect(partial.tone).toBe('info');
    expect(partial.progress).toBeCloseTo(0.4);
    expect(partial.done).toBe(false);

    const filled = describeOrderTrack(order({ status: 'closed', filled: 1 }));
    expect(filled).toEqual({ label: 'filled 1/1', tone: 'up', progress: 1, done: true });
  });

  it('reports cancels honestly, keeping a partial fill visible', () => {
    expect(describeOrderTrack(order({ status: 'canceled' }))).toEqual({
      label: 'canceled',
      tone: 'down',
      progress: 0,
      done: true,
    });
    const partCancel = describeOrderTrack(order({ status: 'canceled', filled: 0.25 }));
    expect(partCancel.label).toBe('canceled — 0.25/1 filled');
    expect(partCancel.tone).toBe('down');
    expect(describeOrderTrack(order({ status: 'rejected' })).tone).toBe('down');
  });

  it('caps progress at 1 and yields null progress for an unknown size', () => {
    expect(describeOrderTrack(order({ filled: 1.2 })).progress).toBe(1);
    expect(describeOrderTrack(order({ amount: 0 })).progress).toBeNull();
  });
});
