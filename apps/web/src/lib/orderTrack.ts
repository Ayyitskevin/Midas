import type { PlacedOrder } from '@midas/shared';

/**
 * Post-placement order tracking for TICKET — pure helpers that turn an order
 * lookup into a display state, so the progression (open → partially filled →
 * filled/canceled) and when to stop polling are unit-testable.
 */

const TERMINAL = new Set(['closed', 'filled', 'canceled', 'cancelled', 'rejected', 'expired']);

/** True when the order can no longer change — the tracker stops polling. */
export function isTerminalOrderStatus(status: string | null | undefined): boolean {
  return TERMINAL.has((status ?? '').trim().toLowerCase());
}

export interface OrderTrackView {
  /** Human state line, e.g. 'partially filled 0.4/1'. */
  label: string;
  /** 'up' = fully executed, 'down' = canceled/rejected/expired, 'info' = still working. */
  tone: 'up' | 'down' | 'info';
  /** Fill progress 0..1; null when the order size is unknown. */
  progress: number | null;
  /** Terminal — stop tracking. */
  done: boolean;
}

const fmt = (n: number): string => String(Number(n.toFixed(8)));

/** Describe an order's tracked state. ccxt reports a fully executed order as 'closed'. */
export function describeOrderTrack(o: PlacedOrder): OrderTrackView {
  const s = (o.status || '').trim().toLowerCase();
  const progress = o.amount > 0 ? Math.min(1, o.filled / o.amount) : null;
  const done = isTerminalOrderStatus(s);
  const ratio = `${fmt(o.filled)}/${fmt(o.amount)}`;
  if (done) {
    if (s === 'closed' || s === 'filled') {
      return { label: `filled ${ratio}`, tone: 'up', progress, done };
    }
    // canceled / cancelled / rejected / expired — say so, keeping any partial fill visible.
    return {
      label: o.filled > 0 ? `${s} — ${ratio} filled` : s,
      tone: 'down',
      progress,
      done,
    };
  }
  if (o.filled > 0) return { label: `partially filled ${ratio}`, tone: 'info', progress, done };
  return { label: 'open — waiting for fills', tone: 'info', progress, done };
}
