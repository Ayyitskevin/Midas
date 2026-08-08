import { describe, expect, it } from 'vitest';
import type { AccountOrderEvent } from '@midas/shared';
import type { DigestRecapEvidence } from '../recap';
import {
  MAX_FILL_EVENTS_PER_DELIVERY,
  buildDigestWebhookPayload,
  buildFillWebhookPayload,
} from './payload';

const event = (
  kind: AccountOrderEvent['kind'],
  over: Partial<AccountOrderEvent> = {},
): AccountOrderEvent => ({
  id: 1,
  at: 1_700_000_000_000,
  kind,
  orderId: 'order-1',
  symbol: 'BTC/USDT',
  side: 'buy',
  price: 42_000,
  amount: 0.5,
  filled: kind === 'fill' || kind === 'filled' ? 0.5 : 0,
  filledDelta: kind === 'fill' || kind === 'filled' ? 0.5 : null,
  status: kind === 'filled' ? 'closed' : 'open',
  ...over,
});

describe('fill webhook payload', () => {
  it('returns null unless an existing fill or filled event is present', () => {
    expect(
      buildFillWebhookPayload([
        event('new'),
        event('canceled'),
        event('closed'),
      ]),
    ).toBeNull();
  });

  it('allowlists deterministic execution fields without disclosing private order metadata', () => {
    const input = [
      {
        ...event('new', { id: 1, orderId: 'ignore-me' }),
        cookie: 'session-cookie-secret',
      },
      {
        ...event('fill', {
          id: 2,
          orderId: 'api-key-secret',
          status: 'authorization-bearer-secret',
          symbol: `BTC/${'U'.repeat(100)}`,
          price: Number.NaN,
          amount: Number.POSITIVE_INFINITY,
          at: Number.NaN,
        }),
        authenticationHeader: 'Bearer should-never-ship',
      },
      event('filled', { id: 3, orderId: 'private-order-id', side: 'sell' }),
    ] as AccountOrderEvent[];

    const first = buildFillWebhookPayload(input);
    const second = buildFillWebhookPayload(input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      version: 1,
      type: 'midas.account.fills',
      observedAt: 1_700_000_000_000,
      omitted: 0,
    });
    expect(first?.events.map(({ kind }) => kind)).toEqual(['fill', 'filled']);
    expect(first?.events[0]).toEqual({
      kind: 'fill',
      symbol: `BTC/${'U'.repeat(60)}`,
      side: 'buy',
      price: null,
      amount: null,
      filled: 0.5,
      filledDelta: 0.5,
      observedAt: 0,
    });
    expect(first?.content).toBe(first?.text);
    expect(first?.text.length).toBeLessThanOrEqual(1_900);

    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain('api-key-secret');
    expect(serialized).not.toContain('authorization-bearer-secret');
    expect(serialized).not.toContain('session-cookie-secret');
    expect(serialized).not.toContain('private-order-id');
    expect(serialized).not.toContain('authenticationHeader');
    expect(Object.keys(first?.events[0] ?? {}).sort()).toEqual([
      'amount',
      'filled',
      'filledDelta',
      'kind',
      'observedAt',
      'price',
      'side',
      'symbol',
    ]);
  });

  it('caps fan-out and reports every event omitted by either upstream or payload bounds', () => {
    const input = Array.from({ length: MAX_FILL_EVENTS_PER_DELIVERY + 7 }, (_, index) =>
      event(index % 2 === 0 ? 'fill' : 'filled', {
        id: index,
        orderId: `order-${index}`,
        at: 1_000 + index,
      }),
    );

    const payload = buildFillWebhookPayload(input, 4);

    expect(payload?.events).toHaveLength(MAX_FILL_EVENTS_PER_DELIVERY);
    expect(payload?.omitted).toBe(11);
    expect(payload?.observedAt).toBe(1_000 + MAX_FILL_EVENTS_PER_DELIVERY - 1);
    expect(payload?.text).toContain('11 additional fill events');
    expect(buildFillWebhookPayload(input, Number.POSITIVE_INFINITY)?.omitted).toBe(7);
  });
});

