import type { StreamStatus } from './stream';

export type StreamTone = 'live' | 'connecting' | 'reconnecting' | 'idle';

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
 */
export function streamStatusView(status: StreamStatus, subCount: number): StreamStatusView {
  if (status === 'open') {
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
