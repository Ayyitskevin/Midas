/**
 * Alerts — the data contract and the pure crossing evaluator, shared by the
 * web client (which renders + notifies) and the server (which evaluates in the
 * background). Deliberately free of DOM / Node / formatting deps so a single
 * implementation drives both sides with no drift.
 */

export type AlertMetric = 'price' | 'funding' | 'change' | 'upnl' | 'equity';
export type AlertOp = 'above' | 'below' | 'cross';
export type AlertStatus = 'armed' | 'triggered';

/**
 * The pseudo-symbol account-wide alerts key on (metric 'equity'): total
 * account value has no pair, so rules and readings meet under this constant.
 */
export const ACCOUNT_SYMBOL = 'ACCOUNT';

export interface Alert {
  id: string;
  /** Owning user id (server-side, multi-user); absent for single-user / local alerts. */
  userId?: string;
  /** Uppercase pair, e.g. BTC/USDT. */
  symbol: string;
  metric: AlertMetric;
  op: AlertOp;
  /** Threshold in the metric's units — quote currency for price, percent otherwise. */
  value: number;
  note?: string;
  /** Disabled alerts are skipped by the engine but kept in the list. */
  enabled: boolean;
  /** Re-arm automatically once the condition clears (otherwise one-shot). */
  repeat: boolean;
  status: AlertStatus;
  /** Most recent observed value. */
  lastValue: number | null;
  createdAt: number;
  triggeredAt: number | null;
}

/** A record of one moment an alert's condition was crossed. */
export interface AlertTrigger {
  id: string;
  alertId: string;
  /** Owning user id, copied from the alert (for per-user trigger logs). */
  userId?: string;
  symbol: string;
  metric: AlertMetric;
  op: AlertOp;
  value: number;
  actual: number;
  at: number;
}

/** The fields needed to create an alert (everything else is derived). */
export interface AlertInput {
  symbol: string;
  metric: AlertMetric;
  op: AlertOp;
  value: number;
  note?: string;
  repeat: boolean;
}

/** Per-symbol values gathered by an engine each tick. */
export interface Reading {
  price?: number;
  /** Funding rate already scaled to percent (rate * 100). */
  funding?: number;
  /** 24h price change, in percent. */
  change?: number;
  /** Unrealized P&L of the account's position on this symbol, in USD. */
  upnl?: number;
  /** Total account value in USD (read under {@link ACCOUNT_SYMBOL}). */
  equity?: number;
}
export type Readings = Record<string, Reading>;

export const ALERT_METRICS: readonly AlertMetric[] = ['price', 'funding', 'change', 'upnl', 'equity'];
export const ALERT_OPS: readonly AlertOp[] = ['above', 'below', 'cross'];

// ---------------------------------------------------------------------------
// Construction / validation
// ---------------------------------------------------------------------------

/** Upper bounds enforced at the edge — an unbounded symbol/note is a persisted-store DoS vector. */
export const MAX_ALERT_SYMBOL_LEN = 32;
export const MAX_ALERT_NOTE_LEN = 280;

/** Coerce an untrusted body into a valid AlertInput, or null if unusable. */
export function parseAlertInput(raw: unknown): AlertInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const symbol = typeof r.symbol === 'string' ? r.symbol.trim().toUpperCase() : '';
  const metric = r.metric as AlertMetric;
  const op = r.op as AlertOp;
  const value = typeof r.value === 'number' ? r.value : Number(r.value);
  if (!symbol || symbol.length > MAX_ALERT_SYMBOL_LEN) return null;
  if (!ALERT_METRICS.includes(metric)) return null;
  if (!ALERT_OPS.includes(op)) return null;
  if (!Number.isFinite(value)) return null;
  // A note is optional, but an over-long one is rejected outright rather than
  // silently truncated — it never reaches the persisted store.
  if (typeof r.note === 'string' && r.note.trim().length > MAX_ALERT_NOTE_LEN) return null;
  return {
    symbol,
    metric,
    op,
    value,
    note: typeof r.note === 'string' && r.note.trim() ? r.note.trim() : undefined,
    repeat: Boolean(r.repeat),
  };
}

/** Build a fresh, armed Alert from validated input. */
export function newAlert(input: AlertInput, id: string, now: number): Alert {
  return {
    id,
    symbol: input.symbol,
    metric: input.metric,
    op: input.op,
    value: input.value,
    note: input.note,
    enabled: true,
    repeat: input.repeat,
    status: 'armed',
    lastValue: null,
    createdAt: now,
    triggeredAt: null,
  };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function readingFor(alert: Alert, readings: Readings): number | undefined {
  const r = readings[alert.symbol];
  if (!r) return undefined;
  switch (alert.metric) {
    case 'price':
      return r.price;
    case 'funding':
      return r.funding;
    case 'change':
      return r.change;
    case 'upnl':
      return r.upnl;
    case 'equity':
      return r.equity;
  }
}

export function conditionMet(actual: number, op: AlertOp, value: number): boolean {
  if (op === 'above') return actual >= value;
  if (op === 'below') return actual <= value;
  return false; // 'cross' is judged against the previous reading, not a single value
}

/**
 * Direction to arm when a user clicks a level on the chart: `above` if the
 * level sits at/above the current price, otherwise `below`.
 */
export function alertOpForLevel(level: number, reference: number): AlertOp {
  return level >= reference ? 'above' : 'below';
}

export function opSymbol(op: AlertOp): string {
  return op === 'above' ? '≥' : op === 'below' ? '≤' : '⇄';
}

/**
 * Given a newest-first trigger log and the id last surfaced to the user, return
 * the triggers that are newer than it. Returns nothing on the first look (null
 * seen) or if the seen id has fallen off the log — so reopening a tab doesn't
 * replay a backlog of fires.
 */
export function newTriggersSince(log: AlertTrigger[], seenId: string | null): AlertTrigger[] {
  if (!seenId) return [];
  const idx = log.findIndex((t) => t.id === seenId);
  return idx === -1 ? [] : log.slice(0, idx);
}

/**
 * Fold fresh readings into the alert set, firing on the *edge* where an armed
 * alert's condition first becomes true. Returns the next alert array and the
 * triggers that fired this pass. Repeatable alerts re-arm once their condition
 * clears; one-shot alerts stay `triggered` until re-armed.
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
    userId: a.userId,
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
