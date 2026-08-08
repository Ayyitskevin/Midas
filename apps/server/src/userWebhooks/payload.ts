import { createHash } from 'node:crypto';
import type { AccountOrderEvent } from '@midas/shared';
import { recapLines, type DigestRecap, type DigestRecapEvidence } from '../recap';
import type { DigestWindow } from './cadence';

export const MAX_FILL_EVENTS_PER_DELIVERY = 10;
const MAX_COMPAT_TEXT = 1_900;
const MAX_FEE_CURRENCIES = 8;
const MAX_DIGEST_MOVERS = 3;
const MAX_COUNT = 1_000_000;

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const bounded = (value: string, max = 64): string =>
  value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/@/g, '@\u200b')
    .slice(0, max);
const boundedCount = (value: unknown): number | null => {
  const n = finite(value);
  return n == null || n < 0 ? null : Math.min(MAX_COUNT, Math.floor(n));
};

function deliveryHash(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

function compatText(lines: string[]): string {
  const text = lines.join('\n');
  return text.length <= MAX_COMPAT_TEXT ? text : `${text.slice(0, MAX_COMPAT_TEXT - 1)}…`;
}

export interface FillWebhookEvent {
  kind: 'fill' | 'filled';
  symbol: string;
  side: 'buy' | 'sell';
  price: number | null;
  amount: number | null;
  filled: number | null;
  filledDelta: number | null;
  observedAt: number;
}

export interface FillWebhookPayload {
  version: 1;
  type: 'midas.account.fills';
  deliveryId: string;
  observedAt: number;
  events: FillWebhookEvent[];
  omitted: number;
  /** Discord/Slack compatibility fields; identical and bounded. */
  content: string;
  text: string;
}

/** Deterministic, allowlisted fill batch. Returns null outside fill semantics. */
export function buildFillWebhookPayload(
  input: AccountOrderEvent[],
  alreadyOmitted = 0,
): FillWebhookPayload | null {
  const executions = input.filter(
    (event): event is AccountOrderEvent & { kind: 'fill' | 'filled' } =>
      event.kind === 'fill' || event.kind === 'filled',
  );
  if (executions.length === 0) return null;
  const selected = executions.slice(0, MAX_FILL_EVENTS_PER_DELIVERY);
  const events: FillWebhookEvent[] = selected.map((event) => ({
    kind: event.kind,
    symbol: bounded(event.symbol),
    side: event.side,
    price: finite(event.price),
    amount: finite(event.amount),
    filled: finite(event.filled),
    filledDelta: finite(event.filledDelta),
    observedAt: Number.isFinite(event.at) ? event.at : 0,
  }));
  const carriedOmitted = boundedCount(alreadyOmitted) ?? 0;
  const omitted = Math.min(
    MAX_COUNT,
    carriedOmitted + Math.max(0, executions.length - selected.length),
  );
  // The local event cursor + execution facts are sufficient correlation. Raw
  // exchange order ids are neither disclosed nor placed in a reversible hash.
  const deliveryId = `fill-v1-${deliveryHash(
    selected.map((event) => [event.id, event.at, event.kind, event.filled, event.filledDelta]),
  )}`;
  const lines = events.map((event) => {
    const label = event.kind === 'fill' ? '⚡ Fill' : '✅ Order filled';
    const quantity = event.kind === 'fill' ? event.filledDelta : event.amount;
    return `${label} — ${event.side.toUpperCase()} ${quantity ?? 'unknown'} ${event.symbol}` +
      (event.price != null ? ` @ ${event.price}` : '');
  });
  if (omitted > 0) lines.push(`… ${omitted} additional fill event${omitted === 1 ? '' : 's'} omitted by the delivery bound.`);
  const text = compatText(lines);
  return {
    version: 1,
    type: 'midas.account.fills',
    deliveryId,
    observedAt: Math.max(...events.map((event) => event.observedAt)),
    events,
    omitted,
    content: text,
    text,
  };
}

type DigestPayloadRecap = {
  equity: ({ state: DigestRecapEvidence['state']['equity'] } & NonNullable<DigestRecap['equity']>) | { state: DigestRecapEvidence['state']['equity'] };
  fills:
    | ({ state: DigestRecapEvidence['state']['fills'] } & Omit<NonNullable<DigestRecap['fills']>, 'feesByCurrency'> & {
        feesByCurrency: Record<string, number>;
      })
    | { state: DigestRecapEvidence['state']['fills'] };
  movers: { state: DigestRecapEvidence['state']['movers']; items: NonNullable<DigestRecap['movers']> };
};

export interface DigestWebhookPayload {
  version: 1;
  type: 'midas.account.digest';
  deliveryId: string;
  window: { start: number; end: number; hours: number };
  recap: DigestPayloadRecap;
  content: string;
  text: string;
}

/** Render explicit evidence states around the existing recap calculations. */
export function buildDigestWebhookPayload(
  window: DigestWindow,
  evidence: DigestRecapEvidence,
  deliveryId: string,
): DigestWebhookPayload {
  const state = { ...evidence.state };
  const rawEquity = evidence.recap.equity;
  const safeEquity =
    rawEquity &&
    finite(rawEquity.startUsd) != null &&
    finite(rawEquity.endUsd) != null &&
    finite(rawEquity.startAt) != null &&
    finite(rawEquity.endAt) != null
      ? { ...rawEquity }
      : null;
  if (rawEquity && !safeEquity) state.equity = 'partial';

  const rawFills = evidence.recap.fills;
  const rawFeeEntries = rawFills ? Object.entries(rawFills.feesByCurrency) : [];
  const boundedFees = rawFills
    ? Object.fromEntries(
        rawFeeEntries
          .filter(([, value]) => finite(value) != null)
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(0, MAX_FEE_CURRENCIES)
          .map(([currency, value]) => [bounded(currency, 24), value]),
      )
    : {};
  const safeFills =
    rawFills &&
    boundedCount(rawFills.count) != null &&
    finite(rawFills.buyNotionalUsd) != null &&
    finite(rawFills.sellNotionalUsd) != null &&
    boundedCount(rawFills.untimed) != null &&
    (rawFills.roundTripPnlUsd == null || finite(rawFills.roundTripPnlUsd) != null)
      ? {
          ...rawFills,
          count: boundedCount(rawFills.count)!,
          untimed: boundedCount(rawFills.untimed)!,
          feesByCurrency: boundedFees,
        }
      : null;
  if (rawFills && !safeFills) state.fills = 'partial';
  if (
    rawFills &&
    (rawFeeEntries.length > MAX_FEE_CURRENCIES ||
      Object.keys(boundedFees).length < rawFeeEntries.length)
  ) {
    state.fills = 'partial';
  }

  const safeMovers = (evidence.recap.movers ?? [])
    .filter((mover) => finite(mover.changePercent) != null)
    .slice(0, MAX_DIGEST_MOVERS)
    .map((mover) => ({ symbol: bounded(mover.symbol), changePercent: mover.changePercent }));
  if (evidence.recap.movers && safeMovers.length < evidence.recap.movers.length) {
    state.movers = 'partial';
  }
  const boundedRecap: DigestRecap = {
    equity: safeEquity,
    fills: safeFills,
    movers: evidence.recap.movers && safeMovers.length > 0 ? safeMovers : null,
  };
  const lines = ['📊 Your Midas account digest', ...recapLines(boundedRecap)];
  if (!boundedRecap.equity) lines.push('• Equity: unavailable — insufficient live snapshots for this window.');
  else if (state.equity === 'partial') {
    lines.push('• Note: equity change has partial window or unrealized-P&L coverage.');
  }
  if (!boundedRecap.fills) {
    lines.push(
      state.fills === 'empty'
        ? '• Fills: none observed in this window.'
        : state.fills === 'partial'
          ? '• Fills: partial — live coverage was incomplete, so no complete window total is claimed.'
      : '• Fills: unavailable — live fill evidence could not be read.',
    );
  } else if (state.fills === 'partial') {
    lines.push('• Note: fill totals are partial because some live evidence or fee detail was unavailable.');
  }
  if (!boundedRecap.movers) {
    lines.push(
      state.movers === 'empty'
        ? '• Movers: none — no open positions were reported.'
        : state.movers === 'partial'
          ? '• Movers: partial — position or quote coverage was incomplete.'
          : '• Movers: unavailable — live position/quote evidence could not be read.',
    );
  } else if (state.movers === 'partial') {
    lines.push('• Note: position or quote coverage was incomplete; movers are partial.');
  }
  lines.push(`Covers ${window.hours} hour${window.hours === 1 ? '' : 's'} ending ${new Date(window.end).toISOString()}.`);
  const text = compatText(lines);
  return {
    version: 1,
    type: 'midas.account.digest',
    deliveryId,
    window: { start: window.start, end: window.end, hours: window.hours },
    recap: {
      equity: boundedRecap.equity
        ? { state: state.equity, ...boundedRecap.equity }
        : { state: state.equity },
      fills: boundedRecap.fills
        ? { state: state.fills, ...boundedRecap.fills }
        : { state: state.fills },
      movers: { state: state.movers, items: boundedRecap.movers ?? [] },
    },
    content: text,
    text,
  };
}
