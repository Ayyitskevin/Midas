import { describe, it, expect } from 'vitest';
import type { AccountOrderEvent } from '@midas/shared';
import { buildDigestText, createDigestSource, type DigestInputs } from './digest';
import type { AccountWatchHandle } from './accountWatch';

const DAY = 86_400_000;

const ev = (id: number, kind: AccountOrderEvent['kind'], symbol = 'BTC/USDT'): AccountOrderEvent => ({
  id,
  at: 0,
  kind,
  orderId: String(id),
  symbol,
  side: 'buy',
  price: 60000,
  amount: 1,
  filled: 0,
  filledDelta: null,
  status: null,
});

const base: DigestInputs = {
  sinceMs: 0,
  nowMs: 7 * DAY,
  providerName: 'ccxt:binance',
  providerLive: true,
  version: '0.3.0',
  alertsFired: 14,
  events: [],
  missedEvents: 0,
  watching: true,
};

describe('buildDigestText', () => {
  it('summarizes the period: header, alerts, order-flow counts, coverage', () => {
    const text = buildDigestText({
      ...base,
      events: [ev(1, 'new'), ev(2, 'fill'), ev(3, 'fill', 'ETH/USDT'), ev(4, 'filled'), ev(5, 'canceled')],
    });
    expect(text).toContain('📊 Midas digest — ccxt:binance (live), v0.3.0');
    expect(text).toContain('Alerts fired: 14');
    expect(text).toContain('1 new · 2 partial fills · 1 filled · 1 canceled/closed');
    expect(text).toContain('(BTC/USDT, ETH/USDT)');
    expect(text).toContain('Covers the last 7.0 days.');
  });

  it('stays honest when the watcher is off, idle, or has forgotten events', () => {
    expect(buildDigestText({ ...base, watching: false })).toContain('account watcher off');
    expect(buildDigestText(base)).toContain('no order activity observed');
    const truncated = buildDigestText({ ...base, events: [ev(9, 'fill')], missedEvents: 3 });
    expect(truncated).toContain('≥1 partial fill');
    expect(truncated).toContain('3 older events aged out');
  });

  it('labels a synthetic provider as such', () => {
    expect(buildDigestText({ ...base, providerLive: false, providerName: 'mock' })).toContain('mock (synthetic)');
  });
});

describe('createDigestSource', () => {
  // A watcher that starts empty (as at server boot, when the digest source is
  // created beside it) and accumulates events afterwards.
  const stubWatcher = (): AccountWatchHandle & { feed: (events: AccountOrderEvent[]) => void } => {
    let events: AccountOrderEvent[] = [];
    return {
      stop: () => {},
      latestId: () => events[events.length - 1]?.id ?? 0,
      eventsSince: (since) => events.filter((e) => e.id > since),
      tick: async () => {},
      feed: (next) => {
        events = next;
      },
    };
  };

  it('covers exactly the period since the previous digest and resets its cursors', () => {
    let nowMs = 0;
    const watcher = stubWatcher();
    const source = createDigestSource({
      providerName: 'ccxt:binance',
      providerLive: true,
      version: '0.3.0',
      watcher,
      now: () => nowMs,
    });
    source.addAlertFires(3);
    source.addAlertFires(2);
    watcher.feed([ev(1, 'fill'), ev(2, 'filled')]); // activity during the period
    nowMs = DAY;
    const first = source.compose();
    expect(first).toContain('Alerts fired: 5');
    expect(first).toContain('1 partial fill');
    expect(first).toContain('Covers the last 1.0 day.');

    // Second period: nothing new happened → counts reset, coverage restarts.
    nowMs = 2 * DAY;
    const second = source.compose();
    expect(second).toContain('Alerts fired: 0');
    expect(second).toContain('no order activity observed');
    expect(second).toContain('Covers the last 1.0 day.');
  });

  it('counts ring-buffer overflow as missed events, not silence', () => {
    const watcher = stubWatcher();
    const source = createDigestSource({
      providerName: 'ccxt:binance',
      providerLive: true,
      version: '0.3.0',
      watcher,
      now: () => 0,
    });
    // 10 events happened this period, but the ring buffer only retained 8-10.
    watcher.feed([ev(8, 'fill'), ev(9, 'fill'), ev(10, 'canceled')]);
    const text = source.compose();
    expect(text).toContain('≥2 partial fills');
    expect(text).toContain('7 older events aged out');
  });

  it('is honest without a watcher and never double-counts fires', () => {
    const source = createDigestSource({
      providerName: 'mock',
      providerLive: false,
      version: '0.3.0',
      watcher: null,
      now: () => 0,
    });
    source.addAlertFires(1);
    source.addAlertFires(-5); // defensive: negative adds are ignored
    expect(source.compose()).toContain('account watcher off');
    expect(source.compose()).toContain('Alerts fired: 0'); // reset after first compose
  });
});
