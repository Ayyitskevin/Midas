import type {
  AccountEventsResponse,
  AccountOrderEvent,
  AccountOrderEventKind,
  OpenOrder,
  PlacedOrder,
} from '@midas/shared';
import type { FastifyInstance } from 'fastify';
import type { DataProvider } from './providers';

/**
 * Account order watcher — the read-only observation loop behind fill
 * notifications. Every tick it snapshots open orders (the one account-wide
 * read that works across venues; my-trades is per-symbol on e.g. Binance),
 * diffs against the previous snapshot, and turns the changes into a numbered
 * event feed the UI polls plus operator webhook pushes for executions.
 *
 * Observation only: this file never places, cancels or modifies anything —
 * its only provider calls are getOpenOrders() and the optional getOrder()
 * lookup used to resolve how an order left the book.
 */

/** One raw order transition between two snapshots ('closed' = left the book, cause unknown yet). */
export interface OrderDelta {
  kind: 'new' | 'fill' | 'closed';
  order: OpenOrder;
  /** Base amount newly filled since the previous snapshot (fill only). */
  filledDelta?: number;
}

/** Tolerance for float noise in cumulative-filled comparisons. */
const FILL_EPSILON = 1e-12;

/** Diff two open-order snapshots into transitions, by order id. Pure. */
export function diffOpenOrders(prev: OpenOrder[], next: OpenOrder[]): OrderDelta[] {
  const before = new Map(prev.map((o) => [o.id, o]));
  const after = new Set(next.map((o) => o.id));
  const deltas: OrderDelta[] = [];
  for (const o of next) {
    const was = before.get(o.id);
    if (!was) {
      deltas.push({ kind: 'new', order: o });
    } else if (o.filled > was.filled + FILL_EPSILON) {
      deltas.push({ kind: 'fill', order: o, filledDelta: o.filled - was.filled });
    }
  }
  for (const o of prev) {
    if (!after.has(o.id)) deltas.push({ kind: 'closed', order: o });
  }
  return deltas;
}

const CANCELED_STATUSES = new Set(['canceled', 'cancelled', 'expired', 'rejected']);

/**
 * Resolve how an order that left the book actually ended. ccxt reports a fully
 * executed order as 'closed'; when there is no status to go on, a cumulative
 * fill ≈ the ordered amount is treated as filled, and anything else stays the
 * honest 'closed' (unknown) rather than guessing. Pure.
 */
export function resolveClosedKind(
  status: string | null,
  filled: number | null,
  amount: number,
): AccountOrderEventKind {
  const s = (status ?? '').toLowerCase();
  if (CANCELED_STATUSES.has(s)) return 'canceled';
  if (s === 'closed' || s === 'filled') return 'filled';
  if (filled != null && amount > 0 && filled >= amount * 0.999) return 'filled';
  return 'closed';
}

const fmtAmt = (n: number): string => String(Number(n.toFixed(8)));
const fmtPx = (price: number | null): string => (price != null ? ` @ ${price}` : '');

/** One human-readable line per event (webhook + logs). Pure. */
export function formatAccountEvent(e: AccountOrderEvent): string {
  const side = e.side.toUpperCase();
  switch (e.kind) {
    case 'fill':
      return (
        `⚡ Fill — ${side} ${fmtAmt(e.filledDelta ?? 0)} ${e.symbol}${fmtPx(e.price)} ` +
        `(${fmtAmt(e.filled)}/${fmtAmt(e.amount)} filled, order ${e.orderId})`
      );
    case 'filled':
      return `✅ Order filled — ${side} ${fmtAmt(e.amount)} ${e.symbol}${fmtPx(e.price)} (order ${e.orderId})`;
    case 'canceled':
      return `✖ Order canceled — ${side} ${fmtAmt(e.amount)} ${e.symbol}${fmtPx(e.price)} (order ${e.orderId})`;
    case 'new':
      return `📥 New order on book — ${side} ${fmtAmt(e.amount)} ${e.symbol}${fmtPx(e.price)} (order ${e.orderId})`;
    case 'closed':
      return `☑ Order left the book — ${side} ${fmtAmt(e.amount)} ${e.symbol} (order ${e.orderId}, final status unknown)`;
  }
}

export interface AccountWatchDeps {
  provider: DataProvider;
  /**
   * Out-of-band push for executions (operator webhook). Only 'fill'/'filled'
   * events are pushed: placements and Midas-side cancels are already webhooked
   * by the write path, so pushing them here would double-notify.
   */
  notify?: (text: string) => void;
  onError?: (err: unknown) => void;
  /** Injected clock (tests). */
  now?: () => number;
  /** Ring-buffer bound (tests). */
  maxEvents?: number;
}

export interface AccountWatchHandle {
  stop(): void;
  latestId(): number;
  /** Events with id > sinceId, oldest first. */
  eventsSince(sinceId: number): AccountOrderEvent[];
  /** One poll pass — the timer calls this; exposed so tests can drive it. */
  tick(): Promise<void>;
}

/**
 * Create the watcher without a timer (tests drive tick() directly;
 * {@link startAccountWatch} adds the interval for production).
 */
