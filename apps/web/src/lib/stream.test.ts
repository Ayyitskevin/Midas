import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamClient } from '@/lib/stream';

/**
 * Minimal WebSocket stand-in. The client under test reads the global
 * `WebSocket` (constructor + OPEN/CONNECTING constants) and `location`; both
 * are installed per test so no real network is ever touched.
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(msg: string) {
    this.sent.push(msg);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }

  // Test-side drivers (what the server/network would do).
  serverOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  serverPush(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  serverDrop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const g = globalThis as Record<string, unknown>;

beforeEach(() => {
  FakeWebSocket.instances = [];
  g.WebSocket = FakeWebSocket;
  g.location = { protocol: 'http:', host: 'midas.test' };
});

afterEach(() => {
  delete g.WebSocket;
  delete g.location;
  delete g.document;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const lastSocket = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

describe('StreamClient housekeeping', () => {
  it('closes the socket when the last subscription is removed, and reconnects on the next subscribe', () => {
    const client = new StreamClient();
    const off = client.subscribe('trades', 'BTC/USDT', () => {});
    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = lastSocket();
    ws.serverOpen();
    expect(client.getStatus()).toBe('open');

    off(); // last subscription gone
    expect(ws.closed).toBe(true); // an idle open socket is not held (nor shown LIVE)
    expect(client.getStatus()).toBe('closed');
    expect(client.subscriberCount()).toBe(0);

    client.subscribe('trades', 'ETH/USDT', () => {}); // a fresh subscribe reopens
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(client.getStatus()).toBe('connecting');
  });

  it('keeps the shared socket while other subscriptions remain', () => {
    const client = new StreamClient();
    const offA = client.subscribe('trades', 'BTC/USDT', () => {});
    client.subscribe('trades', 'ETH/USDT', () => {});
    const ws = lastSocket();
    offA();
    expect(ws.closed).toBe(false); // one subscription left — socket stays
    expect(client.subscriberCount()).toBe(1);
  });
});

describe('StreamClient handler isolation', () => {
  it('a throwing handler does not starve its siblings on the same channel', () => {
    const client = new StreamClient();
    const received: unknown[] = [];
    client.subscribe('trades', 'BTC/USDT', () => {
      throw new Error('boom');
    });
    client.subscribe('trades', 'BTC/USDT', (d) => received.push(d));
    lastSocket().serverOpen();

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lastSocket().serverPush({ type: 'trades', symbol: 'BTC/USDT', data: { price: 1 } });

    expect(received).toEqual([{ price: 1 }]); // the second handler still ran
    expect(errSpy).toHaveBeenCalled(); // and the throw was logged, not swallowed
  });
});

describe('StreamClient reconnect backoff', () => {
  it('doubles the delay per failed attempt (jitter pinned to 0.75×)', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // delay = base × 0.75
    const client = new StreamClient();
    client.subscribe('trades', 'BTC/USDT', () => {});

    // Attempt 0 → 1000ms × 0.75 = 750ms.
    lastSocket().serverDrop();
    await vi.advanceTimersByTimeAsync(700);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // Attempt 1 → 2000ms × 0.75 = 1500ms (grew, not a fixed interval).
    lastSocket().serverDrop();
    await vi.advanceTimersByTimeAsync(1400);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('caps the delay at 30s no matter how many attempts have failed', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // capped delay = 30000 × 0.75 = 22500
    const client = new StreamClient();
    client.subscribe('trades', 'BTC/USDT', () => {});

    // 12 failed attempts: uncapped backoff would be 1000×2^11×0.75 ≈ 1.5M ms,
    // so a 22500ms advance only reconnects if the 30s cap holds.
    for (let i = 0; i < 12; i++) {
      const before = FakeWebSocket.instances.length;
      lastSocket().serverDrop();
      await vi.advanceTimersByTimeAsync(22_500);
      expect(FakeWebSocket.instances.length).toBe(before + 1);
    }
  });

  it('pauses reconnect while the document is hidden and resumes on visibilitychange', async () => {
    vi.useFakeTimers();
    const listeners: Record<string, () => void> = {};
    const doc = {
      hidden: true,
      addEventListener: (ev: string, cb: () => void) => {
        listeners[ev] = cb;
      },
    };
    g.document = doc;

    const client = new StreamClient();
    client.subscribe('trades', 'BTC/USDT', () => {});
    lastSocket().serverDrop();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeWebSocket.instances).toHaveLength(1); // hidden tab: no reconnect storm

    doc.hidden = false;
    listeners.visibilitychange?.();
    await vi.advanceTimersByTimeAsync(1000); // delay is ≤1000ms on the first attempt
    expect(FakeWebSocket.instances).toHaveLength(2); // visible again: reconnects
  });
});
