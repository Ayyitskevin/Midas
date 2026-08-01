import { useEffect, useRef, useState } from 'react';

type Handler = (data: unknown) => void;
export type StreamStatus = 'connecting' | 'open' | 'closed';

const SEP = '|';

/**
 * Reconnect backoff: 1s doubling to a 30s cap with 50–100% jitter. A fixed
 * interval reconnects every dead tab in lockstep — a thundering herd against
 * the server right as it comes back.
 */
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/api/stream`;
}

/**
 * Singleton WebSocket client. Multiplexes all module subscriptions over one
 * connection, ref-counts (channel, symbol) subscriptions, resubscribes on
 * reconnect, and reconnects with exponential backoff (jittered, capped) while
 * anything is subscribed. The socket is closed when the last subscription is
 * removed — an idle open socket is not "live" — and reopened on the next
 * subscribe.
 */
export class StreamClient {
  private ws: WebSocket | null = null;
  private subs = new Map<string, Set<Handler>>();
  private status: StreamStatus = 'closed';
  private statusHandlers = new Set<(s: StreamStatus) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempts = 0;
  private resumeOnVisible = false;
  private visibilityHooked = false;

  getStatus(): StreamStatus {
    return this.status;
  }

  /** Number of distinct (channel, symbol) subscriptions currently held. */
  subscriberCount(): number {
    return this.subs.size;
  }

  onStatus(cb: (s: StreamStatus) => void): () => void {
    this.statusHandlers.add(cb);
    return () => {
      this.statusHandlers.delete(cb);
    };
  }

  subscribe(channel: string, symbolRaw: string, handler: Handler): () => void {
    // Static demo: there is no server to stream from — stay 'closed' so every
    // panel uses its REST-polling baseline instead of a reconnect loop.
    if ((window as unknown as { __MIDAS_STATIC_DEMO__?: boolean }).__MIDAS_STATIC_DEMO__) {
      return () => {};
    }
    const symbol = symbolRaw.toUpperCase();
    const key = `${channel}${SEP}${symbol}`;
    let set = this.subs.get(key);
    if (!set) {
      set = new Set();
      this.subs.set(key, set);
    }
    set.add(handler);
    this.ensure();
    this.send('subscribe', channel, symbol);

    return () => {
      const current = this.subs.get(key);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.subs.delete(key);
        this.send('unsubscribe', channel, symbol);
        // Last subscription gone: close the socket instead of holding an idle
        // connection (and a misleading LIVE badge). The next subscribe reopens.
        if (this.subs.size === 0) this.closeSocket();
      }
    };
  }

  private setStatus(s: StreamStatus) {
    this.status = s;
    for (const cb of this.statusHandlers) cb(s);
  }

  private ensure() {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0; // healthy connection — reset the backoff
      this.setStatus('open');
      for (const key of this.subs.keys()) {
        const i = key.indexOf(SEP);
        this.rawSend('subscribe', key.slice(0, i), key.slice(i + 1));
      }
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data as string) as { type?: string; symbol?: string; data?: unknown };
        if (!m.type || !m.symbol) return;
        const set = this.subs.get(`${m.type}${SEP}${m.symbol}`);
        if (set) {
          for (const h of set) {
            // One throwing handler must not starve its siblings on the same
            // channel — isolate each invocation and log the failure.
            try {
              h(m.data);
            } catch (err) {
              console.error('[midas] stream handler threw', err);
            }
          }
        }
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      // A stale socket's late close (e.g. the async close of a socket
      // closeSocket() already replaced) must not sever or mislabel the
      // CURRENT connection.
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus('closed');
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
  }

  /** Close the current socket and cancel any pending reconnect (idle teardown). */
  private closeSocket() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.reconnectAttempts = 0;
    this.resumeOnVisible = false;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close(); // its onclose fires; scheduleReconnect no-ops with zero subs
      } catch {
        // ignore
      }
    }
    if (this.status !== 'closed') this.setStatus('closed');
  }

  /**
   * Defer reconnects while the tab is hidden — nobody is watching the panels,
   * so don't pile attempts (and server load) onto an invisible screen. Resumes
   * on the next visibilitychange. Guarded: no `document` outside the DOM
   * (tests, SSR) never pauses.
   */
  private hookVisibility() {
    if (this.visibilityHooked || typeof document === 'undefined') return;
    this.visibilityHooked = true;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.resumeOnVisible) {
        this.resumeOnVisible = false;
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect() {
    if (this.subs.size === 0 || this.reconnectTimer) return;
    if (typeof document !== 'undefined' && document.hidden) {
      this.hookVisibility();
      this.resumeOnVisible = true;
      return;
    }
    const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    const delay = base * (0.5 + Math.random() * 0.5);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.ensure();
    }, delay);
  }

  private send(type: string, channel: string, symbol: string) {
    if (this.ws?.readyState === WebSocket.OPEN) this.rawSend(type, channel, symbol);
  }

  private rawSend(type: string, channel: string, symbol: string) {
    this.ws?.send(JSON.stringify({ type, channel, symbol }));
  }
}

export const stream = new StreamClient();

/** Subscribe to a stream channel for a symbol while the component is mounted. */
export function useStream(
  channel: string,
  symbol: string | null | undefined,
  handler: Handler,
): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!symbol) return;
    return stream.subscribe(channel, symbol, (data) => ref.current(data));
  }, [channel, symbol]);
}

export function useStreamStatus(): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>(stream.getStatus());
  useEffect(() => stream.onStatus(setStatus), []);
  return status;
}