export function createAccountWatcher(deps: AccountWatchDeps): AccountWatchHandle {
  const { provider, notify, onError } = deps;
  const now = deps.now ?? Date.now;
  const maxEvents = deps.maxEvents ?? 200;

  // null until the first LIVE snapshot: the baseline pass records what is
  // already on the book without emitting events, so a restart never replays
  // pre-existing orders as "new".
  let prev: OpenOrder[] | null = null;
  let running = false;
  const events: AccountOrderEvent[] = [];
  let nextId = 1;

  const record = (event: AccountOrderEvent): void => {
    events.push(event);
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
    if ((event.kind === 'fill' || event.kind === 'filled') && notify) {
      notify(formatAccountEvent(event));
    }
  };

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const snap = await provider.getOpenOrders();
      // A non-live snapshot (keys missing, exchange error) says nothing about
      // the account — skipping it (and keeping prev) is what prevents an
      // outage from being misread as "every order left the book".
      if (snap.provenance !== 'live') return;
      if (prev === null) {
        prev = snap.orders;
        return;
      }
      const deltas = diffOpenOrders(prev, snap.orders);
      prev = snap.orders;
      const at = now();
      for (const d of deltas) {
        let kind: AccountOrderEventKind = d.kind;
        let status: string | null = d.order.status || null;
        let filled = d.order.filled;
        let filledDelta = d.kind === 'fill' ? (d.filledDelta ?? null) : null;
        if (d.kind === 'closed') {
          // The order vanished from the book — ask the exchange how it ended
          // when the provider can; otherwise stay honestly 'closed' (unknown).
          let final: PlacedOrder | null = null;
          if (provider.getOrder) {
            try {
              final = await provider.getOrder(d.order.id, d.order.symbol);
            } catch {
              final = null;
            }
          }
          status = final?.status ?? null;
          filled = final?.filled ?? d.order.filled;
          kind = resolveClosedKind(status, filled, final?.amount ?? d.order.amount);
          if (kind === 'filled' && filled - d.order.filled > FILL_EPSILON) {
            filledDelta = filled - d.order.filled;
          }
        }
        record({
          id: nextId++,
          at,
          kind,
          orderId: d.order.id,
          symbol: d.order.symbol,
          side: d.order.side,
          price: d.order.price,
          amount: d.order.amount,
          filled,
          filledDelta,
          status,
        });
      }
    } catch (err) {
      onError?.(err);
    } finally {
      running = false;
    }
  };

  return {
    stop: () => {},
    latestId: () => nextId - 1,
    eventsSince: (sinceId) => events.filter((e) => e.id > sinceId),
    tick,
  };
}

/**
 * Coalesce a burst of stream events into one delayed call — a venue can emit
 * several order updates in the same instant, and one poll covers them all.
 */
export function createNudgeDebouncer(fn: () => void, delayMs = 500): () => void {
  let pending: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      fn();
    }, delayMs);
    (pending as { unref?: () => void }).unref?.();
  };
}

/** Production entry: the watcher on a periodic timer (same shape as the alert loop). */
export function startAccountWatch(deps: AccountWatchDeps & { intervalMs: number }): AccountWatchHandle {
  const watcher = createAccountWatcher(deps);
  const timer = setInterval(() => void watcher.tick(), deps.intervalMs);
  timer.unref?.();
  return { ...watcher, stop: () => clearInterval(timer) };
}

/**
 * Resolves whose event feed a request sees. `keyed` is true when the user has
 * stored their own exchange keys — a keyed user only ever sees THEIR feed (or
 * an honest "not running"), never the operator's.
 */
export type UserFeedResolver = (userId: string) => {
  keyed: boolean;
  watch: AccountWatchHandle | null;
};

/**
 * GET /api/account/events?since= — the feed the web client polls for toasts.
 * Registered even when the watcher is off so the response can say so honestly.
 * Auth-guarded like every other /api route when auth is enabled. Users with
 * stored keys resolve to their own per-user watcher; everyone else sees the
 * operator's (self-host behavior unchanged).
 */
export function registerAccountEventsRoute(
  app: FastifyInstance,
  watch: AccountWatchHandle | null,
  userFeed?: UserFeedResolver,
): void {
  app.get<{ Querystring: { since?: string } }>(
    '/api/account/events',
    async (req): Promise<AccountEventsResponse> => {
      const sinceRaw = Number(req.query.since);
      const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? Math.floor(sinceRaw) : 0;

      const uf = req.userId && userFeed ? userFeed(req.userId) : null;
      if (uf?.keyed) {
        // Isolation: a keyed user's feed is their watcher or honestly off —
        // the operator's feed is never shown to them.
        if (!uf.watch) {
          return {
            watching: false,
            latestId: 0,
            events: [],
            note:
              'Per-user account watcher is not running for your keys — it needs MIDAS_ACCOUNT_WATCH_MS > 0 ' +
              'and a free slot under MIDAS_MAX_KEYED_USERS (ask the operator).',
          };
        }
        return { watching: true, latestId: uf.watch.latestId(), events: uf.watch.eventsSince(since), note: null };
      }

      if (!watch) {
        return {
          watching: false,
          latestId: 0,
          events: [],
          note:
            'Account watcher is off — it runs when MIDAS_ACCOUNT_WATCH_MS > 0 (default 10000), ' +
            'the ccxt provider is active, and exchange API keys are configured.',
        };
      }
      return { watching: true, latestId: watch.latestId(), events: watch.eventsSince(since), note: null };
    },
  );
}
