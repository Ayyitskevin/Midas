/**
 * Browser-side alert helpers: formatting (uses the terminal price formatter)
 * and notifications (toast text, Web Notification, audio beep).
 *
 * The data contract and the pure evaluator now live in @midas/shared (shared
 * with the server's background engine); they are re-exported here so existing
 * imports from '@/lib/alerts' keep working unchanged.
 */

import { fmtPrice } from './format';
import { opSymbol } from '@midas/shared';
import type { Alert, AlertMetric, AlertTrigger } from '@midas/shared';

export {
  alertOpForLevel,
  conditionMet,
  evaluateAlerts,
  newAlert,
  opSymbol,
  parseAlertInput,
} from '@midas/shared';
export type {
  Alert,
  AlertInput,
  AlertMetric,
  AlertOp,
  AlertStatus,
  AlertTrigger,
  Reading,
  Readings,
} from '@midas/shared';

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

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
