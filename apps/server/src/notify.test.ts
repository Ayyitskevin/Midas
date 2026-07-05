import { describe, it, expect } from 'vitest';
import type { AlertTrigger } from '@midas/shared';
import {
  formatTrigger,
  buildWebhookPayload,
  WebhookNotifier,
  createNotifier,
} from './alerts/notify';

const trg = (over: Partial<AlertTrigger> = {}): AlertTrigger => ({
  id: '1',
  alertId: 'a',
  symbol: 'BTC/USDT',
  metric: 'price',
  op: 'above',
  value: 70000,
  actual: 70500,
  at: 0,
  ...over,
});

describe('formatTrigger', () => {
  it('renders a price alert', () => {
    expect(formatTrigger(trg()).title).toBe('BTC/USDT price ≥ 70000');
  });

  it('appends % for funding / change', () => {
    expect(formatTrigger(trg({ metric: 'funding', op: 'below', value: 0, actual: -0.0123 })).title).toBe(
      'BTC/USDT funding ≤ 0%',
    );
    expect(formatTrigger(trg({ metric: 'change', op: 'cross', value: -5, actual: -5.2 })).text).toContain('%');
  });

  it('scales price precision to magnitude so a sub-cent token never reads 0.00', () => {
    // Shares priceDecimals with the browser formatter — the webhook (Discord/Slack)
    // and the in-app toast must agree, and both must show real digits for memecoins.
    const bonk = formatTrigger(trg({ symbol: 'BONK/USDC', value: 0.000025, actual: 0.000031 }));
    expect(bonk.title).toBe('BONK/USDC price ≥ 0.00002500');
    expect(bonk.text).toContain('now 0.00003100');
    // Sub-dollar (not sub-cent) prices get 6 places, not 2.
    expect(formatTrigger(trg({ symbol: 'JUP/USDC', value: 0.9, actual: 0.94 })).title).toBe(
      'JUP/USDC price ≥ 0.900000',
    );
  });
});

describe('buildWebhookPayload', () => {
  it('carries content (Discord), text (Slack) and raw triggers', () => {
    const p = buildWebhookPayload([trg()]);
    expect(p.content).toContain('BTC/USDT');
    expect(p.text).toBe(p.content);
    expect(p.triggers).toHaveLength(1);
  });

  it('joins multiple fires into lines', () => {
    const p = buildWebhookPayload([trg(), trg({ symbol: 'ETH/USDT' })]);
    expect(p.content.split('\n')).toHaveLength(2);
  });
});

describe('WebhookNotifier', () => {
  it('POSTs JSON to the configured url', async () => {
    const calls: Array<{ url: string; body: WebhookBody }> = [];
    const stub = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return { ok: true } as Response;
    }) as typeof fetch;

    await new WebhookNotifier('http://hook', stub).deliver([trg()]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://hook');
    expect(calls[0].body.triggers).toHaveLength(1);
  });

  it('does nothing for an empty list', async () => {
    let called = 0;
    const stub = (async () => {
      called += 1;
      return {} as Response;
    }) as typeof fetch;
    await new WebhookNotifier('http://hook', stub).deliver([]);
    expect(called).toBe(0);
  });

  it('swallows fetch failures via onError', async () => {
    let captured: unknown;
    const stub = (async () => {
      throw new Error('down');
    }) as typeof fetch;
    await new WebhookNotifier('http://hook', stub, (e) => {
      captured = e;
    }).deliver([trg()]);
    expect((captured as Error).message).toBe('down');
  });
});

describe('createNotifier', () => {
  it('returns a no-op notifier when no url is configured', async () => {
    await expect(createNotifier({}).deliver([trg()])).resolves.toBeUndefined();
  });
});

interface WebhookBody {
  triggers: AlertTrigger[];
}
