import { useEffect, useRef, useState } from 'react';

type Handler = (data: unknown) => void;
export type StreamStatus = 'connecting' | 'open' | 'closed';

const SEP = '|';

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/api/stream`;
}

/**
 * Singleton WebSocket client. Multiplexes all module subscriptions over one
 * connection, ref-counts (channel, symbol) subscriptions, resubscribes on
 * reconnect, and reconnects with a fixed backoff while anything is subscribed.
 */
class StreamClient {
  private ws: WebSocket | null = null;
  private subs = new Map<string, Set<Handler>>();
  private status: StreamStatus = 'closed';
  private statusHandlers = new Set<(s: StreamStatus) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

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
        if (set) for (const h of set) h(m.data);
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
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

  private scheduleReconnect() {
    if (this.subs.size === 0 || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.ensure();
    }, 1500);
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