describe('digest webhook payload', () => {
  it('keeps explicit unavailable states without converting missing evidence to zero', () => {
    const evidence: DigestRecapEvidence = {
      recap: { equity: null, fills: null, movers: null },
      state: { equity: 'unavailable', fills: 'unavailable', movers: 'unavailable' },
    };

    const payload = buildDigestWebhookPayload(
      { start: 0, end: 86_400_000, intervalMs: 86_400_000, hours: 24 },
      evidence,
      'digest-v1-safe-id',
    );

    expect(payload).toMatchObject({
      version: 1,
      type: 'midas.account.digest',
      deliveryId: 'digest-v1-safe-id',
      recap: {
        equity: { state: 'unavailable' },
        fills: { state: 'unavailable' },
        movers: { state: 'unavailable', items: [] },
      },
    });
    expect(payload.text).toContain('Equity: unavailable');
    expect(payload.text).toContain('Fills: unavailable');
    expect(payload.text).toContain('Movers: unavailable');
    expect(JSON.stringify(payload)).not.toMatch(/startUsd":0|count":0/);
  });

  it('bounds fee currencies, movers, and compatibility text', () => {
    const feesByCurrency = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`CCY-${String(index).padStart(2, '0')}`, index + 1]),
    );
    const evidence: DigestRecapEvidence = {
      recap: {
        equity: {
          startUsd: 10_000,
          endUsd: 10_250,
          startAt: 0,
          endAt: 1,
          includesLiveUnrealizedPnl: true,
        },
        fills: {
          count: 2,
          buyNotionalUsd: 100,
          sellNotionalUsd: 110,
          feesByCurrency,
          roundTripPnlUsd: 10,
          untimed: 0,
        },
        movers: Array.from({ length: 7 }, (_, index) => ({
          symbol: `ASSET-${index}/${'Q'.repeat(500)}`,
          changePercent: index + 1,
        })),
      },
      state: { equity: 'available', fills: 'available', movers: 'available' },
    };

    const payload = buildDigestWebhookPayload(
      { start: 0, end: 3_600_000, intervalMs: 3_600_000, hours: 1 },
      evidence,
      'digest-v1-bounded',
    );

    expect(Object.keys('feesByCurrency' in payload.recap.fills ? payload.recap.fills.feesByCurrency : {})).toHaveLength(8);
    expect(payload.recap.movers.items).toHaveLength(3);
    expect(payload.recap.fills.state).toBe('partial');
    expect(payload.text).toContain('fill totals are partial');
    expect(payload.text).toContain('position or quote coverage was incomplete');
    expect(payload.recap.movers.items.every((mover) => mover.symbol.length <= 64)).toBe(true);
    expect(
      Object.keys('feesByCurrency' in payload.recap.fills ? payload.recap.fills.feesByCurrency : {})
        .every((currency) => currency.length <= 24),
    ).toBe(true);
    expect(payload.content).toBe(payload.text);
    expect(payload.text.length).toBeLessThanOrEqual(1_900);
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(8 * 1024);
  });

  it('renders incomplete empty evidence as partial rather than none or zero', () => {
    const payload = buildDigestWebhookPayload(
      { start: 0, end: 3_600_000, intervalMs: 3_600_000, hours: 1 },
      {
        recap: {
          equity: {
            startUsd: 100,
            endUsd: 105,
            startAt: 1_000,
            endAt: 2_000,
            includesLiveUnrealizedPnl: true,
          },
          fills: null,
          movers: null,
        },
        state: { equity: 'partial', fills: 'partial', movers: 'partial' },
      },
      'digest-v1-partial',
    );

    expect(payload.text).toContain('Fills: partial');
    expect(payload.text).toContain('Movers: partial');
    expect(payload.text).toContain('equity change has partial');
    expect(payload.text).not.toMatch(/none observed|no open positions/i);
    expect(JSON.stringify(payload)).not.toMatch(/"count":0|"items":\[[^\]]/);
  });
});
