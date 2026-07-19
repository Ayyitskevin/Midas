import type { StreamStatus } from './stream';

export type StreamTone = 'live' | 'simulated' | 'connecting' | 'reconnecting' | 'idle';

export interface StreamStatusView {
  tone: StreamTone;
  label: string;
  /** Tailwind text-color class for the status dot. */
  dotClass: string;
  title: string;
}

/**
 * Map the raw socket status (+ how many subscriptions are active) to a
 * user-facing view. The subscription count is what separates a genuine
 * "reconnecting" (we want data but the socket dropped) from a benign "idle"
 * (nothing is streaming, so being disconnected is expected).
 *
 * `streamLive` (from /api/health) is the data-honesty guard: when the socket is
 * open but the provider streams a synthetic random-walk (any non-ccxt provider),
 * we show "SIM" instead of "LIVE" so the terminal never passes fake prints off
 * as a live feed. Defaults to `true` so a not-yet-loaded health poll doesn't
 * flash "SIM" over a genuinely live ccxt feed.
 */
export function streamStatusView(
  status: StreamStatus,
  subCount: number,
  streamLive = true,
): StreamStatusView {
  if (status === 'open') {
    if (!streamLive) {
      return {
        tone: 'simulated',
        label: 'SIM',
        dotClass: 'text-term-amber',
        title: 'Streaming synthetic data — this provider has no live feed (set MIDAS_DATA_PROVIDER=ccxt for live)',
      };
    }
    return { tone: 'live', label: 'LIVE', dotClass: 'text-term-up', title: 'Streaming live' };
  }
  if (status === 'connecting') {
    return {
      tone: 'connecting',
      label: 'CONNECTING',
      dotClass: 'text-term-amber',
      title: 'Connecting to the live feed',
    };
  }
  // status === 'closed'
  if (subCount > 0) {
    return {
      tone: 'reconnecting',
      label: 'RECONNECTING',
      dotClass: 'text-term-down',
      title: 'Connection dropped — retrying',
    };
  }
  return { tone: 'idle', label: 'IDLE', dotClass: 'text-term-dim', title: 'No live subscriptions' };
}
