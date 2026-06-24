/**
 * Alerts — types, the pure crossing evaluator, and the browser-side
 * notification helpers (toast text, Web Notification, audio beep).
 *
 * The evaluator is deliberately pure (no store / DOM access) so it can be
 * unit-reasoned and reused; the store calls it on every poll tick.
 */

import { fmtPrice } from './format';

export type AlertMetric = 'price' | 'funding' | 'change';
export type AlertOp = 'above' | 'below' | 'cross';
export type AlertStatus = 'armed' | 'triggered';

export interface Alert {
  id: string;
  /** Uppercase pair, e.g. BTC/USDT. */
  symbol: string;
  metric: AlertMetric;
  op: AlertOp;
  /** Threshold in the metric's units — quote currency for price, percent for funding. */
  value: number;
  note?: string;
  /** Disabled alerts are skipped by the engine but kept in the list. */
  enabled: boolean;
  /** Re-arm automatically once the condition clears (otherwise one-shot). */
  repeat: boolean;
  status: AlertStatus;
  /** Most recent observed value, for the live "now" column. */
  lastValue: number | null;
  createdAt: number;
  triggeredAt: number | null;
}

/** A record of one moment an alert's condition was crossed. */
export interface AlertTrigger {
  id: string;
  alertId: string;
  symbol: string;
  metric: AlertMetric;
  op: AlertOp;
  value: number;
  actual: number;
  at: number;
}

/** Per-symbol values gathered by the engine each tick. */
export interface Reading {
  price?: number;
  /** Funding rate already scaled to percent (rate * 100). */
  funding?: number;
  /** 24h price change, in percent. */
  change?: number;
}
export type Readings = Record<string, Reading>;

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function readingFor(alert: Alert, readings: Readings): number | undefined {
  const r = readings[alert.symbol];
  if (!r) return undefined;
  if (alert.metric === 'price') return r.price;
  if (alert.metric === 'funding') return r.funding;
  return r.change;
}

export function conditionMet(actual: number, op: AlertOp, value: number): boolean {
  if (op === 'above') return actual >= value;
  if (op === 'below') return actual <= value;
  return false; // 'cross' is judged against the previous reading, not a single value
}

/**
 * Fold fresh readings into the alert set, firing on the *edge* where an armed
 * alert's condition first becomes true. Returns the next alert array and the
 * triggers that fired this pass. Repeatable alerts re-arm once their condition
 * clears; one-shot alerts stay `triggered` until the user re-arms them.
 */
export function evaluateAlerts(
  alerts: Alert[],
  readings: Readings,
  now: number,
): { next: Alert[]; fired: AlertTrigger[] } {
  const fired: AlertTrigger[] = [];
  let seq = 0;
  const mkTrigger = (a: Alert, actual: number): AlertTrigger => ({
    id: `trg_${now.toString(36)}_${(seq++).toString(36)}`,
    alertId: a.id,
    symbol: a.symbol,
    metric: a.metric,
    op: a.op,
    value: a.value,
    actual,
    at: now,
  });

  const next = alerts.map((a) => {
    if (!a.enabled) return a;
    const actual = readingFor(a, readings);
    if (actual == null || !Number.isFinite(actual)) return a;

    // A "cross" fires when the value moves through the threshold from either
    // side — judged against the previous reading, so it can't fire on the
    // first tick. Repeatable crosses stay armed; one-shot crosses latch.
    if (a.op === 'cross') {
      const prev = a.lastValue;
      const crossed =
        prev != null &&
        ((prev < a.value && actual >= a.value) || (prev > a.value && actual <= a.value));
      if (a.status === 'armed' && crossed) {
        fired.push(mkTrigger(a, actual));
        return {
          ...a,
          status: a.repeat ? ('armed' as const) : ('triggered' as const),
          lastValue: actual,
          triggeredAt: now,
        };
      }
      return { ...a, lastValue: actual };
    }

    const met = conditionMet(actual, a.op, a.value);

    if (a.status === 'armed') {
      if (met) {
        fired.push(mkTrigger(a, actual));
        return { ...a, status: 'triggered' as const, lastValue: actual, triggeredAt: now };
      }
      return { ...a, lastValue: actual };
    }

    // Already triggered: re-arm a repeatable alert once the condition clears.
    if (a.repeat && !met) {
      return { ...a, status: 'armed' as const, lastValue: actual };
    }
    return { ...a, lastValue: actual };
  });

  return { next, fired };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function opSymbol(op: AlertOp): string {
  return op === 'above' ? '≥' : op === 'below' ? '≤' : '⇄';
}

export function formatThreshold(metric: AlertMetric, value: number): string {
  return metric === 'price' ? fmtPrice(value) : `${value}%`;
}

export function formatActual(metric: AlertMetric, value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (metric === 'price') return fmtPrice(value);
  return `${value.toFixed(metric === 'funding' ? 4 : 2)}%`;
}

/** The condition clause, e.g. "price ≥ 70,000" or "funding ≤ 0.05%". */
export function describeThreshold(alert: Alert): string {
  return `${alert.metric} ${opSymbol(alert.op)} ${formatThreshold(alert.metric, alert.value)}`;
}

export function triggerHeadline(t: AlertTrigger): string {
  return `${t.symbol} ${t.metric} ${opSymbol(t.op)} ${formatThreshold(t.metric, t.value)}`;
}

export function triggerBody(t: AlertTrigger): string {
  return `Now ${formatActual(t.metric, t.actual)}`;
}

// ---------------------------------------------------------------------------
// Notifications (browser side effects)
// ---------------------------------------------------------------------------

export function canNotify(): boolean {
  return typeof Notification !== 'undefined';
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!canNotify()) return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export function notifyTrigger(t: AlertTrigger): void {
  if (!canNotify() || Notification.permission !== 'granted') return;
  try {
    // tag de-dupes repeated fires of the same alert into one OS notification.
    new Notification(triggerHeadline(t), { body: triggerBody(t), tag: t.alertId });
  } catch {
    /* notifications unavailable in this context */
  }
}

let audioCtx: AudioContext | null = null;

/** Short sine "ping" via WebAudio — no asset needed. */
export function playBeep(): void {
  try {
    const Ctx: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx ??= new Ctx();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
  } catch {
    /* audio unavailable */
  }
}
